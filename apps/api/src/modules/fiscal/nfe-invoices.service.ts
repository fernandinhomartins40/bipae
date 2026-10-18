import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  type OnModuleInit,
} from '@nestjs/common';
import { renderDanfeNfe } from '@bipae/danfe';
import { nfeContingencyInput, nfeInvoiceInput, uuidv7, type NfeInvoiceView } from '@bipae/domain';
import {
  brasiliaDateTime,
  buildDraftNfe,
  buildNfeProc,
  signNfe,
  type NfeDraftInput,
  type NfeDraftResult,
  type SaleFiscalProfile,
} from '@bipae/fiscal';
import { findPaymentMeans, nfeEndpoints, PAYMENT_MEANS } from '@bipae/fiscal/tables';
import { findMunicipio } from '@bipae/fiscal/tables/municipios';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { assertStore, canUseStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  companyIcmsRules,
  customers,
  financialEntries,
  fiscalDocuments,
  fiscalProfiles,
  nfeInvoices,
  productBarcodes,
  products,
  stockMovements,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from './certificates.service';
import { toMotorRule } from './icms-rules.service';
import { cancellationView, rejectionHelp } from './nfce-emission.service';
import { SefazService } from './sefaz.service';

export const NFE_EMIT_JOB = 'nfe.emit';
const APP_VERSION = 'Bipaê 1.0';

type Input = z.output<typeof nfeInvoiceInput>;
type Invoice = typeof nfeInvoices.$inferSelect;
type StoredItem = Input['items'][number];
type Document = typeof fiscalDocuments.$inferSelect;

const documentView = (d: Document): NonNullable<NfeInvoiceView['document']> => ({
  id: d.id,
  saleId: d.saleId,
  invoiceId: d.invoiceId,
  model: d.model,
  series: d.series,
  number: d.number,
  accessKey: d.accessKey,
  status: d.status,
  pendingItems: d.pendingItems,
  contingency: d.contingency,
  contingencyMode: d.contingencyMode,
  replacedAccessKey: d.replacedAccessKey,
  help: d.status === 'rejected' || d.status === 'denied' ? rejectionHelp(d.cStat, d.xMotivo) : null,
  cStat: d.cStat,
  xMotivo: d.xMotivo,
  protocol: d.protocol,
  attempts: d.attempts,
  lastError: d.lastError,
  authorizedAt: d.authorizedAt?.toISOString() ?? null,
  updatedAt: d.updatedAt.toISOString(),
  cancellation: cancellationView(null),
});

/** Contexto da tarefa em segundo plano: o tenant da nota, em nome de quem a emitiu. */
const jobContext = (tenantId: string, userId: string): RequestContext => ({
  tenantId,
  userId,
  permissions: [],
  terminalId: null,
  storeIds: null,
});

/**
 * NF-e da retaguarda (F3-33.b). A pessoa preenche o rascunho (destinatário, itens, transporte,
 * parcelas e pagamento) e vê, a cada mudança, o que o motor diz que falta. Ao emitir, a nota ganha
 * o próximo número da série de NF-e da empresa e vai para a fila, que assina com o A1 da empresa
 * e envia à SEFAZ de homologação; antes de reenviar, consulta pela chave, para nunca autorizar a
 * mesma nota duas vezes. Ao emitir, a nota (sempre de saída) baixa o estoque da loja e as parcelas
 * da venda viram contas a receber (F3-33.e).
 */
@Injectable()
export class NfeInvoicesService implements OnModuleInit {
  private readonly logger = new Logger('NF-e');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SefazService) private readonly sefaz: SefazService,
  ) {}

  onModuleInit() {
    this.queue.process(NFE_EMIT_JOB, async (data) => {
      const { tenantId, documentId, userId } = data as {
        tenantId: string;
        documentId: string;
        userId: string;
      };
      await this.emit(jobContext(tenantId, userId), documentId);
    });
  }

  // ---------------------------------------------------------------- rascunho

  /** Os dados da nota para o motor, com a série e o número dados. */
  private async draftInput(
    tx: Tx,
    invoice: Invoice,
    numbering: { series: number; number: number; issuedAt: string },
  ): Promise<NfeDraftInput> {
    const [company] = await tx.select().from(companies).where(eq(companies.id, invoice.companyId));
    if (!company) throw notFound('Empresa');
    const items = invoice.items as StoredItem[];
    const ids = [...new Set(items.map((i) => i.productId))];
    const sold = ids.length
      ? await tx.select().from(products).where(inArray(products.id, ids))
      : [];
    const codes = ids.length
      ? await tx.select().from(productBarcodes).where(inArray(productBarcodes.productId, ids))
      : [];
    const profileIds = [
      ...new Set(sold.flatMap((p) => (p.fiscalProfileId ? [p.fiscalProfileId] : []))),
    ];
    const profiles = profileIds.length
      ? await tx.select().from(fiscalProfiles).where(inArray(fiscalProfiles.id, profileIds))
      : [];
    const rules = (
      await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.companyId, company.id))
    ).map(toMotorRule);
    const recipient = invoice.recipient as Input['recipient'];
    const transport = invoice.transport as Input['transport'];
    const a = recipient.address;
    return {
      draftId: invoice.id,
      company: {
        cnpj: company.taxId,
        legalName: company.legalName,
        tradeName: company.tradeName,
        ie: company.ie,
        uf: company.uf,
        regime: company.taxRegime,
        address: {
          street: company.street,
          number: company.streetNumber,
          complement: company.complement,
          district: company.district,
          cityCode: company.cityCode,
          cityName: company.cityCode ? (findMunicipio(company.cityCode)?.name ?? null) : null,
          cep: company.cep,
          phone: company.phone,
        },
      },
      series: numbering.series,
      number: numbering.number,
      issuedAt: numbering.issuedAt,
      nature: invoice.nature,
      purpose: invoice.purpose,
      presence: invoice.presence as NfeDraftInput['presence'],
      ...(invoice.finalConsumer !== null && { finalConsumer: invoice.finalConsumer }),
      references: invoice.refs,
      recipient: {
        taxId: recipient.taxId,
        name: recipient.name,
        ieIndicator: recipient.ieIndicator,
        ie: recipient.ie ?? null,
        email: recipient.email ?? null,
        address: {
          street: a.street,
          number: a.number,
          complement: a.complement ?? null,
          district: a.district,
          cityCode: a.ibgeCode ?? null,
          cityName: a.ibgeCode ? (findMunicipio(a.ibgeCode)?.name ?? a.city) : null,
          uf: a.uf,
          cep: a.cep,
          phone: recipient.phone ?? null,
        },
      },
      items: items.map((i) => {
        const p = sold.find((x) => x.id === i.productId);
        const profile = profiles.find((f) => f.id === p?.fiscalProfileId)?.data as
          (SaleFiscalProfile & { origem?: number }) | undefined;
        const grossCents = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
        return {
          code: p?.sku ?? i.productId.slice(0, 60),
          barcodes: codes.filter((c) => c.productId === i.productId).map((c) => c.code),
          description: p?.name ?? 'Produto',
          ncm: p?.ncm ?? null,
          cest: p?.cest ?? null,
          unit: p?.unit ?? 'UN',
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          grossCents,
          discountCents: i.discountCents,
          profile: profile ?? null,
          cfop: i.cfop ?? null,
        };
      }),
      transport: {
        freight: transport.freight,
        freightCents: transport.freightCents,
        ...(transport.carrier && {
          carrier: {
            ...(transport.carrier.taxId?.length === 11
              ? { cpf: transport.carrier.taxId }
              : transport.carrier.taxId
                ? { cnpj: transport.carrier.taxId }
                : {}),
            name: transport.carrier.name,
            ...(transport.carrier.uf && { uf: transport.carrier.uf }),
          },
        }),
        ...(transport.volumes && {
          volumes: [
            {
              ...(transport.volumes.quantity && { quantity: transport.volumes.quantity }),
              ...(transport.volumes.species && { species: transport.volumes.species }),
              ...(transport.volumes.grossKg && {
                grossKg: Number(transport.volumes.grossKg).toFixed(3),
              }),
            },
          ],
        }),
      },
      installments: invoice.installments as Input['installments'],
      payments: (invoice.payments as Input['payments']).map((p) => ({
        code: p.code,
        amountCents: p.amountCents,
        description: p.description ?? null,
      })),
      rules,
      additionalInfo: invoice.additionalInfo,
      appVersion: APP_VERSION,
      ...(invoice.demonstration && {
        demonstration: {
          note: invoice.demonstration,
          profile: company.demonstrationProfileId
            ? (((
                await tx
                  .select({ data: fiscalProfiles.data })
                  .from(fiscalProfiles)
                  .where(eq(fiscalProfiles.id, company.demonstrationProfileId))
              )[0]?.data as SaleFiscalProfile | undefined) ?? null)
            : null,
        },
      }),
    };
  }

  /** A conferência do rascunho, com o próximo número da série (o número final sai ao emitir). */
  private async check(tx: Tx, invoice: Invoice): Promise<NfeDraftResult> {
    const [company] = await tx
      .select({ series: companies.nfeSeries, next: companies.nfeNextNumber })
      .from(companies)
      .where(eq(companies.id, invoice.companyId));
    const input = await this.draftInput(tx, invoice, {
      series: company?.series ?? 1,
      number: company?.next ?? 1,
      issuedAt: new Date().toISOString(),
    });
    return buildDraftNfe(input);
  }

  private async view(tx: Tx, invoice: Invoice): Promise<NfeInvoiceView> {
    const items = invoice.items as StoredItem[];
    const ids = [...new Set(items.map((i) => i.productId))];
    const names = ids.length
      ? await tx
          .select({ id: products.id, name: products.name, unit: products.unit })
          .from(products)
          .where(inArray(products.id, ids))
      : [];
    const [doc] = await tx
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.invoiceId, invoice.id));
    const check = invoice.status === 'draft' ? await this.check(tx, invoice) : null;
    const transport = invoice.transport as Input['transport'];
    const productsTotal = items.reduce(
      (t, i) => t + Math.round((i.unitPriceCents * i.quantityMilli) / 1000) - i.discountCents,
      0,
    );
    return {
      id: invoice.id,
      conditionalId: invoice.conditionalId,
      demonstration: invoice.demonstration,
      companyId: invoice.companyId,
      storeId: invoice.storeId,
      status: invoice.status,
      nature: invoice.nature,
      purpose: invoice.purpose,
      presence: invoice.presence as NfeInvoiceView['presence'],
      finalConsumer: invoice.finalConsumer,
      references: invoice.refs,
      recipient: invoice.recipient as NfeInvoiceView['recipient'],
      items: items.map((i) => {
        const p = names.find((n) => n.id === i.productId);
        return {
          productId: i.productId,
          productName: p?.name ?? 'Produto',
          unit: p?.unit ?? 'UN',
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          discountCents: i.discountCents,
          cfop: i.cfop ?? null,
        };
      }),
      transport,
      installments: invoice.installments as NfeInvoiceView['installments'],
      payments: (invoice.payments as Input['payments']).map((p) => ({
        code: p.code,
        amountCents: p.amountCents,
        description: p.description ?? null,
      })),
      additionalInfo: invoice.additionalInfo,
      totalCents: productsTotal + transport.freightCents,
      check: check
        ? check.ok
          ? { ok: true, pending: [], notes: check.notes, totalCents: check.document.totalCents }
          : { ok: false, pending: check.pending, notes: [], totalCents: null }
        : { ok: true, pending: [], notes: [], totalCents: null },
      document: doc ? documentView(doc) : null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- venda condicional

  /**
   * Rascunho de uma nota do condicional (F5-12.c.2): destinatário copiado do cliente, as peças
   * com o preço do condicional e, depois da remessa, a chave dela. Quem completa e emite a venda
   * do que o cliente ficou é a pessoa (forma de pagamento); as outras saem sozinhas quando
   * estão completas.
   */
  async createForConditional(
    tx: Tx,
    ctx: RequestContext,
    input: {
      conditionalId: string;
      companyId: string;
      storeId: string;
      customer: typeof customers.$inferSelect;
      note: 'remessa' | 'retorno' | 'entradaSimbolica' | 'venda';
      items: { productId: string; quantityMilli: number; unitPriceCents: number }[];
      references: string[];
    },
  ) {
    const c = input.customer;
    const address = (c.address ?? {}) as Partial<Input['recipient']['address']>;
    const taxId = c.taxId ?? '';
    const total = input.items.reduce(
      (t, i) => t + Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
      0,
    );
    const [row] = await tx
      .insert(nfeInvoices)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: input.companyId,
        storeId: input.storeId,
        nature: 'Venda de mercadoria',
        purpose: 'normal',
        presence: 'presencial',
        finalConsumer: true,
        refs: input.references,
        customerId: c.id,
        recipient: {
          customerId: c.id,
          taxId,
          name: c.name,
          // Pessoa física (ou empresa sem a inscrição no cadastro): não contribuinte.
          ieIndicator: 9,
          ie: null,
          email: c.email,
          phone: c.phone,
          address: {
            cep: address.cep ?? '',
            street: address.street ?? '',
            number: address.number ?? '',
            complement: address.complement ?? null,
            district: address.district ?? '',
            city: address.city ?? '',
            uf: address.uf ?? '',
            ibgeCode: address.ibgeCode ?? null,
          },
        },
        items: input.items.map((i) => ({ ...i, discountCents: 0, cfop: null })),
        transport: { freight: 'semFrete', freightCents: 0 },
        installments: [],
        payments: [{ code: '01', amountCents: total }],
        conditionalId: input.conditionalId,
        demonstration: input.note,
        createdBy: ctx.userId,
      })
      .returning({ id: nfeInvoices.id });
    return row!.id;
  }

  /** Emite a nota se o motor disser que está completa; senão, fica no rascunho com o que falta. */
  async tryIssue(ctx: RequestContext, id: string) {
    try {
      await this.issue(ctx, id);
      return true;
    } catch (error) {
      if (error instanceof AppError) return false;
      throw error;
    }
  }

  /** As notas de cada condicional, com o que falta nos rascunhos. */
  async forConditionals(tx: Tx, conditionalIds: string[]) {
    if (conditionalIds.length === 0) return [];
    const rows = await tx
      .select({ i: nfeInvoices, d: fiscalDocuments })
      .from(nfeInvoices)
      .leftJoin(fiscalDocuments, eq(fiscalDocuments.invoiceId, nfeInvoices.id))
      .where(
        and(
          inArray(nfeInvoices.conditionalId, conditionalIds),
          sql`${nfeInvoices.status} <> 'discarded'`,
        ),
      )
      .orderBy(nfeInvoices.createdAt);
    const result = [];
    for (const { i, d } of rows) {
      const check = i.status === 'draft' ? await this.check(tx, i) : null;
      result.push({
        conditionalId: i.conditionalId!,
        id: i.id,
        demonstration: i.demonstration!,
        status: i.status,
        documentStatus: d?.status ?? null,
        number: d?.number ?? null,
        accessKey: d?.accessKey ?? null,
        pending: check && !check.ok ? check.pending : [],
      });
    }
    return result;
  }

  private async load(tx: Tx, ctx: RequestContext, id: string) {
    const [row] = await tx.select().from(nfeInvoices).where(eq(nfeInvoices.id, id));
    if (!row || !canUseStore(ctx, row.storeId)) throw notFound('NF-e');
    return row;
  }

  /** Empresa, loja e produtos do rascunho existem neste tenant. */
  private async assertRefs(tx: Tx, ctx: RequestContext, input: Input) {
    assertStore(ctx, input.storeId);
    const [company] = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, input.companyId));
    if (!company) throw notFound('Empresa');
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const found = await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, ids));
    if (found.length !== ids.length) throw notFound('Produto');
  }

  private columns(input: Input) {
    return {
      companyId: input.companyId,
      storeId: input.storeId,
      nature: input.nature,
      purpose: input.purpose,
      presence: input.presence,
      finalConsumer: input.finalConsumer ?? null,
      refs: input.references,
      customerId: input.recipient.customerId ?? null,
      recipient: input.recipient,
      items: input.items,
      transport: input.transport,
      installments: input.installments,
      payments: input.payments,
      additionalInfo: input.additionalInfo ?? null,
    };
  }

  list(ctx: RequestContext): Promise<NfeInvoiceView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(nfeInvoices)
        .where(
          and(storeCondition(ctx, nfeInvoices.storeId), sql`${nfeInvoices.status} <> 'discarded'`),
        )
        .orderBy(desc(nfeInvoices.createdAt))
        .limit(200);
      const views: NfeInvoiceView[] = [];
      for (const row of rows) views.push(await this.view(tx, row));
      return views;
    });
  }

  get(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => this.view(tx, await this.load(tx, ctx, id)));
  }

  create(ctx: RequestContext, input: Input) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.assertRefs(tx, ctx, input);
      const [row] = await tx
        .insert(nfeInvoices)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          ...this.columns(input),
          createdBy: ctx.userId,
        })
        .returning();
      return this.view(tx, row!);
    });
  }

  update(ctx: RequestContext, id: string, input: Input) {
    return withTenant(this.db, ctx, async (tx) => {
      const current = await this.load(tx, ctx, id);
      if (current.status !== 'draft') {
        throw new AppError(409, 'not_draft', 'Esta NF-e já foi emitida e não pode mais mudar.');
      }
      await this.assertRefs(tx, ctx, input);
      const [row] = await tx
        .update(nfeInvoices)
        .set({ ...this.columns(input), updatedAt: new Date() })
        .where(eq(nfeInvoices.id, id))
        .returning();
      return this.view(tx, row!);
    });
  }

  discard(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const current = await this.load(tx, ctx, id);
      if (current.status !== 'draft') {
        throw new AppError(409, 'not_draft', 'Só o rascunho pode ser descartado.');
      }
      await tx
        .update(nfeInvoices)
        .set({ status: 'discarded', updatedAt: new Date() })
        .where(eq(nfeInvoices.id, id));
    });
  }

  // ---------------------------------------------------------------- emissão

  /**
   * Emite o rascunho: confere com o motor, toma o próximo número da série da empresa e cria o
   * documento fiscal na mesma transação; a tarefa da fila faz o resto.
   */
  async issue(ctx: RequestContext, id: string): Promise<NfeInvoiceView> {
    const documentId = await withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.load(tx, ctx, id);
      if (invoice.status !== 'draft') {
        throw new AppError(409, 'not_draft', 'Esta NF-e já foi emitida.');
      }
      const check = await this.check(tx, invoice);
      if (!check.ok) {
        throw new AppError(
          422,
          'nfe_incomplete',
          `Falta resolver antes de emitir: ${check.pending.join(' ')}`,
        );
      }
      // O número sai da série da empresa, travado na linha: duas emissões nunca pegam o mesmo.
      const [taken] = await tx
        .update(companies)
        .set({ nfeNextNumber: sql`${companies.nfeNextNumber} + 1` })
        .where(eq(companies.id, invoice.companyId))
        .returning({ series: companies.nfeSeries, next: companies.nfeNextNumber });
      const docId = uuidv7();
      await tx.insert(fiscalDocuments).values({
        id: docId,
        tenantId: ctx.tenantId,
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        model: '55',
        series: taken!.series,
        number: taken!.next - 1,
      });
      await tx
        .update(nfeInvoices)
        .set({ status: 'issued', issuedAt: new Date(), updatedAt: new Date() })
        .where(eq(nfeInvoices.id, invoice.id));
      const number = taken!.next - 1;
      const recipient = invoice.recipient as Input['recipient'];
      // F3-33.e: a nota é de saída (tpNF 1): a venda e a devolução de compra ao fornecedor tiram
      // a mercadoria do estoque da loja.
      const isReturn = invoice.purpose === 'devolucao';
      const now = new Date();
      // Remessa, retorno e entrada simbólica do condicional não mexem no estoque: o condicional
      // já tirou as peças na saída e pôs de volta na volta (F5-12.c.2).
      const moves = !invoice.demonstration || invoice.demonstration === 'venda';
      for (const item of moves ? (invoice.items as StoredItem[]) : []) {
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: invoice.storeId,
          productId: item.productId,
          deltaMilli: -item.quantityMilli,
          reason: 'nfe_out',
          refId: invoice.id,
          note: `NF-e nº ${number} · ${recipient.name}`,
          actorId: ctx.userId,
          occurredAt: now,
        });
      }
      // Cada parcela da venda a prazo vira uma conta a receber (a soma é o total da nota).
      const installments = invoice.installments as Input['installments'];
      if (!isReturn && moves && installments.length > 0) {
        const groupId = uuidv7();
        await tx.insert(financialEntries).values(
          installments.map((p, index) => ({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            companyId: invoice.companyId,
            kind: 'receivable' as const,
            description: `NF-e nº ${number} · ${recipient.name} · parcela ${index + 1}/${installments.length}`,
            category: 'Vendas',
            customerId: invoice.customerId,
            document: recipient.taxId,
            amountCents: p.amountCents,
            dueDate: p.dueDate,
            groupId,
            installment: index + 1,
            installments: installments.length,
            invoiceId: invoice.id,
            createdBy: ctx.userId,
          })),
        );
      }
      await this.audit.record(tx, ctx, {
        action: 'nfe.issued',
        entity: 'nfe_invoice',
        entityId: invoice.id,
        data: {
          series: taken!.series,
          number: taken!.next - 1,
          recipient: (invoice.recipient as Input['recipient']).name,
          totalCents: check.document.totalCents,
        },
      });
      return docId;
    });
    await this.schedule(ctx.tenantId, ctx.userId, documentId);
    return this.get(ctx, id);
  }

  async schedule(tenantId: string, userId: string, documentId: string) {
    await this.queue.add(
      NFE_EMIT_JOB,
      { tenantId, documentId, userId },
      { attempts: 6, backoffMs: 2000 },
    );
  }

  private async patch(ctx: RequestContext, id: string, values: Partial<Document>) {
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(fiscalDocuments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(fiscalDocuments.id, id)),
    );
  }

  async emit(ctx: RequestContext, documentId: string): Promise<void> {
    // 1. Monta e assina dentro do tenant; a conversa com a SEFAZ fica fora da transação.
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.id, documentId));
      if (!doc) throw new Error('Documento fiscal ainda não disponível.');
      if (!doc.invoiceId || doc.model !== '55') return null;
      if (!['pending', 'error', 'not_configured', 'rejected'].includes(doc.status)) return null;
      const [invoice] = await tx
        .select()
        .from(nfeInvoices)
        .where(eq(nfeInvoices.id, doc.invoiceId));
      if (!invoice) throw notFound('NF-e');
      let key;
      try {
        key = await this.certificates.signingKey(tx, doc.companyId);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        return { doc, pending: [error.message] };
      }
      if (doc.signedXml && doc.accessKey) {
        return { doc, signedXml: doc.signedXml, accessKey: doc.accessKey };
      }
      // Contingência SVC (F3-16): emissão e entrada em contingência no mesmo momento, para a
      // emissão nunca ficar antes do dhCont (regra B28-40).
      const svc =
        doc.contingencyMode && doc.contingencyAt && doc.contingencyReason
          ? {
              mode: doc.contingencyMode,
              enteredAt: brasiliaDateTime(doc.contingencyAt.toISOString()),
              reason: doc.contingencyReason,
            }
          : null;
      const built = buildDraftNfe({
        ...(await this.draftInput(tx, invoice, {
          series: doc.series!,
          number: doc.number!,
          issuedAt: (svc ? doc.contingencyAt! : (invoice.issuedAt ?? new Date())).toISOString(),
        })),
        ...(svc && { contingency: svc }),
      });
      if (!built.ok) return { doc, pending: built.pending };
      return {
        doc,
        signedXml: await signNfe(built.document.xml, key),
        accessKey: built.document.accessKey,
      };
    });
    if (!prepared) return;
    const { doc } = prepared;
    if ('pending' in prepared) {
      await this.patch(ctx, doc.id, {
        status: 'not_configured',
        pendingItems: prepared.pending,
        lastError: null,
      });
      return;
    }
    const { signedXml, accessKey } = prepared;
    await this.patch(ctx, doc.id, {
      accessKey,
      signedXml,
      pendingItems: [],
      attempts: doc.attempts + 1,
    });
    try {
      // 2. Já houve tentativa: a nota pode ter sido autorizada sem a resposta ter chegado.
      if (doc.attempts > 0) {
        const consult = await this.sefaz.consult(ctx, doc.companyId, accessKey);
        if (consult.protocol && consult.outcome === 'authorized') {
          await this.finish(ctx, doc.id, signedXml, consult.protocol);
          return;
        }
      }
      // 3. Envio.
      const result = await this.sefaz.authorize(ctx, {
        companyId: doc.companyId,
        model: '55',
        batchId: String(Date.now()).slice(-15),
        signedXml,
        svc: Boolean(doc.contingencyMode),
      });
      const [protocol] = result.protocols;
      if (protocol) {
        await this.finish(ctx, doc.id, signedXml, protocol);
        return;
      }
      if (result.outcome === 'rejected') {
        await this.patch(ctx, doc.id, {
          status: 'rejected',
          cStat: result.cStat,
          xMotivo: result.xMotivo,
        });
        return;
      }
      throw new Error(`Lote sem protocolo: ${result.cStat} ${result.xMotivo}`);
    } catch (error) {
      // Falha temporária (rede, SEFAZ fora): fica marcada e a fila tenta de novo.
      await this.patch(ctx, doc.id, { status: 'error', lastError: (error as Error).message });
      this.logger.warn(`NF-e ${accessKey}: ${(error as Error).message}`);
      throw error;
    }
  }

  private async finish(
    ctx: RequestContext,
    id: string,
    signedXml: string,
    protocol: Parameters<typeof buildNfeProc>[1] & { outcome: string },
  ) {
    if (protocol.outcome === 'authorized' || protocol.outcome === 'denied') {
      await this.patch(ctx, id, {
        status: protocol.outcome,
        cStat: protocol.cStat,
        xMotivo: protocol.xMotivo,
        protocol: protocol.number ?? null,
        nfeProc: buildNfeProc(signedXml, protocol),
        authorizedAt: protocol.outcome === 'authorized' ? new Date() : null,
        lastError: null,
      });
      return;
    }
    // Rejeitada: a nota será montada de novo na próxima tentativa (mesma chave e número).
    await this.patch(ctx, id, {
      status: 'rejected',
      cStat: protocol.cStat,
      xMotivo: protocol.xMotivo,
      signedXml: null,
      lastError: null,
    });
  }

  /**
   * Contingência SVC (F3-16): a SEFAZ da UF não responde e a nota vai à SEFAZ Virtual de
   * Contingência que a UF usa (tabela oficial). A nota é refeita com tpEmis 6 ou 7, o que muda a
   * chave; a chave da tentativa normal fica guardada para conferir quando a UF voltar.
   */
  async contingency(ctx: RequestContext, id: string, reason: string) {
    const docId = await withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.load(tx, ctx, id);
      const [doc] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.invoiceId, invoice.id));
      if (!doc) throw new AppError(409, 'not_issued', 'Esta NF-e ainda é um rascunho.');
      if (doc.contingencyMode) {
        throw new AppError(409, 'already_svc', 'Esta NF-e já está na contingência SVC.');
      }
      if (doc.status !== 'error') {
        throw new AppError(
          409,
          'sefaz_answering',
          'A contingência é só para quando a SEFAZ da UF não responde.',
        );
      }
      const [company] = await tx
        .select({ uf: companies.uf })
        .from(companies)
        .where(eq(companies.id, doc.companyId));
      const mode = company?.uf ? nfeEndpoints(company.uf)?.contingency.homologacao : null;
      if (!mode) throw new AppError(422, 'no_svc', 'Falta a UF da empresa para achar a SVC.');
      await tx
        .update(fiscalDocuments)
        .set({
          status: 'pending',
          contingency: true,
          contingencyMode: mode,
          contingencyAt: new Date(),
          contingencyReason: reason,
          replacedAccessKey: doc.accessKey,
          accessKey: null,
          signedXml: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(fiscalDocuments.id, doc.id));
      await this.audit.record(tx, ctx, {
        action: 'nfe.contingency',
        entity: 'nfe_invoice',
        entityId: invoice.id,
        data: { mode, reason, replacedAccessKey: doc.accessKey },
      });
      return doc.id;
    });
    await this.emit(ctx, docId).catch(() => undefined);
    return this.get(ctx, id);
  }

  /**
   * Com a UF de volta: a tentativa normal que a contingência substituiu chegou a ser autorizada?
   * Se sim, as duas notas valem e uma tem de ser cancelada; a nota avisa.
   */
  async checkReplaced(ctx: RequestContext, documentId: string) {
    const doc = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.id, documentId));
      return row ?? null;
    });
    if (!doc?.replacedAccessKey || doc.replacedCheckedAt) return;
    const consult = await this.sefaz.consult(ctx, doc.companyId, doc.replacedAccessKey);
    await this.patch(ctx, doc.id, {
      replacedCheckedAt: new Date(),
      ...(consult.outcome === 'authorized' && {
        lastError: `A tentativa normal (chave ${doc.replacedAccessKey}) também foi autorizada pela SEFAZ: cancele uma das duas notas.`,
      }),
    });
  }

  /** Tentar de novo a pedido de alguém (depois de configurar o que faltava, por exemplo). */
  async retry(ctx: RequestContext, id: string) {
    const docId = await withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.load(tx, ctx, id);
      const [doc] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.invoiceId, invoice.id));
      if (!doc) throw new AppError(409, 'not_issued', 'Esta NF-e ainda é um rascunho.');
      if (['authorized', 'denied', 'cancelled', 'voided'].includes(doc.status)) {
        throw new AppError(409, 'already_final', 'Esta nota já tem resposta final da SEFAZ.');
      }
      await tx
        .update(fiscalDocuments)
        .set({
          status: 'pending',
          signedXml: doc.status === 'rejected' ? null : doc.signedXml,
          updatedAt: new Date(),
        })
        .where(eq(fiscalDocuments.id, doc.id));
      return doc.id;
    });
    await this.emit(ctx, docId).catch(() => undefined);
    return this.get(ctx, id);
  }

  /** XML autorizado (nfeProc). */
  xml(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.load(tx, ctx, id);
      const [doc] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.invoiceId, invoice.id));
      if (!doc?.nfeProc) {
        throw new AppError(409, 'not_authorized', 'A nota ainda não foi autorizada pela SEFAZ.');
      }
      return { accessKey: doc.accessKey!, xml: doc.nfeProc };
    });
  }

  /**
   * DANFE em PDF: o da nota autorizada ou, antes disso, a prévia (com marca d'água e sem valor
   * fiscal), montada do rascunho.
   */
  async danfe(ctx: RequestContext, id: string): Promise<{ name: string; pdf: Uint8Array }> {
    const source = await withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.load(tx, ctx, id);
      const [doc] = await tx
        .select()
        .from(fiscalDocuments)
        .where(eq(fiscalDocuments.invoiceId, invoice.id));
      if (doc?.nfeProc && doc.status === 'authorized') {
        return { xml: doc.nfeProc, preview: false, key: doc.accessKey! };
      }
      const [company] = await tx
        .select({ series: companies.nfeSeries, next: companies.nfeNextNumber })
        .from(companies)
        .where(eq(companies.id, invoice.companyId));
      const built = buildDraftNfe(
        await this.draftInput(tx, invoice, {
          series: doc?.series ?? company?.series ?? 1,
          number: doc?.number ?? company?.next ?? 1,
          issuedAt: (invoice.issuedAt ?? new Date()).toISOString(),
        }),
      );
      if (!built.ok) {
        throw new AppError(
          422,
          'nfe_incomplete',
          `A prévia do DANFE precisa da nota completa: ${built.pending.join(' ')}`,
        );
      }
      return { xml: built.document.xml, preview: true, key: built.document.accessKey };
    });
    const pdf = await renderDanfeNfe(source.xml, { preview: source.preview });
    return { name: `${source.preview ? 'Previa-' : ''}DANFE-NFe${source.key}.pdf`, pdf };
  }
}

@Controller('fiscal/nfe')
export class NfeInvoicesController {
  constructor(@Inject(NfeInvoicesService) private readonly invoices: NfeInvoicesService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.invoices.list(ctx);
  }

  /** Meios de pagamento (tPag) da tabela oficial em vigor hoje, para a tela da nota. */
  @Get('payment-means')
  @RequirePermission('catalog.read')
  paymentMeans() {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    return PAYMENT_MEANS.filter((m) => findPaymentMeans(m.code, today)).map((m) => ({
      code: m.code,
      description: m.description,
    }));
  }

  @Post()
  @RequirePermission('fiscal.profile.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.invoices.create(ctx, parse(nfeInvoiceInput, body));
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.get(ctx, id);
  }

  @Put(':id')
  @RequirePermission('fiscal.profile.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.invoices.update(ctx, id, parse(nfeInvoiceInput, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('fiscal.profile.write')
  async discard(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.invoices.discard(ctx, id);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  issue(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.issue(ctx, id);
  }

  @Post(':id/contingency')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  contingency(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.invoices.contingency(ctx, id, parse(nfeContingencyInput, body).reason);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.retry(ctx, id);
  }

  @Get(':id/xml')
  @RequirePermission('catalog.read')
  async xml(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, xml } = await this.invoices.xml(ctx, id);
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="NFe${accessKey}.xml"`);
    return new StreamableFile(Buffer.from(xml, 'utf8'));
  }

  @Get(':id/danfe')
  @RequirePermission('catalog.read')
  async danfe(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { name, pdf } = await this.invoices.danfe(ctx, id);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="${name}"`);
    return new StreamableFile(Buffer.from(pdf));
  }
}
