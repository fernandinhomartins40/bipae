import {
  Body,
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
import { nfseCancelInput, uuidv7, type NfseDocumentView } from '@bipae/domain';
import {
  brasiliaDateTime,
  buildDps,
  buildNfseCancelRequest,
  nfseEventRequest,
  parseNfseEventResponse,
  danfseRequest,
  dpsId,
  dpsQueryRequest,
  issRateRequest,
  municipalAgreementRequest,
  parseIssRateResponse,
  nfseEmitRequest,
  nfseQueryRequest,
  parseDpsQueryResponse,
  parseMunicipalAgreementResponse,
  parseMunicipalRfbDefault,
  parseNfseEmitResponse,
  signFiscalXml,
  type DpsInput,
  type NfseRequest,
} from '@bipae/fiscal';
import { findMunicipio } from '@bipae/fiscal/tables/municipios';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { canUseStore } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  companyCertificates,
  customers,
  nfseDocuments,
  serviceOrderItems,
  serviceOrders,
  services,
  stores,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from './certificates.service';
import type { NfseTransport } from './nfse.transport';

export const NFSE_TRANSPORT = Symbol('NFSE_TRANSPORT');
export const NFSE_EMIT_JOB = 'nfse.emit';
export const NFSE_CANCEL_JOB = 'nfse.cancel';
const APP_VERSION = 'Bipaê 1.0';
const lineTotal = (priceCents: number, milli: number) => Math.round((priceCents * milli) / 1000);

type Doc = typeof nfseDocuments.$inferSelect;
const view = (d: Doc): NfseDocumentView => ({
  id: d.id,
  serviceOrderId: d.serviceOrderId,
  series: d.series,
  number: d.number,
  status: d.status,
  pendingItems: d.pendingItems,
  errors: d.errors,
  accessKey: d.accessKey,
  lastError: d.lastError,
  authorizedAt: d.authorizedAt?.toISOString() ?? null,
  cancellation:
    d.cancelStatus && d.cancelCode
      ? {
          status: d.cancelStatus,
          code: d.cancelCode,
          reason: d.cancelReason ?? '',
          errors: d.cancelErrors,
          lastError: d.cancelLastError,
          cancelledAt: d.cancelledAt?.toISOString() ?? null,
        }
      : null,
});

const jobContext = (tenantId: string, userId: string): RequestContext => ({
  tenantId,
  userId,
  permissions: [],
  terminalId: null,
  storeIds: null,
});

/**
 * NFS-e Nacional da ordem de serviço (F5-13.d). Os serviços da OS (as peças ficam de fora: são
 * mercadoria, vão em NF-e ou NFC-e) viram a DPS, com o próximo número da série da empresa. A fila
 * consulta o convênio do município, assina com o A1 e manda à Sefin Nacional (produção restrita);
 * antes de reenviar, pergunta pela DPS, para nunca gerar duas notas. Falta de configuração não é
 * erro: a nota fica em "falta configurar", com a lista do que resolver.
 */
@Injectable()
export class NfseService implements OnModuleInit {
  private readonly logger = new Logger('NFS-e');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(NFSE_TRANSPORT) private transport: NfseTransport,
  ) {}

  onModuleInit() {
    this.queue.process(NFSE_EMIT_JOB, async (data) => {
      const { tenantId, documentId, userId } = data as {
        tenantId: string;
        documentId: string;
        userId: string;
      };
      await this.emit(jobContext(tenantId, userId), documentId);
    });
    this.queue.process(NFSE_CANCEL_JOB, async (data) => {
      const { tenantId, documentId, userId } = data as {
        tenantId: string;
        documentId: string;
        userId: string;
      };
      await this.sendCancel(jobContext(tenantId, userId), documentId);
    });
  }

  /**
   * Cancelamento da NFS-e (F5-13.g): só da nota gerada pela Sefin, um pedido por nota. O prazo e o
   * valor-limite são do município (E0822, E0823): a recusa volta com a explicação da Sefin. A OS e
   * a conta a receber continuam; se o serviço não foi prestado, cancele-as também.
   */
  async cancel(ctx: RequestContext, orderId: string, body: unknown): Promise<NfseDocumentView> {
    const input = parse(nfseCancelInput, body);
    const id = await withTenant(this.db, ctx, async (tx) => {
      await this.loadOrder(tx, ctx, orderId);
      const [doc] = await tx
        .select()
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, orderId));
      if (!doc || doc.status !== 'authorized' || !doc.accessKey) {
        throw new AppError(409, 'not_authorized', 'Só dá para cancelar a NFS-e gerada pela Sefin.');
      }
      if (doc.cancelStatus && doc.cancelStatus !== 'rejected') {
        throw new AppError(409, 'cancel_requested', 'O cancelamento desta NFS-e já foi pedido.');
      }
      await tx
        .update(nfseDocuments)
        .set({
          cancelStatus: 'pending',
          cancelCode: input.code,
          cancelReason: input.reason,
          cancelErrors: [],
          cancelLastError: null,
          cancelSigned: null,
          cancelRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(nfseDocuments.id, doc.id));
      await this.audit.record(tx, ctx, {
        action: 'nfse.cancel_requested',
        entity: 'service_order',
        entityId: orderId,
        data: { accessKey: doc.accessKey, code: input.code, reason: input.reason },
      });
      return doc.id;
    });
    await this.queue.add(
      NFSE_CANCEL_JOB,
      { tenantId: ctx.tenantId, documentId: id, userId: ctx.userId },
      { attempts: 6, backoffMs: 2000 },
    );
    return (await this.forOrder(ctx, orderId))!;
  }

  private async sendCancel(ctx: RequestContext, documentId: string) {
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx.select().from(nfseDocuments).where(eq(nfseDocuments.id, documentId));
      if (!doc || !doc.accessKey || !['pending', 'error'].includes(doc.cancelStatus ?? '')) {
        return null;
      }
      const [company] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
      if (!company?.taxId) throw notFound('Empresa');
      // Assinado uma vez: as novas tentativas mandam o mesmo pedido.
      const signed =
        doc.cancelSigned ??
        (await signFiscalXml(
          buildNfseCancelRequest({
            accessKey: doc.accessKey,
            cnpj: company.taxId,
            code: doc.cancelCode!,
            reason: doc.cancelReason!,
            at: brasiliaDateTime(new Date().toISOString()),
          }),
          'pedRegEvento',
          'infPedReg',
          await this.certificates.signingKey(tx, doc.companyId),
        ));
      await tx
        .update(nfseDocuments)
        .set({
          cancelSigned: signed,
          cancelAttempts: doc.cancelAttempts + 1,
          updatedAt: new Date(),
        })
        .where(eq(nfseDocuments.id, doc.id));
      return {
        doc,
        signed,
        credentials: await this.certificates.tlsCredentials(tx, doc.companyId),
      };
    });
    if (!prepared) return;
    const { doc, signed, credentials } = prepared;
    try {
      const res = await this.call(await nfseEventRequest(doc.accessKey!, signed), credentials);
      const result = await parseNfseEventResponse(res.status, res.body);
      if (result.outcome === 'registered') {
        await withTenant(this.db, ctx, async (tx) => {
          await tx
            .update(nfseDocuments)
            .set({
              status: 'cancelled',
              cancelStatus: 'registered',
              cancelEventXml: result.eventXml,
              cancelledAt: new Date(),
              cancelLastError: null,
              cancelErrors: [],
              updatedAt: new Date(),
            })
            .where(eq(nfseDocuments.id, doc.id));
          await this.audit.record(tx, ctx, {
            action: 'nfse.cancelled',
            entity: 'service_order',
            entityId: doc.serviceOrderId,
            data: { accessKey: doc.accessKey },
          });
        });
        return;
      }
      await this.patch(ctx, doc.id, {
        cancelStatus: 'rejected',
        cancelErrors: result.errors,
        cancelLastError: null,
      });
    } catch (error) {
      // Sefin fora ou resposta fora do formato: a fila tenta de novo com o mesmo pedido.
      await this.patch(ctx, doc.id, {
        cancelStatus: 'error',
        cancelLastError: (error as Error).message,
      });
      this.logger.warn(`Cancelamento da NFS-e ${doc.accessKey}: ${(error as Error).message}`);
      throw error;
    }
  }

  private async loadOrder(tx: Tx, ctx: RequestContext, orderId: string) {
    const [order] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, orderId));
    if (!order || !canUseStore(ctx, order.storeId)) throw notFound('Ordem de serviço');
    return order;
  }

  /** Emite a NFS-e da OS: toma o próximo número da série da empresa e põe na fila. */
  async issue(ctx: RequestContext, orderId: string): Promise<NfseDocumentView> {
    const documentId = await withTenant(this.db, ctx, async (tx) => {
      const order = await this.loadOrder(tx, ctx, orderId);
      if (order.status === 'cancelled') {
        throw new AppError(409, 'service_order_cancelled', 'A OS foi cancelada.');
      }
      const [existing] = await tx
        .select({ id: nfseDocuments.id })
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, order.id));
      if (existing) throw new AppError(409, 'nfse_exists', 'Esta OS já tem NFS-e.');
      const lines = await tx
        .select()
        .from(serviceOrderItems)
        .where(and(eq(serviceOrderItems.orderId, order.id), eq(serviceOrderItems.kind, 'service')));
      if (lines.length === 0) {
        throw new AppError(
          422,
          'nfse_no_service',
          'A OS não tem serviço para a NFS-e (peças vão em NF-e ou NFC-e).',
        );
      }
      const [store] = await tx
        .select({ companyId: stores.companyId })
        .from(stores)
        .where(eq(stores.id, order.storeId));
      const [taken] = await tx
        .update(companies)
        .set({ nfseNextNumber: sql`${companies.nfseNextNumber} + 1` })
        .where(eq(companies.id, store!.companyId))
        .returning({
          series: companies.nfseSeries,
          next: companies.nfseNextNumber,
          cityCode: companies.cityCode,
          taxId: companies.taxId,
        });
      const number = taken!.next - 1;
      const id = uuidv7();
      await tx.insert(nfseDocuments).values({
        id,
        tenantId: ctx.tenantId,
        companyId: store!.companyId,
        serviceOrderId: order.id,
        series: taken!.series,
        number,
        // Sem município ou CNPJ, o Id sai com zeros; a nota fica em "falta configurar" até corrigir.
        dpsId: dpsId({
          cityCode: taken!.cityCode ?? '0000000',
          taxId: (taken!.taxId ?? '').replace(/\D/g, '') || '0',
          series: taken!.series,
          number,
        }),
        createdBy: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'nfse.issued',
        entity: 'service_order',
        entityId: order.id,
        data: { series: taken!.series, number },
      });
      return id;
    });
    await this.schedule(ctx.tenantId, ctx.userId, documentId);
    return this.forOrder(ctx, orderId).then((v) => v!);
  }

  async schedule(tenantId: string, userId: string, documentId: string) {
    await this.queue.add(
      NFSE_EMIT_JOB,
      { tenantId, documentId, userId },
      { attempts: 6, backoffMs: 2000 },
    );
  }

  private async patch(ctx: RequestContext, id: string, values: Partial<Doc>) {
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(nfseDocuments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(nfseDocuments.id, id)),
    );
  }

  private async call(request: NfseRequest, credentials: { key: string; cert: string }) {
    return this.transport.send(request, credentials);
  }

  /** Os dados da DPS a partir da OS, da empresa e do cliente. */
  private async dpsInput(
    tx: Tx,
    doc: Doc,
    agreement: boolean | null,
    rfbDefault: boolean | null = null,
  ): Promise<DpsInput> {
    const [order] = await tx
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, doc.serviceOrderId));
    const [company] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
    const [customer] = await tx.select().from(customers).where(eq(customers.id, order!.customerId));
    const lines = await tx
      .select()
      .from(serviceOrderItems)
      .where(and(eq(serviceOrderItems.orderId, order!.id), eq(serviceOrderItems.kind, 'service')));
    const registered = lines.length
      ? await tx
          .select()
          .from(services)
          .where(
            inArray(
              services.id,
              lines.map((l) => l.serviceId!),
            ),
          )
      : [];
    const codes = [...new Set(registered.map((s) => s.code))];
    const rates = [...new Set(registered.map((s) => s.issRate ?? ''))];
    const a = (customer?.address ?? null) as {
      cep?: string;
      street?: string;
      number?: string;
      complement?: string | null;
      district?: string;
      ibgeCode?: string | null;
    } | null;
    return {
      issuer: {
        taxId: company!.taxId,
        municipalRegistration: company!.municipalRegistration,
        phone: company!.phone,
        cityCode: company!.cityCode,
        regime: company!.taxRegime,
      },
      series: doc.series,
      number: doc.number,
      issuedAt: doc.issuedAt.toISOString(),
      competence: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
        order!.deliveredAt ?? doc.issuedAt,
      ),
      taker: customer?.taxId
        ? {
            taxId: customer.taxId,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: a
              ? {
                  cityCode: a.ibgeCode ?? null,
                  cep: a.cep ?? null,
                  street: a.street ?? null,
                  number: a.number ?? null,
                  complement: a.complement ?? null,
                  district: a.district ?? null,
                }
              : null,
          }
        : null,
      service: {
        // Uma DPS leva um código de serviço: com códigos diferentes, o motor pede para separar.
        code: codes.length === 1 ? codes[0]! : '',
        description: lines.map((l) => l.description).join('; '),
        nbs: registered.length === 1 ? registered[0]!.nbs : null,
        placeCityCode: company!.cityCode,
      },
      valueCents: lines.reduce((t, l) => t + lineTotal(l.unitPriceCents, l.quantityMilli), 0),
      iss: {
        rate: rates.length === 1 ? rates[0] || null : null,
        municipalAgreementActive: agreement,
        municipalRfbDefault: rfbDefault,
      },
      approximateTaxes: {
        simplesPercent: company!.nfseSimplesPercent,
        federal: company!.nfseTaxFederal,
        state: company!.nfseTaxState,
        municipal: company!.nfseTaxMunicipal,
      },
      appVersion: APP_VERSION,
    };
  }

  async emit(ctx: RequestContext, documentId: string): Promise<void> {
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx.select().from(nfseDocuments).where(eq(nfseDocuments.id, documentId));
      if (!doc) throw new Error('NFS-e ainda não disponível.');
      if (!['pending', 'error', 'not_configured', 'rejected'].includes(doc.status)) return null;
      const [company] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
      try {
        return {
          doc,
          cityCode: company?.cityCode ?? null,
          key: await this.certificates.signingKey(tx, doc.companyId),
          credentials: await this.certificates.tlsCredentials(tx, doc.companyId),
        };
      } catch (error) {
        if (error instanceof AppError) return { doc, pending: [error.message] };
        throw error;
      }
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
    const { credentials } = prepared;
    await this.patch(ctx, doc.id, { attempts: doc.attempts + 1 });
    try {
      // Já houve tentativa: a DPS pode ter virado NFS-e sem a resposta chegar.
      if (doc.attempts > 0) {
        const query = await this.call(dpsQueryRequest(doc.dpsId), credentials);
        const key = parseDpsQueryResponse(query.status, query.body);
        if (key) {
          const found = await this.call(nfseQueryRequest(key), credentials);
          const result = await parseNfseEmitResponse(found.status, found.body);
          if (result.outcome === 'authorized') {
            await this.patch(ctx, doc.id, {
              status: 'authorized',
              accessKey: result.accessKey,
              nfseXml: result.nfseXml,
              authorizedAt: new Date(),
              lastError: null,
              pendingItems: [],
              errors: [],
            });
            return;
          }
        }
      }
      // O convênio do município decide se a alíquota vai na DPS e se a inscrição municipal é
      // obrigatória (regra E0084).
      let agreement: boolean | null = null;
      let rfbDefault: boolean | null = null;
      if (prepared.cityCode) {
        const res = await this.call(municipalAgreementRequest(prepared.cityCode), credentials);
        agreement = parseMunicipalAgreementResponse(res.status, res.body);
        rfbDefault = parseMunicipalRfbDefault(res.status, res.body);
      }
      const built = await withTenant(this.db, ctx, async (tx) => {
        const input = await this.dpsInput(tx, doc, agreement, rfbDefault);
        const result = buildDps(input);
        if (!result.ok && !input.service.code) {
          return {
            ok: false as const,
            pending: [
              'Os serviços da OS têm códigos diferentes na lista nacional: uma NFS-e leva um código só.',
              ...result.pending.filter((p) => !p.startsWith('Escolha o serviço')),
            ],
          };
        }
        return result;
      });
      if (!built.ok) {
        await this.patch(ctx, doc.id, {
          status: 'not_configured',
          pendingItems: built.pending,
          lastError: null,
        });
        return;
      }
      const signed = await signFiscalXml(built.xml, 'DPS', 'infDPS', prepared.key);
      await this.patch(ctx, doc.id, { signedDps: signed, pendingItems: [] });
      const res = await this.call(await nfseEmitRequest(signed), credentials);
      const result = await parseNfseEmitResponse(res.status, res.body);
      if (result.outcome === 'authorized') {
        await this.patch(ctx, doc.id, {
          status: 'authorized',
          accessKey: result.accessKey,
          nfseXml: result.nfseXml,
          authorizedAt: new Date(),
          lastError: null,
          errors: [],
        });
        return;
      }
      await this.patch(ctx, doc.id, { status: 'rejected', errors: result.errors, lastError: null });
    } catch (error) {
      // Sefin fora ou resposta fora do formato: fica marcada e a fila tenta de novo.
      await this.patch(ctx, doc.id, { status: 'error', lastError: (error as Error).message });
      this.logger.warn(`NFS-e ${doc.dpsId}: ${(error as Error).message}`);
      throw error;
    }
  }

  forOrder(ctx: RequestContext, orderId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.loadOrder(tx, ctx, orderId);
      const [doc] = await tx
        .select()
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, orderId));
      return doc ? view(doc) : null;
    });
  }

  async retry(ctx: RequestContext, orderId: string) {
    const id = await withTenant(this.db, ctx, async (tx) => {
      await this.loadOrder(tx, ctx, orderId);
      const [doc] = await tx
        .select()
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, orderId));
      if (!doc) throw new AppError(409, 'nfse_missing', 'Esta OS ainda não tem NFS-e.');
      if (doc.status === 'authorized') {
        throw new AppError(409, 'already_final', 'Esta NFS-e já foi gerada pela Sefin.');
      }
      await tx
        .update(nfseDocuments)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(nfseDocuments.id, doc.id));
      return doc.id;
    });
    await this.emit(ctx, id).catch(() => undefined);
    return this.forOrder(ctx, orderId);
  }

  /** DANFSE em PDF, do ADN (a API busca com o certificado da empresa e repassa). */
  async danfse(ctx: RequestContext, orderId: string) {
    const { doc, credentials } = await withTenant(this.db, ctx, async (tx) => {
      await this.loadOrder(tx, ctx, orderId);
      const [row] = await tx
        .select()
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, orderId));
      if (!row?.accessKey || row.status !== 'authorized') {
        throw new AppError(409, 'not_authorized', 'A NFS-e ainda não foi gerada pela Sefin.');
      }
      return { doc: row, credentials: await this.certificates.tlsCredentials(tx, row.companyId) };
    });
    const res = await this.call(danfseRequest(doc.accessKey!), credentials).catch(() => null);
    if (!res || res.status !== 200 || !res.bytes.subarray(0, 5).toString().startsWith('%PDF')) {
      throw new AppError(
        502,
        'danfse_unavailable',
        'O Ambiente Nacional não devolveu o DANFSE agora. Tente de novo em instantes.',
      );
    }
    return { accessKey: doc.accessKey!, pdf: res.bytes };
  }

  /**
   * A alíquota do ISSQN que a prefeitura cadastrou no Sistema Nacional para o serviço, na
   * competência de hoje, com o certificado da empresa (ADN Parâmetros Municipais). Para o cadastro
   * do serviço não depender de o dono saber o número.
   */
  async issRate(ctx: RequestContext, code: string, companyId?: string) {
    const { company, credentials } = await withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ id: companies.id, cityCode: companies.cityCode })
        .from(companies)
        .innerJoin(companyCertificates, eq(companyCertificates.companyId, companies.id))
        .where(companyId ? eq(companies.id, companyId) : sql`true`);
      const found = rows.find((r) => r.cityCode);
      if (!found) {
        throw new AppError(
          400,
          'iss_rate_unavailable',
          'Para buscar a alíquota, a empresa precisa do município e do certificado digital A1.',
        );
      }
      return {
        company: found,
        credentials: await this.certificates.tlsCredentials(tx, found.id),
      };
    });
    // A competência é o dia de hoje em Brasília (AAAA-MM-DD).
    const competence = brasiliaDateTime(new Date().toISOString()).slice(0, 10);
    let request: NfseRequest;
    try {
      request = issRateRequest(company.cityCode!, code, competence);
    } catch (error) {
      throw new AppError(422, 'invalid_service_code', (error as Error).message);
    }
    const res = await this.call(request, credentials).catch(() => null);
    if (!res) {
      throw new AppError(
        502,
        'iss_rate_unavailable',
        'O Sistema Nacional NFS-e não respondeu agora. Tente de novo em instantes.',
      );
    }
    const answer = parseIssRateResponse(res.status, res.body, competence);
    return {
      cityCode: company.cityCode,
      city: findMunicipio(company.cityCode!)?.name ?? null,
      competence,
      rate: answer.rate,
      message: answer.rate
        ? null
        : 'A prefeitura não cadastrou a alíquota deste serviço no Sistema Nacional. Confira com ela e informe no campo.',
      apiMessage: answer.message,
    };
  }

  xml(ctx: RequestContext, orderId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.loadOrder(tx, ctx, orderId);
      const [doc] = await tx
        .select()
        .from(nfseDocuments)
        .where(eq(nfseDocuments.serviceOrderId, orderId));
      if (!doc?.nfseXml)
        throw new AppError(409, 'not_authorized', 'A NFS-e ainda não foi gerada pela Sefin.');
      return { accessKey: doc.accessKey!, xml: doc.nfseXml };
    });
  }
}

@Controller('fiscal/nfse')
export class NfseParamsController {
  constructor(@Inject(NfseService) private readonly nfse: NfseService) {}

  /** Alíquota do ISSQN do serviço na prefeitura: ?code=170601 (e, se houver, &companyId=). */
  @Get('iss-rate')
  @RequirePermission('catalog.read')
  issRate(
    @Ctx() ctx: RequestContext,
    @Query('code') code?: string,
    @Query('companyId') companyId?: string,
  ) {
    if (!code) throw new AppError(422, 'invalid_service_code', 'Informe o código do serviço.');
    if (companyId && !/^[0-9a-f-]{36}$/i.test(companyId)) throw notFound('Empresa');
    return this.nfse.issRate(ctx, code, companyId);
  }
}

@Controller('service-orders')
export class NfseController {
  constructor(@Inject(NfseService) private readonly nfse: NfseService) {}

  @Post(':id/nfse')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  issue(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.nfse.issue(ctx, id);
  }

  @Get(':id/nfse')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.nfse.forOrder(ctx, id);
  }

  @Post(':id/nfse/cancel')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.nfse.cancel(ctx, id, body);
  }

  @Post(':id/nfse/retry')
  @HttpCode(200)
  @RequirePermission('fiscal.profile.write')
  retry(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.nfse.retry(ctx, id);
  }

  @Get(':id/nfse/danfse')
  @RequirePermission('pos.sell')
  async danfse(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, pdf } = await this.nfse.danfse(ctx, id);
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="DANFSE-${accessKey}.pdf"`);
    return new StreamableFile(pdf);
  }

  @Get(':id/nfse/xml')
  @RequirePermission('pos.sell')
  async xml(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, xml } = await this.nfse.xml(ctx, id);
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="NFSe${accessKey}.xml"`);
    return new StreamableFile(Buffer.from(xml, 'utf8'));
  }
}
