import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { isValidGtin } from '@bipae/domain';
import { dec } from '@bipae/fiscal';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { asPlatform, type Db, type Tx } from '../../db/client';
import {
  mercadoflowLinks,
  priceTableItems,
  productBarcodes,
  products,
  stockMovements,
  stores,
  suppliers,
} from '../../db/schema';
import { MERCADOFLOW_CLIENT, type MercadoflowClient } from './mercadoflow.client';
import { MercadoflowOutbox, type OutboxResult, type OutboxRow } from './mercadoflow.outbox';
import { MercadoflowSales } from './mercadoflow.sales';

/** Recurso do MercadoFlow, escopo exigido e tipo na fila (seção 7.2 do contrato). */
const RESOURCES = {
  suppliers: { scope: 'catalog:write', kind: 'market.suppliers' },
  products: { scope: 'catalog:write', kind: 'market.products' },
  prices: { scope: 'prices:write', kind: 'market.prices' },
  costs: { scope: 'costs:write', kind: 'market.costs' },
  stock: { scope: 'stock:write', kind: 'market.stock' },
} as const;
type Resource = keyof typeof RESOURCES;

const BATCH = 1000;
const STOCK_JOB = 'mercadoflow.stock-daily';
const DAY_MS = 86_400_000;

/** Centavos → reais em número, pelo decimal (sem conta de ponto flutuante). */
const reais = (cents: number) => dec(cents).div(100).toNumber();
const today = () => new Date().toISOString();

type Link = typeof mercadoflowLinks.$inferSelect;

interface ProductRow {
  id: string;
  name: string;
  unit: string;
  priceCents: number;
  costCents: number | null;
  catalog: Record<string, unknown> | null;
}

/**
 * Cadastro, preço, custo e estoque das lojas vinculadas (seção 7.2), sempre pela fila: o Bipaê
 * nunca espera o MercadoFlow. Só vai o que a loja autorizou (escopos) e só produto com código de
 * barras válido, que é como o MercadoFlow identifica o produto.
 */
@Injectable()
export class MercadoflowMarketSync implements OnModuleInit {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
    @Inject(MercadoflowOutbox) private readonly outbox: MercadoflowOutbox,
    @Inject(MercadoflowSales) private readonly sales: MercadoflowSales,
  ) {}

  onModuleInit() {
    for (const resource of Object.keys(RESOURCES) as Resource[]) {
      this.outbox.register(RESOURCES[resource].kind, BATCH, (rows, client) =>
        this.send(resource, rows, client),
      );
    }
    if (!this.client.enabled) return;
    try {
      this.queue.process(STOCK_JOB, async () => {
        await this.dailyStock();
      });
    } catch (error) {
      this.logger.error(`Envio diário do estoque não iniciou: ${(error as Error).message}`);
      return;
    }
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(STOCK_JOB, {}, { repeatEveryMs: DAY_MS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar o estoque diário: ${error.message}`),
        );
    }
  }

  /** Um lote por mercado, com Idempotency-Key tirada dos itens (repetir não duplica). */
  private async send(
    resource: Resource,
    rows: OutboxRow[],
    client: MercadoflowClient,
  ): Promise<OutboxResult[]> {
    const byMarket = new Map<string, OutboxRow[]>();
    for (const row of rows) {
      const marketId = (row.payload as { marketId: string }).marketId;
      byMarket.set(marketId, [...(byMarket.get(marketId) ?? []), row]);
    }
    for (const [marketId, group] of byMarket) {
      const key = createHash('sha256')
        .update(group.map((r) => `${r.id}:${r.attempts}`).join(','))
        .digest('hex')
        .slice(0, 40);
      await client.post(
        `/markets/${marketId}/${resource}`,
        { items: group.map((r) => (r.payload as { item: unknown }).item) },
        { idempotencyKey: key },
      );
    }
    return rows.map((r) => ({ id: r.id, outcome: 'sent' as const }));
  }

  /** Vínculos ativos do cliente que autorizam o recurso. */
  private async links(tx: Tx, tenantId: string, resource: Resource): Promise<Link[]> {
    if (!this.client.enabled) return [];
    const rows = await tx
      .select()
      .from(mercadoflowLinks)
      .where(and(eq(mercadoflowLinks.tenantId, tenantId), eq(mercadoflowLinks.status, 'ATIVA')));
    return rows.filter((l) => l.marketId && l.scopes.includes(RESOURCES[resource].scope));
  }

  private async put(
    tx: Tx,
    tenantId: string,
    link: Link,
    resource: Resource,
    dedupeKey: string,
    item: unknown,
  ) {
    await this.outbox.enqueue(tx, {
      tenantId,
      storeId: link.storeId,
      kind: RESOURCES[resource].kind,
      dedupeKey: `${link.marketId}:${dedupeKey}`,
      payload: { marketId: link.marketId, item },
    });
  }

  /** Preço da loja: o da tabela de preço dela, senão o do cadastro. */
  private async storePrices(tx: Tx, storeId: string, productIds: string[]) {
    const [store] = await tx
      .select({ priceTableId: stores.priceTableId })
      .from(stores)
      .where(eq(stores.id, storeId));
    if (!store?.priceTableId || productIds.length === 0) return new Map<string, number>();
    const items = await tx
      .select()
      .from(priceTableItems)
      .where(
        and(
          eq(priceTableItems.priceTableId, store.priceTableId),
          inArray(priceTableItems.productId, productIds),
        ),
      );
    return new Map(items.map((i) => [i.productId, i.priceCents]));
  }

  /** Produto criado ou alterado: cadastro, preço e custo para cada loja vinculada. */
  async enqueueProduct(tx: Tx, tenantId: string, product: ProductRow & { barcodes: string[] }) {
    const gtins = product.barcodes.filter((code) => isValidGtin(code) && !code.startsWith('2'));
    if (gtins.length === 0 || !this.client.enabled) return;
    for (const resource of ['products', 'prices', 'costs'] as const) {
      for (const link of await this.links(tx, tenantId, resource)) {
        const prices =
          resource === 'prices' ? await this.storePrices(tx, link.storeId, [product.id]) : null;
        for (const gtin of gtins) {
          if (resource === 'products') {
            await this.put(tx, tenantId, link, resource, gtin, {
              gtin,
              description: product.name,
              department: (product.catalog?.department as string | undefined) ?? null,
              brand: (product.catalog?.brand as string | undefined) ?? null,
              unit: product.unit,
            });
          } else if (resource === 'prices') {
            await this.put(tx, tenantId, link, resource, gtin, {
              gtin,
              price: reais(prices?.get(product.id) ?? product.priceCents),
            });
          } else if (product.costCents !== null) {
            await this.put(tx, tenantId, link, resource, gtin, {
              gtin,
              unitCost: reais(product.costCents),
              at: today(),
            });
          }
        }
      }
    }
  }

  /**
   * Encarte aplicado (MF-11.b): o preço da loja com o preço promocional e a vigência, para o
   * MercadoFlow saber que a promoção está valendo no caixa.
   */
  async enqueuePromoPrice(
    tx: Tx,
    tenantId: string,
    storeId: string,
    item: { gtin: string; priceCents: number; promoPriceCents: number; start: string; end: string },
  ) {
    for (const link of await this.links(tx, tenantId, 'prices')) {
      if (link.storeId !== storeId) continue;
      await this.put(tx, tenantId, link, 'prices', item.gtin, {
        gtin: item.gtin,
        price: reais(item.priceCents),
        promoPrice: reais(item.promoPriceCents),
        promoStart: item.start,
        promoEnd: item.end,
      });
    }
  }

  /** Estoque de cada produto com código de barras, em unidades de venda, para as lojas vinculadas. */
  private async enqueueStock(tx: Tx, tenantId: string, only?: string) {
    for (const link of await this.links(tx, tenantId, 'stock')) {
      if (only && link.storeId !== only) continue;
      const rows = await tx
        .select({
          gtin: productBarcodes.code,
          quantity: sql<string>`coalesce(sum(${stockMovements.deltaMilli}), 0)::text`,
        })
        .from(productBarcodes)
        .leftJoin(
          stockMovements,
          and(
            eq(stockMovements.productId, productBarcodes.productId),
            eq(stockMovements.storeId, link.storeId),
          ),
        )
        .where(eq(productBarcodes.tenantId, tenantId))
        .groupBy(productBarcodes.code);
      for (const row of rows.filter((r) => isValidGtin(r.gtin) && !r.gtin.startsWith('2'))) {
        await this.put(tx, tenantId, link, 'stock', row.gtin, {
          gtin: row.gtin,
          units: dec(row.quantity).div(1000).toNumber(),
          at: today(),
        });
      }
    }
  }

  /**
   * Carga inicial depois do vínculo (seção 7.4): fornecedores, produtos, preços, custos e estoque,
   * nesta ordem, e por último as vendas (NFC-e autorizadas) dos últimos 90 dias. Vai pela fila e
   * respeita o limite de requisições.
   */
  async initialLoad(tenantId: string, storeId: string) {
    if (!this.client.enabled) return;
    await asPlatform(this.db, async (tx) => {
      for (const link of (await this.links(tx, tenantId, 'suppliers')).filter(
        (l) => l.storeId === storeId,
      )) {
        const list = await tx.select().from(suppliers).where(eq(suppliers.tenantId, tenantId));
        for (const s of list.filter((x) => x.taxId?.length === 14)) {
          await this.put(tx, tenantId, link, 'suppliers', s.taxId!, {
            cnpj: s.taxId,
            legalName: s.name,
            tradeName: s.name,
            email: s.email,
            phone: s.phone,
          });
        }
      }
      const list = await tx.select().from(products).where(eq(products.tenantId, tenantId));
      const codes = await tx
        .select()
        .from(productBarcodes)
        .where(eq(productBarcodes.tenantId, tenantId));
      for (const p of list) {
        await this.enqueueProduct(tx, tenantId, {
          ...p,
          catalog: p.catalog ?? null,
          barcodes: codes.filter((c) => c.productId === p.id).map((c) => c.code),
        });
      }
      await this.enqueueStock(tx, tenantId, storeId);
      await this.sales.enqueueHistory(tx, tenantId, storeId);
    });
  }

  /** Uma vez por dia (madrugada): o estoque de todas as lojas vinculadas. */
  async dailyStock() {
    const tenantIds = await asPlatform(this.db, (tx) =>
      tx
        .selectDistinct({ id: mercadoflowLinks.tenantId })
        .from(mercadoflowLinks)
        .where(eq(mercadoflowLinks.status, 'ATIVA')),
    );
    for (const { id } of tenantIds) {
      await asPlatform(this.db, (tx) => this.enqueueStock(tx, id));
    }
  }
}
