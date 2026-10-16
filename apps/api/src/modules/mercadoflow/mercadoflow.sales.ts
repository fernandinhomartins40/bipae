import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { dec, readSaleNfce, type SaleNfce } from '@bipae/fiscal';
import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { DB } from '../../common/di';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { fiscalDocuments, mercadoflowLinks, mercadoflowOutbox, sales } from '../../db/schema';
import { MERCADOFLOW_CLIENT, type MercadoflowClient } from './mercadoflow.client';
import { MercadoflowOutbox, type OutboxResult, type OutboxRow } from './mercadoflow.outbox';

export const SALES_KIND = 'market.sales';
export const SALES_CANCEL_KIND = 'market.sales-cancel';
const SCOPE = 'sales:write';
const BATCH = 500;
/** Lote de vendas a cada 30 segundos, no mínimo (seção 7.1). */
const SALES_EVERY_MS = 30_000;
const PAUSE_MS = 6 * 3_600_000;
const HISTORY_DAYS = 90;
const PLAN_LIMIT = 'Limite do plano do MercadoFlow: vendas em pausa por 6 horas.';

/** Centavos → reais em número, pelo decimal (sem conta de ponto flutuante). */
const reais = (cents: number) => dec(cents).div(100).toNumber();

interface SalePayload {
  marketId: string;
  /** NFC-e de homologação vai só para validação (dryRun), nunca como venda de verdade. */
  dryRun: boolean;
  item: Record<string, unknown>;
}

/** A venda no formato do contrato (seção 7.1), a partir da NFC-e autorizada. */
export function saleItem(nota: SaleNfce): Record<string, unknown> {
  const a = nota.issuer.address;
  return {
    chaveNFe: nota.accessKey,
    cnpjEmitente: nota.issuer.cnpj,
    dataEmissao: nota.issuedAt,
    serie: String(nota.series),
    numero: String(nota.number),
    valorTotal: reais(nota.totalCents),
    ...(nota.recipientTaxId && { cpfCnpjDestinatario: nota.recipientTaxId }),
    ...(a && {
      emitente: {
        logradouro: a.street,
        numero: a.number,
        bairro: a.district,
        municipio: a.cityName,
        codigoMunicipio: a.cityCode,
        uf: a.uf,
        ...(a.cep && { cep: a.cep }),
      },
    }),
    items: nota.items.map((i) => ({
      // Sem código de barras (balança, código interno): como na nota.
      codigoEAN: i.gtin ?? 'SEM GTIN',
      codigoInterno: i.supplierCode,
      descricao: i.description,
      ncm: i.ncm,
      cfop: i.cfop,
      // Balança: quantidade em kg e valor unitário em R$/kg, como no XML.
      quantidade: dec(i.quantity).toNumber(),
      valorUnitario: dec(i.unitPrice).toNumber(),
      valorTotal: reais(i.totalCents),
      valorDesconto: reais(i.discountCents),
      valorFrete: reais(i.freightCents),
      valorOutros: reais(i.otherCents),
      valorLiquido: reais(i.totalCents - i.discountCents + i.freightCents + i.otherCents),
      icms: reais(i.taxes.icms?.amountCents ?? 0),
      pis: reais(i.taxes.pisCents),
      cofins: reais(i.taxes.cofinsCents),
    })),
  };
}

type ItemStatus = { chaveNFe?: string; status?: string; error?: string; message?: string };

/**
 * Vendas do caixa no MercadoFlow (MF-08, seção 7.1 do contrato): cada NFC-e autorizada entra na
 * fila na mesma transação da autorização, e o cancelamento entra quando a SEFAZ registra o
 * evento, sempre depois da venda. Só lojas vinculadas com o escopo sales:write. Como toda a
 * emissão ainda é em homologação (regra 4), as vendas vão com dryRun=true: o MercadoFlow valida
 * sem gravar.
 */
@Injectable()
export class MercadoflowSales implements OnModuleInit {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
    @Inject(MercadoflowOutbox) private readonly outbox: MercadoflowOutbox,
  ) {}

  onModuleInit() {
    this.outbox.register(
      SALES_KIND,
      BATCH,
      (rows, client, now) => this.send(rows, client, now),
      SALES_EVERY_MS,
    );
    // Registrado depois: no mesmo ciclo, as vendas vão antes dos cancelamentos.
    this.outbox.register(SALES_CANCEL_KIND, BATCH, (rows, client, now) =>
      this.sendCancel(rows, client, now),
    );
  }

  private async links(tx: Tx, tenantId: string, storeId: string) {
    if (!this.client.enabled) return [];
    const rows = await tx
      .select()
      .from(mercadoflowLinks)
      .where(
        and(
          eq(mercadoflowLinks.tenantId, tenantId),
          eq(mercadoflowLinks.storeId, storeId),
          eq(mercadoflowLinks.status, 'ATIVA'),
        ),
      );
    return rows.filter((l) => l.marketId && l.scopes.includes(SCOPE));
  }

  /** NFC-e autorizada: na mesma transação da autorização. */
  async enqueueSale(tx: Tx, tenantId: string, storeId: string, nfeProc: string) {
    const links = await this.links(tx, tenantId, storeId);
    if (links.length === 0) return;
    let nota: SaleNfce;
    try {
      nota = readSaleNfce(nfeProc);
    } catch (error) {
      // Nunca segura a autorização da nota por causa do MercadoFlow.
      this.logger.warn(`NFC-e fora do formato para o MercadoFlow: ${(error as Error).message}`);
      return;
    }
    for (const link of links) {
      await this.outbox.enqueue(tx, {
        tenantId,
        storeId,
        kind: SALES_KIND,
        dedupeKey: `${link.marketId}:${nota.accessKey}`,
        payload: {
          marketId: link.marketId!,
          dryRun: nota.environment === 'homologacao',
          item: saleItem(nota),
        } satisfies SalePayload,
      });
    }
  }

  /** Cancelamento registrado na SEFAZ: na mesma transação do registro. */
  async enqueueCancel(
    tx: Tx,
    tenantId: string,
    storeId: string,
    accessKey: string,
    homologation: boolean,
  ) {
    for (const link of await this.links(tx, tenantId, storeId)) {
      await this.outbox.enqueue(tx, {
        tenantId,
        storeId,
        kind: SALES_CANCEL_KIND,
        dedupeKey: `${link.marketId}:${accessKey}`,
        payload: {
          marketId: link.marketId!,
          dryRun: homologation,
          item: { chaveNFe: accessKey },
        } satisfies SalePayload,
      });
    }
  }

  /**
   * Carga inicial (seção 7.4, último passo): as NFC-e autorizadas dos últimos 90 dias da loja,
   * da mais antiga para a mais nova, e os cancelamentos depois de cada venda.
   */
  async enqueueHistory(tx: Tx, tenantId: string, storeId: string, now = new Date()) {
    if ((await this.links(tx, tenantId, storeId)).length === 0) return;
    const docs = await tx
      .select({
        nfeProc: fiscalDocuments.nfeProc,
        status: fiscalDocuments.status,
        accessKey: fiscalDocuments.accessKey,
      })
      .from(fiscalDocuments)
      .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
      .where(
        and(
          eq(fiscalDocuments.tenantId, tenantId),
          eq(sales.storeId, storeId),
          inArray(fiscalDocuments.status, ['authorized', 'cancelled']),
          isNotNull(fiscalDocuments.nfeProc),
          gt(fiscalDocuments.authorizedAt, new Date(now.getTime() - HISTORY_DAYS * 86_400_000)),
        ),
      )
      .orderBy(asc(fiscalDocuments.authorizedAt));
    for (const doc of docs) {
      await this.enqueueSale(tx, tenantId, storeId, doc.nfeProc!);
      if (doc.status === 'cancelled' && doc.accessKey) {
        const homologation = doc.nfeProc!.includes('<tpAmb>2</tpAmb>');
        await this.enqueueCancel(tx, tenantId, storeId, doc.accessKey, homologation);
      }
    }
  }

  /** Mercados em pausa por LIMITE_DO_PLANO, com a hora em que voltam. */
  private async paused(marketIds: string[], now: Date) {
    if (marketIds.length === 0) return new Map<string, Date>();
    const rows = await asPlatform(this.db, (tx) =>
      tx
        .select({ marketId: mercadoflowLinks.marketId, until: mercadoflowLinks.salesPausedUntil })
        .from(mercadoflowLinks)
        .where(
          and(
            inArray(mercadoflowLinks.marketId, marketIds),
            gt(mercadoflowLinks.salesPausedUntil, now),
          ),
        ),
    );
    return new Map(rows.map((r) => [r.marketId!, r.until!]));
  }

  /** Lotes por mercado e por modo (dryRun ou não), cada um com a sua Idempotency-Key. */
  private groups(rows: OutboxRow[]) {
    const groups = new Map<string, { marketId: string; dryRun: boolean; rows: OutboxRow[] }>();
    for (const row of rows) {
      const p = row.payload as SalePayload;
      const key = `${p.marketId}|${p.dryRun}`;
      const g = groups.get(key) ?? { marketId: p.marketId, dryRun: p.dryRun, rows: [] };
      g.rows.push(row);
      groups.set(key, g);
    }
    return [...groups.values()];
  }

  private idempotencyKey(rows: OutboxRow[]) {
    return createHash('sha256')
      .update(rows.map((r) => `${r.id}:${r.attempts}`).join(','))
      .digest('hex')
      .slice(0, 40);
  }

  /** Resposta item a item: casa pela chave e, sem ela, pela posição. */
  private statusOf(results: ItemStatus[], row: OutboxRow, index: number) {
    const key = ((row.payload as SalePayload).item as { chaveNFe: string }).chaveNFe;
    return results.find((r) => r.chaveNFe === key) ?? results[index];
  }

  private async send(
    rows: OutboxRow[],
    client: MercadoflowClient,
    now: Date,
  ): Promise<OutboxResult[]> {
    const out: OutboxResult[] = [];
    const paused = await this.paused(
      [...new Set(rows.map((r) => (r.payload as SalePayload).marketId))],
      now,
    );
    for (const g of this.groups(rows)) {
      const until = paused.get(g.marketId);
      if (until) {
        out.push(
          ...g.rows.map((r) => ({ id: r.id, outcome: 'later' as const, until, error: PLAN_LIMIT })),
        );
        continue;
      }
      const response = await client.post<{ items?: ItemStatus[] }>(
        `/markets/${g.marketId}/sales${g.dryRun ? '?dryRun=true' : ''}`,
        { items: g.rows.map((r) => (r.payload as SalePayload).item) },
        { idempotencyKey: this.idempotencyKey(g.rows) },
      );
      const results = response?.items ?? [];
      let limit = false;
      g.rows.forEach((row, i) => {
        const result = this.statusOf(results, row, i);
        if (result?.status === 'RECUSADO') {
          out.push({
            id: row.id,
            outcome: 'rejected',
            error: result.error ?? result.message ?? 'Venda recusada pelo MercadoFlow.',
          });
        } else if (result?.status === 'LIMITE_DO_PLANO') {
          limit = true;
          out.push({
            id: row.id,
            outcome: 'later',
            until: new Date(now.getTime() + PAUSE_MS),
            error: PLAN_LIMIT,
          });
        } else {
          out.push({ id: row.id, outcome: 'sent' });
        }
      });
      await asPlatform(this.db, (tx) =>
        tx
          .update(mercadoflowLinks)
          .set(
            limit
              ? {
                  salesPausedUntil: new Date(now.getTime() + PAUSE_MS),
                  lastError: PLAN_LIMIT,
                  updatedAt: now,
                }
              : { lastSalesSyncAt: now, updatedAt: now },
          )
          .where(eq(mercadoflowLinks.marketId, g.marketId)),
      );
    }
    return out;
  }

  private async sendCancel(
    rows: OutboxRow[],
    client: MercadoflowClient,
    now: Date,
  ): Promise<OutboxResult[]> {
    // O cancelamento vai sempre depois da venda: se a venda ainda está na fila, espera.
    const waiting = await asPlatform(this.db, (tx) =>
      tx
        .select({ tenantId: mercadoflowOutbox.tenantId, dedupeKey: mercadoflowOutbox.dedupeKey })
        .from(mercadoflowOutbox)
        .where(
          and(
            eq(mercadoflowOutbox.kind, SALES_KIND),
            eq(mercadoflowOutbox.status, 'pending'),
            inArray(
              mercadoflowOutbox.dedupeKey,
              rows.map((r) => r.dedupeKey),
            ),
          ),
        ),
    );
    const blocked = new Set(waiting.map((w) => `${w.tenantId}|${w.dedupeKey}`));
    const out: OutboxResult[] = [];
    const ready = rows.filter((r) => {
      if (!blocked.has(`${r.tenantId}|${r.dedupeKey}`)) return true;
      out.push({
        id: r.id,
        outcome: 'later',
        until: new Date(now.getTime() + 60_000),
        error: 'Aguardando o envio da venda.',
      });
      return false;
    });
    for (const g of this.groups(ready)) {
      const response = await client.post<{ items?: ItemStatus[] }>(
        `/markets/${g.marketId}/sales/cancel${g.dryRun ? '?dryRun=true' : ''}`,
        { items: g.rows.map((r) => (r.payload as SalePayload).item) },
        { idempotencyKey: this.idempotencyKey(g.rows) },
      );
      const results = response?.items ?? [];
      g.rows.forEach((row, i) => {
        const result = this.statusOf(results, row, i);
        // CANCELADA e NAO_ENCONTRADA são sucesso.
        out.push(
          result?.status === 'RECUSADO'
            ? {
                id: row.id,
                outcome: 'rejected',
                error: result.error ?? result.message ?? 'Cancelamento recusado pelo MercadoFlow.',
              }
            : { id: row.id, outcome: 'sent' },
        );
      });
    }
    return out;
  }
}
