import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  type OnModuleInit,
} from '@nestjs/common';
import { uuidv7, type FiscalDocumentView } from '@bipae/domain';
import {
  brasiliaDateTime,
  buildNfeProc,
  buildSaleNfce,
  buildSaleNfceContingency,
  signNfe,
  type SaleFiscalProfile,
  type SaleNfceInput,
} from '@bipae/fiscal';
import { findMunicipio } from '@bipae/fiscal/tables/municipios';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  companyIcmsRules,
  fiscalDocuments,
  fiscalProfiles,
  productBarcodes,
  products,
  saleItems,
  salePayments,
  sales,
  terminals,
} from '../../db/schema';
import { CertificatesService } from './certificates.service';
import { toMotorRule } from './icms-rules.service';
import { SefazService } from './sefaz.service';

export const NFCE_EMIT_JOB = 'nfce.emit';
/** Passado isso, a emissão normal arrisca a rejeição 704; vai em contingência (D-013). */
const LATE_EMISSION_MS = 4 * 60_000;
const LATE_REASON = 'Venda registrada sem conexão com a internet; NFC-e transmitida ao reconectar';
const APP_VERSION = 'Bipaê 1.0';

const toView = (d: typeof fiscalDocuments.$inferSelect): FiscalDocumentView => ({
  id: d.id,
  saleId: d.saleId,
  model: d.model,
  series: d.series,
  number: d.number,
  accessKey: d.accessKey,
  status: d.status,
  pendingItems: d.pendingItems,
  contingency: d.contingency,
  cStat: d.cStat,
  xMotivo: d.xMotivo,
  protocol: d.protocol,
  attempts: d.attempts,
  lastError: d.lastError,
  authorizedAt: d.authorizedAt?.toISOString() ?? null,
  updatedAt: d.updatedAt.toISOString(),
});

/** Contexto da tarefa em segundo plano: o tenant da venda, sem pessoa por trás. */
const jobContext = (tenantId: string, userId: string): RequestContext => ({
  tenantId,
  userId,
  permissions: [],
  terminalId: null,
  storeIds: null,
});

/**
 * Emissão da NFC-e no servidor (F3-14.b, ADR-0012: caixa web com internet assina no servidor).
 * A venda sincronizada ganha um documento fiscal; a tarefa monta a nota, assina com o A1 da
 * empresa e envia à SEFAZ de homologação. Antes de reenviar, consulta pela chave, para nunca
 * autorizar a mesma venda duas vezes. Falta de configuração não é erro: a nota fica em
 * "falta configurar", com a lista do que resolver, e não é emitida depois por conta própria.
 */
@Injectable()
export class NfceEmissionService implements OnModuleInit {
  private readonly logger = new Logger('NFC-e');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SefazService) private readonly sefaz: SefazService,
  ) {}

  onModuleInit() {
    this.queue.process(NFCE_EMIT_JOB, async (data) => {
      const { tenantId, documentId, userId } = data as {
        tenantId: string;
        documentId: string;
        userId: string;
      };
      await this.emit(jobContext(tenantId, userId), documentId);
    });
  }

  /** Na mesma transação da venda: cria o documento; a tarefa é posta na fila logo depois. */
  async prepare(
    tx: Tx,
    ctx: RequestContext,
    saleId: string,
    companyId: string,
    /** NFC-e já emitida pelo caixa em contingência (F3-15): transmitida como veio. */
    terminalNfce?: { accessKey: string; xml: string },
  ) {
    const id = uuidv7();
    const fromTerminal =
      terminalNfce && terminalNfce.xml.includes(`Id="NFe${terminalNfce.accessKey}"`)
        ? terminalNfce
        : null;
    const [row] = await tx
      .insert(fiscalDocuments)
      .values({
        id,
        tenantId: ctx.tenantId,
        saleId,
        companyId,
        model: '65',
        ...(fromTerminal && {
          origin: 'terminal' as const,
          contingency: true,
          accessKey: fromTerminal.accessKey,
          // Série e número estão na própria chave (posições 23 a 25 e 26 a 34).
          series: Number(fromTerminal.accessKey.slice(22, 25)),
          number: Number(fromTerminal.accessKey.slice(25, 34)),
          signedXml: fromTerminal.xml,
        }),
      })
      .onConflictDoNothing()
      .returning({ id: fiscalDocuments.id });
    return row?.id ?? null;
  }

  async schedule(tenantId: string, userId: string, documentId: string) {
    await this.queue.add(
      NFCE_EMIT_JOB,
      { tenantId, documentId, userId },
      // A tarefa pode chegar antes de a transação da venda terminar: tenta de novo em seguida.
      { attempts: 6, backoffMs: 2000 },
    );
  }

  /** Os dados da venda para a NFC-e, e quando ela aconteceu. */
  private async saleInput(
    tx: Tx,
    doc: typeof fiscalDocuments.$inferSelect,
  ): Promise<{ input: SaleNfceInput; occurredAt: Date }> {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, doc.saleId));
    if (!sale) throw notFound('Venda');
    const [terminal] = await tx
      .select({ series: terminals.nfceSeries })
      .from(terminals)
      .where(eq(terminals.id, sale.terminalId));
    const [company] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
    if (!company) throw notFound('Empresa');
    const items = await tx
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id))
      .orderBy(asc(saleItems.line));
    const payments = await tx.select().from(salePayments).where(eq(salePayments.saleId, sale.id));
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
    const input: SaleNfceInput = {
      saleId: sale.id,
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
      series: terminal?.series ?? 1,
      terminalSeq: sale.terminalSeq,
      occurredAt: sale.occurredAt.toISOString(),
      items: items.map((i) => {
        const p = sold.find((x) => x.id === i.productId);
        const profile = profiles.find((f) => f.id === p?.fiscalProfileId)?.data as
          (SaleFiscalProfile & { origem?: number }) | undefined;
        return {
          code: p?.sku ?? i.productId.slice(0, 60),
          barcodes: codes.filter((c) => c.productId === i.productId).map((c) => c.code),
          description: i.name,
          ncm: p?.ncm ?? null,
          cest: p?.cest ?? null,
          unit: i.unit,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          grossCents: i.grossCents,
          discountCents: i.discountCents,
          profile: profile ?? null,
        };
      }),
      payments: payments.map((p) => ({
        method: p.method,
        amountCents: p.amountCents,
        changeCents: p.changeCents,
        authorizationCode: p.authorizationCode,
      })),
      customerTaxId: sale.customerTaxId,
      rules,
      paymentCodes: company.nfcePaymentCodes,
      appVersion: APP_VERSION,
    };
    return { input, occurredAt: sale.occurredAt };
  }

  private async update(
    ctx: RequestContext,
    id: string,
    patch: Partial<typeof fiscalDocuments.$inferInsert>,
  ) {
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(fiscalDocuments)
        .set({ ...patch, updatedAt: new Date() })
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
      // Ainda não visível: a transação da venda não terminou. A fila tenta de novo.
      if (!doc) throw new Error('Documento fiscal ainda não disponível.');
      if (doc.status === 'authorized' || doc.status === 'denied') return null;
      // O certificado da empresa no servidor é a conexão com a SEFAZ, mesmo para a nota que o
      // caixa assinou: sem ele, a nota fica em "falta configurar".
      let key;
      try {
        key = await this.certificates.signingKey(tx, doc.companyId);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        // Sem certificado, a lista mostra também o que mais falta para emitir.
        const { input } = await this.saleInput(tx, doc);
        const draft = buildSaleNfce(input);
        return { doc, pending: [...(draft.ok ? [] : draft.pending), error.message] };
      }
      // Nota já assinada (pelo caixa em contingência, ou numa tentativa anterior): vai como está.
      if (doc.signedXml && doc.accessKey && doc.series !== null && doc.number !== null) {
        return {
          doc,
          signedXml: doc.signedXml,
          accessKey: doc.accessKey,
          series: doc.series,
          number: doc.number,
          contingency: doc.contingency,
        };
      }
      const { input, occurredAt } = await this.saleInput(tx, doc);
      // A emissão normal tem 5 minutos de tolerância (NT 2026.002, B10-10); depois disso, a
      // venda vai em contingência off-line, com a data de entrada em contingência (D-013).
      const late = Date.now() - occurredAt.getTime() > LATE_EMISSION_MS;
      const built = late
        ? await buildSaleNfceContingency(
            input,
            { enteredAt: brasiliaDateTime(occurredAt.toISOString()), reason: LATE_REASON },
            key,
          )
        : buildSaleNfce(input);
      if (!built.ok) return { doc, pending: built.pending };
      return {
        doc,
        signedXml: await signNfe(built.document.xml, key),
        accessKey: built.document.accessKey,
        series: built.input.series,
        number: built.input.number,
        contingency: late,
      };
    });
    if (!prepared) return;
    const { doc } = prepared;
    if ('pending' in prepared) {
      await this.update(ctx, doc.id, {
        status: 'not_configured',
        pendingItems: prepared.pending,
        lastError: null,
      });
      return;
    }
    const { signedXml, accessKey } = prepared;
    await this.update(ctx, doc.id, {
      series: prepared.series,
      number: prepared.number,
      accessKey,
      signedXml,
      contingency: prepared.contingency,
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
        model: '65',
        batchId: String(Date.now()).slice(-15),
        signedXml,
      });
      const [protocol] = result.protocols;
      if (protocol) {
        await this.finish(ctx, doc.id, signedXml, protocol);
        return;
      }
      if (result.outcome === 'rejected') {
        await this.update(ctx, doc.id, {
          status: 'rejected',
          cStat: result.cStat,
          xMotivo: result.xMotivo,
        });
        return;
      }
      throw new Error(`Lote sem protocolo: ${result.cStat} ${result.xMotivo}`);
    } catch (error) {
      // Falha temporária (rede, SEFAZ fora): fica marcada e a fila tenta de novo.
      await this.update(ctx, doc.id, { status: 'error', lastError: (error as Error).message });
      this.logger.warn(`NFC-e ${accessKey}: ${(error as Error).message}`);
      throw error;
    }
  }

  private async finish(
    ctx: RequestContext,
    id: string,
    signedXml: string,
    protocol: {
      outcome: string;
      cStat: string;
      xMotivo: string;
      number?: string;
      xml: string;
      accessKey: string;
      receivedAt?: string;
    },
  ) {
    if (protocol.outcome === 'authorized' || protocol.outcome === 'denied') {
      await this.update(ctx, id, {
        status: protocol.outcome,
        cStat: protocol.cStat,
        xMotivo: protocol.xMotivo,
        protocol: protocol.number ?? null,
        nfeProc: buildNfeProc(signedXml, protocol as Parameters<typeof buildNfeProc>[1]),
        authorizedAt: protocol.outcome === 'authorized' ? new Date() : null,
        lastError: null,
      });
      return;
    }
    await this.update(ctx, id, {
      status: 'rejected',
      cStat: protocol.cStat,
      xMotivo: protocol.xMotivo,
      lastError: null,
    });
  }

  // ---------------------------------------------------------------- consultas

  async forSale(ctx: RequestContext, saleId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx
        .select({ d: fiscalDocuments })
        .from(fiscalDocuments)
        .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
        .where(and(eq(fiscalDocuments.saleId, saleId), storeCondition(ctx, sales.storeId)));
      return doc ? toView(doc.d) : null;
    });
  }

  async list(ctx: RequestContext, status?: string) {
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select({ d: fiscalDocuments })
          .from(fiscalDocuments)
          .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
          .where(
            and(
              storeCondition(ctx, sales.storeId),
              status ? eq(fiscalDocuments.status, status as never) : undefined,
            ),
          )
          .orderBy(desc(fiscalDocuments.createdAt))
          .limit(200)
      ).map((r) => toView(r.d)),
    );
  }

  async xml(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id));
      if (!doc) throw notFound('Documento fiscal');
      if (!doc.nfeProc) {
        throw new AppError(409, 'not_authorized', 'A nota ainda não foi autorizada pela SEFAZ.');
      }
      return { accessKey: doc.accessKey!, xml: doc.nfeProc };
    });
  }

  /** Tentar de novo a pedido de alguém (depois de configurar o que faltava, por exemplo). */
  async retry(ctx: RequestContext, id: string) {
    const doc = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id));
      if (!row) throw notFound('Documento fiscal');
      if (row.status === 'authorized' || row.status === 'denied') {
        throw new AppError(409, 'already_final', 'Esta nota já tem resposta final da SEFAZ.');
      }
      // Rejeitada: a nota será montada de novo com os dados corrigidos (mesma chave e número).
      await tx
        .update(fiscalDocuments)
        .set({
          status: 'pending',
          signedXml: row.status === 'rejected' ? null : row.signedXml,
          updatedAt: new Date(),
        })
        .where(eq(fiscalDocuments.id, id));
      return row;
    });
    await this.emit(ctx, doc.id).catch(() => undefined);
    return await withTenant(this.db, ctx, (tx) =>
      tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)),
    ).then(([row]) => toView(row!));
  }
}

@Controller()
export class NfceEmissionController {
  constructor(@Inject(NfceEmissionService) private readonly emission: NfceEmissionService) {}

  @Get('sales/:id/fiscal')
  @RequirePermission('catalog.read')
  forSale(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.emission.forSale(ctx, id);
  }

  /** ?status=not_configured|error|rejected|... */
  @Get('fiscal/documents')
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.emission.list(ctx, status);
  }

  @Get('fiscal/documents/:id/xml')
  @RequirePermission('catalog.read')
  async xml(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, xml } = await this.emission.xml(ctx, id);
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="NFCe${accessKey}.xml"`);
    return new StreamableFile(Buffer.from(xml, 'utf8'));
  }

  @Post('fiscal/documents/:id/retry')
  @HttpCode(200)
  @RequirePermission('catalog.write')
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.emission.retry(ctx, id);
  }
}
