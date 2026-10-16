import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Post,
  Query,
  type OnModuleInit,
} from '@nestjs/common';
import {
  inutilizationInput,
  uuidv7,
  type InutilizationView,
  type NumberingGapView,
} from '@bipae/domain';
import {
  brasiliaDateTime,
  buildCancelEvent,
  buildInutilization,
  signFiscalXml,
  type FiscalEventResult,
} from '@bipae/fiscal';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  fiscalDocuments,
  fiscalEvents,
  fiscalInutilizations,
  sales,
  terminals,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { MercadoflowSales } from '../mercadoflow/mercadoflow.sales';
import { CertificatesService } from './certificates.service';
import { NfceEmissionService, rejectionHelp } from './nfce-emission.service';
import { SefazService } from './sefaz.service';

export const NFCE_CANCEL_JOB = 'nfce.cancel';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const CANCEL = '110111';
/** 573: o evento já estava registrado; 218: a nota já estava cancelada. Nos dois, está feito. */
const ALREADY_CANCELLED = new Set(['573', '218']);
/** 563: a mesma faixa já tinha sido inutilizada. */
const ALREADY_INUTILIZED = new Set(['563']);

const jobContext = (tenantId: string, userId: string): RequestContext => ({
  tenantId,
  userId,
  permissions: [],
  terminalId: null,
  storeIds: null,
});

/** A justificativa da SEFAZ tem de 15 a 255 caracteres; o motivo do caixa pode ser curto. */
export const cancelJustification = (reason: string) =>
  `Venda cancelada no caixa: ${reason.trim()}`.slice(0, 255);

const inutilizationView = (r: typeof fiscalInutilizations.$inferSelect): InutilizationView => ({
  id: r.id,
  companyId: r.companyId,
  model: r.model,
  series: r.series,
  from: r.numberFrom,
  to: r.numberTo,
  year: r.year,
  reason: r.reason,
  status: r.status,
  cStat: r.cStat,
  xMotivo: r.xMotivo,
  protocol: r.protocol,
  help: r.status === 'rejected' ? rejectionHelp(r.cStat, r.xMotivo) : null,
  createdAt: r.createdAt.toISOString(),
});

/** Ano (2 dígitos) no horário de Brasília. */
const brasiliaYear = (at: Date) => brasiliaDateTime(at.toISOString()).slice(2, 4);

/**
 * Cancelamento da NFC-e e inutilização de numeração (F3-17), só em homologação.
 *
 * Venda cancelada no caixa:
 * - nota autorizada: vai o evento de cancelamento (110111). Fora do prazo, a SEFAZ recusa (501)
 *   e a nota continua valendo; a tela explica o que fazer (devolução).
 * - nota que o servidor ainda não mandou: deixa de ser emitida ("voided") e o número vai para a
 *   inutilização. Se já houve tentativa, consulta pela chave antes, porque ela pode ter sido
 *   autorizada sem a resposta chegar.
 * - nota que o caixa assinou em contingência: é transmitida (o cupom já saiu) e depois cancelada.
 * O cancelamento fiscal nunca impede o cancelamento da venda: roda depois, em segundo plano.
 */
@Injectable()
export class FiscalEventsService implements OnModuleInit {
  private readonly logger = new Logger('NFC-e');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SefazService) private readonly sefaz: SefazService,
    @Inject(NfceEmissionService) private readonly emission: NfceEmissionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowSales) private readonly mercadoflow: MercadoflowSales,
  ) {}

  onModuleInit() {
    this.queue.process(NFCE_CANCEL_JOB, async (data) => {
      const { tenantId, documentId, userId } = data as {
        tenantId: string;
        documentId: string;
        userId: string;
      };
      await this.cancel(jobContext(tenantId, userId), documentId);
    });
  }

  /** Na transação do cancelamento da venda: marca a nota; a tarefa vem depois do commit. */
  async requestCancel(tx: Tx, saleId: string, reason: string): Promise<string | null> {
    const [doc] = await tx
      .update(fiscalDocuments)
      .set({ cancelRequestedAt: new Date(), cancelReason: reason, updatedAt: new Date() })
      .where(and(eq(fiscalDocuments.saleId, saleId), isNull(fiscalDocuments.cancelRequestedAt)))
      .returning({ id: fiscalDocuments.id });
    return doc?.id ?? null;
  }

  async schedule(tenantId: string, userId: string, documentId: string) {
    await this.queue.add(
      NFCE_CANCEL_JOB,
      { tenantId, documentId, userId },
      { attempts: 6, backoffMs: 2000 },
    );
  }

  private document(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [doc] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id));
      return doc ?? null;
    });
  }

  private async voidDocument(ctx: RequestContext, id: string) {
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(fiscalDocuments)
        .set({ status: 'voided', lastError: null, updatedAt: new Date() })
        .where(eq(fiscalDocuments.id, id)),
    );
  }

  async cancel(ctx: RequestContext, documentId: string): Promise<void> {
    let doc = await this.document(ctx, documentId);
    if (!doc) throw new Error('Documento fiscal ainda não disponível.');
    if (!doc.cancelRequestedAt) return;
    if (['cancelled', 'voided', 'denied'].includes(doc.status)) return;

    if (doc.status !== 'authorized') {
      if (doc.origin === 'terminal') {
        // O cupom de contingência já foi entregue: a nota precisa chegar à SEFAZ.
        await this.emission.emit(ctx, doc.id);
        doc = (await this.document(ctx, doc.id))!;
        if (doc.status !== 'authorized') return;
      } else if (doc.accessKey && doc.signedXml && doc.attempts > 0) {
        const consult = await this.sefaz.consult(ctx, doc.companyId, doc.accessKey);
        if (!(consult.protocol && consult.outcome === 'authorized')) {
          await this.voidDocument(ctx, doc.id);
          return;
        }
        await this.emission.finish(ctx, doc.id, doc.signedXml, consult.protocol);
        doc = (await this.document(ctx, doc.id))!;
      } else {
        await this.voidDocument(ctx, doc.id);
        return;
      }
    }
    await this.sendCancel(ctx, doc);
  }

  private async sendCancel(ctx: RequestContext, doc: typeof fiscalDocuments.$inferSelect) {
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const [existing] = await tx
        .select()
        .from(fiscalEvents)
        .where(and(eq(fiscalEvents.documentId, doc.id), eq(fiscalEvents.type, CANCEL)));
      if (existing && (existing.status === 'registered' || existing.status === 'rejected')) {
        return null;
      }
      const reason = cancelJustification(doc.cancelReason ?? 'cancelamento');
      const event =
        existing ??
        (
          await tx
            .insert(fiscalEvents)
            .values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              documentId: doc.id,
              type: CANCEL,
              reason,
            })
            .returning()
        )[0]!;
      const [company] = await tx.select().from(companies).where(eq(companies.id, doc.companyId));
      if (!company?.taxId) throw notFound('Empresa');
      const key = await this.certificates.signingKey(tx, doc.companyId);
      const signed = await signFiscalXml(
        buildCancelEvent({
          accessKey: doc.accessKey!,
          cnpj: company.taxId,
          protocol: doc.protocol!,
          reason: event.reason,
          at: brasiliaDateTime(new Date().toISOString()),
        }),
        'evento',
        'infEvento',
        key,
      );
      await tx
        .update(fiscalEvents)
        .set({ signedXml: signed, attempts: event.attempts + 1, updatedAt: new Date() })
        .where(eq(fiscalEvents.id, event.id));
      return { event, signed };
    });
    if (!prepared) return;
    const { event, signed } = prepared;

    let result: FiscalEventResult;
    try {
      result = await this.sefaz.event(ctx, doc.companyId, '65', signed);
    } catch (error) {
      await this.updateEvent(ctx, event.id, {
        status: 'error',
        lastError: (error as Error).message,
      });
      this.logger.warn(`Cancelamento da NFC-e ${doc.accessKey}: ${(error as Error).message}`);
      throw error;
    }
    const done = result.registered || ALREADY_CANCELLED.has(result.cStat);
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .update(fiscalEvents)
        .set({
          status: done ? 'registered' : 'rejected',
          cStat: result.cStat,
          xMotivo: result.xMotivo,
          protocol: result.protocol ?? null,
          procXml: result.xml
            ? `<procEventoNFe versao="1.00" xmlns="${NFE_NS}">${signed}${result.xml}</procEventoNFe>`
            : null,
          registeredAt: done ? new Date() : null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(fiscalEvents.id, event.id));
      if (done) {
        await tx
          .update(fiscalDocuments)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(fiscalDocuments.id, doc.id));
        // MF-08: o cancelamento vai ao MercadoFlow depois da venda.
        const [sale] = await tx
          .select({ storeId: sales.storeId })
          .from(sales)
          .where(eq(sales.id, doc.saleId));
        if (sale && doc.accessKey) {
          await this.mercadoflow.enqueueCancel(
            tx,
            ctx.tenantId,
            sale.storeId,
            doc.accessKey,
            doc.nfeProc ? doc.nfeProc.includes('<tpAmb>2</tpAmb>') : true,
          );
        }
      }
    });
  }

  private async updateEvent(
    ctx: RequestContext,
    id: string,
    patch: Partial<typeof fiscalEvents.$inferInsert>,
  ) {
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(fiscalEvents)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(fiscalEvents.id, id)),
    );
  }

  // ------------------------------------------------------------ inutilização

  /**
   * Números de cada série que ficaram sem nota (devolução, venda cancelada antes de emitir,
   * evento recusado) entre a primeira e a última nota transmitida, tirando o que já foi
   * inutilizado. Os eventos do caixa chegam em ordem, então um número abaixo da última nota
   * transmitida que não tem nota não vai mais ganhar uma.
   */
  private async occupation(tx: Tx, companyId: string) {
    const rows = await tx
      .select({
        number: fiscalDocuments.number,
        series: fiscalDocuments.series,
        seq: sales.terminalSeq,
        terminalSeries: terminals.nfceSeries,
        status: fiscalDocuments.status,
      })
      .from(fiscalDocuments)
      .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
      .innerJoin(terminals, eq(terminals.id, sales.terminalId))
      .where(and(eq(fiscalDocuments.companyId, companyId), eq(fiscalDocuments.model, '65')));
    const done = await tx
      .select()
      .from(fiscalInutilizations)
      .where(
        and(
          eq(fiscalInutilizations.companyId, companyId),
          eq(fiscalInutilizations.model, '65'),
          eq(fiscalInutilizations.status, 'registered'),
        ),
      );
    const bySeries = new Map<
      number,
      { occupied: Set<number>; transmitted: number[]; inutilized: [number, number][] }
    >();
    const entry = (series: number) => {
      let e = bySeries.get(series);
      if (!e) {
        e = { occupied: new Set(), transmitted: [], inutilized: [] };
        bySeries.set(series, e);
      }
      return e;
    };
    for (const r of rows) {
      const series = r.series ?? r.terminalSeries;
      const number = r.number ?? r.seq;
      if (r.status === 'voided') continue;
      const e = entry(series);
      e.occupied.add(number);
      if (['authorized', 'cancelled', 'denied'].includes(r.status)) e.transmitted.push(number);
    }
    for (const i of done) entry(i.series).inutilized.push([i.numberFrom, i.numberTo]);
    return bySeries;
  }

  async gaps(ctx: RequestContext, companyId: string): Promise<NumberingGapView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const gaps: NumberingGapView[] = [];
      const bySeries = await this.occupation(tx, companyId);
      for (const [series, e] of [...bySeries].sort((a, b) => a[0] - b[0])) {
        if (e.transmitted.length === 0) continue;
        const low = Math.min(...e.transmitted);
        const high = Math.max(...e.transmitted);
        const taken = (n: number) =>
          e.occupied.has(n) || e.inutilized.some(([a, b]) => n >= a && n <= b);
        let start: number | null = null;
        for (let n = low; n <= high + 1; n++) {
          if (n <= high && !taken(n)) {
            start ??= n;
          } else if (start !== null) {
            gaps.push({ model: '65', series, from: start, to: n - 1 });
            start = null;
          }
        }
      }
      return gaps;
    });
  }

  async inutilize(ctx: RequestContext, body: unknown): Promise<InutilizationView> {
    const input = parse(inutilizationInput, body);
    const year = brasiliaYear(new Date());
    const signed = await withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId));
      if (!company) throw notFound('Empresa');
      const e = (await this.occupation(tx, input.companyId)).get(input.series);
      const used = [...(e?.occupied ?? [])].filter((n) => n >= input.from && n <= input.to);
      if (used.length > 0) {
        throw new AppError(
          409,
          'number_in_use',
          `O número ${Math.min(...used)} da série ${input.series} tem nota. Inutilize só números sem nota.`,
        );
      }
      if (e?.inutilized.some(([a, b]) => input.from <= b && input.to >= a)) {
        throw new AppError(409, 'already_inutilized', 'Parte desta faixa já foi inutilizada.');
      }
      if (!company.uf) throw new AppError(400, 'missing_uf', 'Falta configurar a UF da empresa.');
      if (!company.taxId) {
        throw new AppError(400, 'missing_tax_id', 'Falta configurar o CNPJ da empresa.');
      }
      const cnpj = company.taxId;
      const key = await this.certificates.signingKey(tx, company.id);
      try {
        return await signFiscalXml(
          buildInutilization({
            uf: company.uf,
            year,
            cnpj,
            model: '65',
            series: input.series,
            from: input.from,
            to: input.to,
            reason: input.reason,
          }),
          'inutNFe',
          'infInut',
          key,
        );
      } catch (error) {
        throw new AppError(400, 'sefaz_message', (error as Error).message);
      }
    });
    // A conversa com a SEFAZ fica fora da transação; falha temporária volta como erro 502.
    const result = await this.sefaz.inutilize(ctx, input.companyId, '65', signed);
    const registered = result.registered || ALREADY_INUTILIZED.has(result.cStat);
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(fiscalInutilizations)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          model: '65',
          series: input.series,
          numberFrom: input.from,
          numberTo: input.to,
          year,
          reason: input.reason,
          status: registered ? 'registered' : 'rejected',
          cStat: result.cStat,
          xMotivo: result.xMotivo,
          protocol: result.protocol ?? null,
          procXml: result.xml
            ? `<procInutNFe versao="4.00" xmlns="${NFE_NS}">${signed}${result.xml}</procInutNFe>`
            : null,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'fiscal.inutilization',
        entity: 'fiscal_inutilization',
        entityId: row!.id,
        data: {
          companyId: input.companyId,
          series: input.series,
          from: input.from,
          to: input.to,
          reason: input.reason,
          cStat: result.cStat,
        },
      });
      return inutilizationView(row!);
    });
  }

  async inutilizations(ctx: RequestContext, companyId: string): Promise<InutilizationView[]> {
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select()
          .from(fiscalInutilizations)
          .where(eq(fiscalInutilizations.companyId, companyId))
          .orderBy(desc(fiscalInutilizations.createdAt))
          .limit(200)
      ).map(inutilizationView),
    );
  }
}

@Controller()
export class FiscalEventsController {
  constructor(@Inject(FiscalEventsService) private readonly events: FiscalEventsService) {}

  /** Faixas sem nota que precisam ser inutilizadas. */
  @Get('fiscal/inutilizations/gaps')
  @RequirePermission('catalog.read')
  gaps(@Ctx() ctx: RequestContext, @Query('companyId') companyId: string) {
    return this.events.gaps(ctx, parse(inutilizationInput.shape.companyId, companyId));
  }

  @Get('fiscal/inutilizations')
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('companyId') companyId: string) {
    return this.events.inutilizations(ctx, parse(inutilizationInput.shape.companyId, companyId));
  }

  @Post('fiscal/inutilizations')
  @RequirePermission('fiscal.profile.write')
  inutilize(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.events.inutilize(ctx, body);
  }
}
