import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  type OnModuleInit,
} from '@nestjs/common';
import { uuidv7, type DfeSyncResult, type NfseReceivedView } from '@bipae/domain';
import {
  NfseMessageError,
  nfseDistributionRequest,
  nfseSummary,
  parseNfseDistributionResponse,
  type DistributedNfse,
} from '@bipae/fiscal';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, nfseReceived } from '../../db/schema';
import { CertificatesService } from './certificates.service';
import { NFSE_TRANSPORT } from './nfse.service';
import { NfseUnavailableError, type NfseTransport } from './nfse.transport';

export const NFSE_RECEIVED_SYNC_JOB = 'nfse.received.sync';
/** Sem documento novo (E2220), espera uma hora antes de perguntar de novo. */
const WAIT_MS = 60 * 60_000;
/** Cada lote traz vários documentos; numa busca, no máximo estas voltas. */
const MAX_ROUNDS = 10;

type Row = typeof nfseReceived.$inferSelect;

const view = (r: Row): NfseReceivedView => ({
  id: r.id,
  companyId: r.companyId,
  accessKey: r.accessKey,
  role: r.role,
  number: r.number,
  issuerTaxId: r.issuerTaxId,
  issuerName: r.issuerName,
  takerTaxId: r.takerTaxId,
  takerName: r.takerName,
  issuedAt: r.issuedAt?.toISOString() ?? null,
  valueCents: r.valueCents,
  netCents: r.netCents,
  serviceCode: r.serviceCode,
  cancelled: r.cancelled,
});

/**
 * NFS-e em que a empresa aparece (F5-13.l): a busca pergunta ao ADN Contribuinte pelos documentos
 * depois do último NSU, com o certificado da empresa, e guarda as notas. O cancelamento do emitente
 * marca a nota como cancelada. Roda sozinha de hora em hora (manutenção) e também a pedido.
 */
@Injectable()
export class NfseReceivedService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(NFSE_TRANSPORT) private readonly transport: NfseTransport,
  ) {}

  onModuleInit() {
    this.queue.process(NFSE_RECEIVED_SYNC_JOB, async (data) => {
      const { tenantId, companyId } = data as { tenantId: string; companyId: string };
      await this.sync(
        { tenantId, userId: null as never, permissions: [], terminalId: null, storeIds: null },
        companyId,
      );
    });
  }

  async schedule(tenantId: string, companyId: string) {
    await this.queue.add(
      NFSE_RECEIVED_SYNC_JOB,
      { tenantId, companyId },
      { attempts: 3, backoffMs: 60_000, dedupeId: `${NFSE_RECEIVED_SYNC_JOB}:${companyId}` },
    );
  }

  private async store(
    tx: Tx,
    ctx: RequestContext,
    company: { id: string; taxId: string },
    doc: DistributedNfse,
  ) {
    if (doc.kind === 'evento') {
      if (doc.accessKey && /CANCELAMENTO/.test(doc.eventType ?? '')) {
        await tx
          .update(nfseReceived)
          .set({ cancelled: true, updatedAt: new Date() })
          .where(
            and(eq(nfseReceived.companyId, company.id), eq(nfseReceived.accessKey, doc.accessKey)),
          );
      }
      return 0;
    }
    if (doc.kind !== 'nfse' || !doc.xml) return 0;
    const s = nfseSummary(doc.xml);
    if (!s) return 0;
    const role =
      s.issuerTaxId === company.taxId
        ? 'prestador'
        : s.takerTaxId === company.taxId
          ? 'tomador'
          : 'intermediario';
    const values = {
      nsu: doc.nsu,
      role,
      number: s.number,
      issuerTaxId: s.issuerTaxId,
      issuerName: s.issuerName,
      takerTaxId: s.takerTaxId,
      takerName: s.takerName,
      issuedAt: s.issuedAt ? new Date(s.issuedAt) : null,
      valueCents: s.valueCents,
      netCents: s.netCents,
      serviceCode: s.serviceCode,
      nfseXml: doc.xml,
      updatedAt: new Date(),
    } as const;
    await tx
      .insert(nfseReceived)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: company.id,
        accessKey: s.accessKey,
        ...values,
      })
      .onConflictDoUpdate({
        target: [nfseReceived.tenantId, nfseReceived.companyId, nfseReceived.accessKey],
        set: values,
      });
    return 1;
  }

  async sync(ctx: RequestContext, companyId: string): Promise<DfeSyncResult> {
    const prepared = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!row) throw notFound('Empresa');
      if (!row.taxId) throw new AppError(400, 'missing_tax_id', 'Falta o CNPJ da empresa.');
      if (row.nfseDistNextQueryAt && row.nfseDistNextQueryAt > new Date())
        return { row, credentials: null };
      return { row, credentials: await this.certificates.tlsCredentials(tx, companyId) };
    });
    const { row, credentials } = prepared;
    if (!credentials) {
      return {
        received: 0,
        nextQueryAt: row.nfseDistNextQueryAt!.toISOString(),
        message: 'O Bipaê pergunta de novo ao Ambiente Nacional daqui a pouco, sozinho.',
      };
    }
    const company = { id: row.id, taxId: row.taxId! };
    let last = row.nfseDistLastNsu;
    let received = 0;
    let message = 'Nenhuma NFS-e nova.';
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // O ADN devolve o lote a partir do NSU pedido, incluindo-o: pede o seguinte ao último.
      const next = round === 0 && last === 0 ? 0 : last + 1;
      let response;
      try {
        response = await this.transport.send(nfseDistributionRequest(next), credentials);
      } catch (error) {
        if (error instanceof NfseUnavailableError) {
          throw new AppError(
            502,
            'nfse_unavailable',
            'O Ambiente Nacional da NFS-e não respondeu agora. Tente de novo em instantes.',
          );
        }
        throw error;
      }
      let result;
      try {
        result = await parseNfseDistributionResponse(response.status, response.body);
      } catch (error) {
        if (!(error instanceof NfseMessageError)) throw error;
        throw new AppError(
          502,
          'nfse_dist_response',
          `${error.message} Tente de novo em instantes.`,
        );
      }
      if (result.outcome === 'rejected') {
        const first = result.errors[0];
        throw new AppError(
          502,
          'nfse_dist_rejected',
          first
            ? `Ambiente Nacional: ${first.code} ${first.message}`
            : 'O Ambiente Nacional recusou a busca.',
        );
      }
      if (result.outcome === 'none') break;
      received += await withTenant(this.db, ctx, async (tx) => {
        let count = 0;
        for (const doc of result.documents) count += await this.store(tx, ctx, company, doc);
        if (result.lastNsu !== null) {
          await tx
            .update(companies)
            .set({ nfseDistLastNsu: result.lastNsu })
            .where(eq(companies.id, companyId));
        }
        return count;
      });
      if (result.lastNsu === null || result.lastNsu <= last) break;
      last = result.lastNsu;
    }
    if (received > 0) message = `${received} NFS-e recebida(s).`;
    const wait = new Date(Date.now() + WAIT_MS);
    await withTenant(this.db, ctx, (tx) =>
      tx.update(companies).set({ nfseDistNextQueryAt: wait }).where(eq(companies.id, companyId)),
    );
    return { received, nextQueryAt: wait.toISOString(), message };
  }

  list(ctx: RequestContext, companyId?: string): Promise<NfseReceivedView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(nfseReceived)
        .where(companyId ? eq(nfseReceived.companyId, companyId) : undefined)
        .orderBy(desc(nfseReceived.issuedAt))
        .limit(300);
      return rows.map(view);
    });
  }

  xml(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(nfseReceived).where(eq(nfseReceived.id, id));
      if (!row) throw notFound('NFS-e');
      return { accessKey: row.accessKey, xml: row.nfseXml };
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
          sql`(${companies.nfseDistNextQueryAt} is null or ${companies.nfseDistNextQueryAt} < now())`,
          sql`exists (select 1 from company_certificates c where c.company_id = ${companies.id})`,
        ),
      )
      .limit(500);
  }
}

@Controller('fiscal/nfse-received')
export class NfseReceivedController {
  constructor(@Inject(NfseReceivedService) private readonly received: NfseReceivedService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('companyId') companyId?: string) {
    return this.received.list(ctx, companyId);
  }

  /** "Buscar NFS-e agora": respeita a espera de uma hora depois de uma busca sem nota nova. */
  @Post('sync/:companyId')
  @HttpCode(200)
  @RequirePermission('catalog.write')
  sync(@Ctx() ctx: RequestContext, @Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.received.sync(ctx, companyId);
  }

  @Get(':id/xml')
  @RequirePermission('catalog.read')
  async xml(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const { accessKey, xml } = await this.received.xml(ctx, id);
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="NFSe${accessKey}.xml"`);
    return new StreamableFile(Buffer.from(xml, 'utf8'));
  }
}
