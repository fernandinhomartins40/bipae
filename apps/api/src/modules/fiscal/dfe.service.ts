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
import { dfeManifestInput, uuidv7, type DfeDocumentView, type DfeSyncResult } from '@bipae/domain';
import {
  brasiliaDateTime,
  buildRecipientEvent,
  signFiscalXml,
  type DistributedDocument,
  type DistributedSummary,
} from '@bipae/fiscal';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, dfeDocuments, purchaseInvoices } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from './certificates.service';
import { SefazService } from './sefaz.service';

export const DFE_SYNC_JOB = 'dfe.sync';
/** O Ambiente Nacional pede uma hora de espera depois de "nenhum documento" (137) e do 656. */
const WAIT_MS = 60 * 60_000;
/** Cada consulta traz até 50 documentos; numa busca, no máximo estas voltas. */
const MAX_ROUNDS = 10;

type Row = typeof dfeDocuments.$inferSelect;

const view = (row: Row, purchaseId: string | null): DfeDocumentView => ({
  id: row.id,
  companyId: row.companyId,
  accessKey: row.accessKey,
  issuerTaxId: row.issuerTaxId,
  issuerName: row.issuerName,
  issuedAt: row.issuedAt?.toISOString() ?? null,
  totalCents: row.totalCents,
  situation: row.situation as DfeDocumentView['situation'],
  hasXml: Boolean(row.procXml),
  manifestation: row.manifestation,
  manifestationStatus: row.manifestationStatus,
  manifestationMessage: row.manifestationMessage,
  purchaseId,
});

/**
 * Notas emitidas contra o CNPJ da empresa (F3-20). A busca pergunta ao Ambiente Nacional pelos
 * documentos depois do último NSU e guarda os resumos e as notas completas. A ciência da operação
 * libera a nota completa; com ela, a compra entra pelo XML (F3-19). A busca roda sozinha de hora
 * em hora (manutenção) e também a pedido.
 */
@Injectable()
export class DfeService implements OnModuleInit {
  private readonly logger = new Logger('DF-e');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SefazService) private readonly sefaz: SefazService,
  ) {}

  onModuleInit() {
    this.queue.process(DFE_SYNC_JOB, async (data) => {
      const { tenantId, companyId } = data as { tenantId: string; companyId: string };
      await this.sync(
        { tenantId, userId: null as never, permissions: [], terminalId: null, storeIds: null },
        companyId,
        { force: false },
      );
    });
  }

  async schedule(tenantId: string, companyId: string) {
    await this.queue.add(
      DFE_SYNC_JOB,
      { tenantId, companyId },
      { attempts: 3, backoffMs: 60_000, dedupeId: `${DFE_SYNC_JOB}:${companyId}` },
    );
  }

  /** Guarda (ou completa) um documento recebido. */
  private async store(tx: Tx, ctx: RequestContext, companyId: string, doc: DistributedDocument) {
    if (doc.kind === 'evento') {
      // Cancelamento pelo emitente: a nota recebida passa a "cancelada".
      if (doc.accessKey && doc.eventType === '110111') {
        await tx
          .update(dfeDocuments)
          .set({ situation: 'cancelada', updatedAt: new Date() })
          .where(
            and(eq(dfeDocuments.companyId, companyId), eq(dfeDocuments.accessKey, doc.accessKey)),
          );
      }
      return 0;
    }
    if (doc.kind === 'outro') return 0;
    const s: DistributedSummary = doc.summary;
    if (!/^\d{44}$/.test(s.accessKey)) return 0;
    const values = {
      nsu: doc.nsu.padStart(15, '0'),
      issuerTaxId: s.issuerTaxId,
      issuerName: s.issuerName,
      issuedAt: s.issuedAt ? new Date(s.issuedAt) : null,
      totalCents: s.totalCents,
      ...(s.situation && { situation: s.situation }),
      ...(doc.kind === 'resumo' ? { summaryXml: doc.xml } : { procXml: doc.xml }),
      updatedAt: new Date(),
    };
    await tx
      .insert(dfeDocuments)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId,
        accessKey: s.accessKey,
        ...values,
      })
      .onConflictDoUpdate({
        target: [dfeDocuments.tenantId, dfeDocuments.companyId, dfeDocuments.accessKey],
        set: values,
      });
    return 1;
  }

  /**
   * Busca no Ambiente Nacional. Sem `force`, respeita a espera de uma hora pedida pela SEFAZ;
   * com ela (o botão da tela), também, porque insistir rende o bloqueio 656.
   */
  async sync(
    ctx: RequestContext,
    companyId: string,
    _options: { force: boolean } = { force: true },
  ): Promise<DfeSyncResult> {
    const company = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!row) throw notFound('Empresa');
      return row;
    });
    if (company.dfeNextQueryAt && company.dfeNextQueryAt > new Date()) {
      return {
        received: 0,
        nextQueryAt: company.dfeNextQueryAt.toISOString(),
        message:
          'O Ambiente Nacional pede uma hora entre as buscas sem nota nova. O Bipaê busca de novo sozinho.',
      };
    }
    let last = company.dfeLastNsu;
    let received = 0;
    let wait: Date | null = null;
    let message = 'Nenhuma nota nova.';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const result = await this.sefaz.distribution(ctx, companyId, { ultNSU: last });
      if (result.cStat === '656') {
        wait = new Date(Date.now() + WAIT_MS);
        message = 'O Ambiente Nacional pediu uma pausa de uma hora (consumo indevido, 656).';
        break;
      }
      if (result.cStat !== '137' && result.cStat !== '138') {
        throw new AppError(502, 'dfe_rejected', `SEFAZ: ${result.cStat} ${result.xMotivo}`);
      }
      received += await withTenant(this.db, ctx, async (tx) => {
        let count = 0;
        for (const doc of result.documents) count += await this.store(tx, ctx, companyId, doc);
        await tx
          .update(companies)
          .set({ dfeLastNsu: result.ultNSU })
          .where(eq(companies.id, companyId));
        return count;
      });
      last = result.ultNSU;
      if (result.cStat === '137' || result.ultNSU >= result.maxNSU) {
        // Chegou ao fim: a próxima busca só depois de uma hora (NT 2014.002).
        wait = new Date(Date.now() + WAIT_MS);
        message = received > 0 ? `${received} nota(s) recebida(s).` : 'Nenhuma nota nova.';
        break;
      }
    }
    await withTenant(this.db, ctx, (tx) =>
      tx.update(companies).set({ dfeNextQueryAt: wait }).where(eq(companies.id, companyId)),
    );
    return { received, nextQueryAt: wait?.toISOString() ?? null, message };
  }

  async list(ctx: RequestContext, companyId?: string): Promise<DfeDocumentView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(dfeDocuments)
        .where(companyId ? eq(dfeDocuments.companyId, companyId) : undefined)
        .orderBy(desc(dfeDocuments.issuedAt))
        .limit(300);
      const keys = rows.map((r) => r.accessKey);
      const bought = keys.length
        ? await tx
            .select({ id: purchaseInvoices.id, key: purchaseInvoices.accessKey })
            .from(purchaseInvoices)
            .where(inArray(purchaseInvoices.accessKey, keys))
        : [];
      return rows.map((r) => view(r, bought.find((b) => b.key === r.accessKey)?.id ?? null));
    });
  }

  private async load(tx: Tx, id: string) {
    const [row] = await tx.select().from(dfeDocuments).where(eq(dfeDocuments.id, id));
    if (!row) throw notFound('Nota');
    return row;
  }

  /**
   * Manifestação do destinatário: ciência (libera a nota completa), confirmação, desconhecimento
   * ou operação não realizada. Depois da ciência, a nota completa é pedida pela chave.
   */
  async manifest(ctx: RequestContext, id: string, input: z.output<typeof dfeManifestInput>) {
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, id);
      const [company] = await tx.select().from(companies).where(eq(companies.id, row.companyId));
      if (!company?.taxId) throw new AppError(400, 'missing_tax_id', 'Falta o CNPJ da empresa.');
      // A confirmação, o desconhecimento e a operação não realizada são definitivos.
      if (
        row.manifestationStatus === 'registered' &&
        row.manifestation &&
        row.manifestation !== 'ciencia'
      ) {
        throw new AppError(409, 'already_manifested', 'Esta nota já tem a manifestação final.');
      }
      const key = await this.certificates.signingKey(tx, row.companyId);
      const signed = await signFiscalXml(
        buildRecipientEvent({
          accessKey: row.accessKey,
          taxId: company.taxId,
          type: input.type,
          ...(input.reason && { reason: input.reason }),
          at: brasiliaDateTime(new Date().toISOString()),
        }),
        'evento',
        'infEvento',
        key,
      );
      return { row, signed };
    });
    let status: 'registered' | 'rejected' | 'error';
    let message: string | null = null;
    let protocol: string | null = null;
    try {
      const result = await this.sefaz.recipientEvent(ctx, prepared.row.companyId, prepared.signed);
      // 135 registrado; 573 duplicidade (a mesma manifestação já estava registrada).
      status = result.registered || result.cStat === '573' ? 'registered' : 'rejected';
      message = `${result.cStat} ${result.xMotivo}`;
      protocol = result.protocol ?? null;
    } catch (error) {
      status = 'error';
      message = (error as Error).message;
    }
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .update(dfeDocuments)
        .set({
          manifestation: input.type,
          manifestationStatus: status,
          manifestationReason: input.reason ?? null,
          manifestationProtocol: protocol,
          manifestationMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(dfeDocuments.id, id));
      await this.audit.record(tx, ctx, {
        action: 'dfe.manifested',
        entity: 'dfe_document',
        entityId: id,
        data: { accessKey: prepared.row.accessKey, type: input.type, status, message },
      });
    });
    // Ciência registrada: a nota completa já pode ser baixada pela chave.
    if (status === 'registered' && !prepared.row.procXml) {
      await this.fetchFull(ctx, prepared.row).catch((error: Error) =>
        this.logger.warn(`Nota completa ${prepared.row.accessKey}: ${error.message}`),
      );
    }
    return withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, id);
      const [bought] = await tx
        .select({ id: purchaseInvoices.id })
        .from(purchaseInvoices)
        .where(eq(purchaseInvoices.accessKey, row.accessKey));
      return view(row, bought?.id ?? null);
    });
  }

  /** Pede a nota completa pela chave (consChNFe) e guarda. */
  private async fetchFull(ctx: RequestContext, row: Row) {
    const result = await this.sefaz.distribution(ctx, row.companyId, { accessKey: row.accessKey });
    await withTenant(this.db, ctx, async (tx) => {
      for (const doc of result.documents) await this.store(tx, ctx, row.companyId, doc);
    });
  }

  /** XML completo (procNFe), para dar entrada na compra. */
  xml(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, id);
      if (!row.procXml) {
        throw new AppError(
          409,
          'no_full_xml',
          'A nota completa ainda não chegou: registre a ciência da operação primeiro.',
        );
      }
      return { accessKey: row.accessKey, xml: row.procXml };
    });
  }

  /** Empresas com certificado e CNPJ: a manutenção agenda a busca de cada uma. */
  async due(tx: Tx) {
    return tx
      .select({ tenantId: companies.tenantId, id: companies.id })
      .from(companies)
      .where(
        and(
          sql`${companies.taxId} is not null`,
          sql`(${companies.dfeNextQueryAt} is null or ${companies.dfeNextQueryAt} < now())`,
          sql`exists (select 1 from company_certificates c where c.company_id = ${companies.id})`,
        ),
      )
      .limit(500);
  }
}

@Controller('fiscal/dfe')
export class DfeController {
  constructor(@Inject(DfeService) private readonly dfe: DfeService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('companyId') companyId?: string) {
    return this.dfe.list(ctx, companyId);
  }

  /** "Buscar notas agora": respeita a espera de uma hora do Ambiente Nacional. */
  @Post('sync/:companyId')
  @HttpCode(200)
  @RequirePermission('catalog.write')
  sync(@Ctx() ctx: RequestContext, @Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.dfe.sync(ctx, companyId);
  }

  @Post(':id/manifest')
  @HttpCode(200)
  @RequirePermission('catalog.write')
  manifest(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.dfe.manifest(ctx, id, parse(dfeManifestInput, body));
  }

  @Get(':id/xml')
  @RequirePermission('catalog.read')
  async xml(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, xml } = await this.dfe.xml(ctx, id);
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="NFe${accessKey}.xml"`);
    return new StreamableFile(Buffer.from(xml, 'utf8'));
  }
}
