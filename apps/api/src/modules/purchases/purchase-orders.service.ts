import { Inject, Injectable } from '@nestjs/common';
import {
  uuidv7,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type purchaseOrderInput,
  type purchaseOrderReceiveInput,
} from '@bipae/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  productBarcodes,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockMovements,
  stores,
  suppliers,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { MercadoflowMarketSync } from '../mercadoflow/mercadoflow.market-sync';

type OrderInput = z.output<typeof purchaseOrderInput>;
type ReceiveInput = z.output<typeof purchaseOrderReceiveInput>;

/**
 * Custo médio ponderado (F4-02): (estoque atual × custo atual + recebido × custo do pedido) ÷
 * (estoque atual + recebido), arredondando meio para cima. Sem estoque ou sem custo anterior,
 * vale o custo do pedido. Contas em BigInt: milésimos × centavos passam do limite do número.
 */
export function averageCost(
  stockMilli: number,
  currentCostCents: number | null,
  receivedMilli: number,
  unitCostCents: number,
): number {
  if (receivedMilli <= 0) return currentCostCents ?? unitCostCents;
  if (stockMilli <= 0 || currentCostCents === null) return unitCostCents;
  const total = BigInt(stockMilli) + BigInt(receivedMilli);
  const value =
    BigInt(stockMilli) * BigInt(currentCostCents) + BigInt(receivedMilli) * BigInt(unitCostCents);
  return Number((value * 2n + total) / (total * 2n));
}

/** Custo × quantidade (milésimos) ÷ 1000, arredondando meio para cima, em centavos. */
export const orderLineTotal = (unitCostCents: number, quantityMilli: number) =>
  Math.floor((unitCostCents * quantityMilli + 500) / 1000);

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'rascunho',
  sent: 'enviado',
  received: 'recebido',
  cancelled: 'cancelado',
};

/**
 * Pedidos de compra (F4-01): o rascunho é editável; enviado ao fornecedor, fica fechado até
 * ser recebido (entrada de mercadoria, F4-02) ou cancelado. Cancelar pede motivo e fica na
 * auditoria.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowMarketSync) private readonly marketSync: MercadoflowMarketSync,
  ) {}

  async list(ctx: RequestContext, status?: PurchaseOrderStatus): Promise<PurchaseOrderView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(
          and(
            status ? eq(purchaseOrders.status, status) : undefined,
            storeCondition(ctx, purchaseOrders.storeId),
          ),
        )
        .orderBy(desc(purchaseOrders.number))
        .limit(200);
      return this.views(
        tx,
        rows.map((r) => r.id),
      );
    });
  }

  async get(ctx: RequestContext, id: string): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => this.view(tx, ctx, id));
  }

  private async view(tx: Tx, ctx: RequestContext, id: string) {
    const [view] = await this.views(tx, [id]);
    if (!view) throw notFound('Pedido de compra');
    assertStore(ctx, view.storeId);
    return view;
  }

  private async views(tx: Tx, ids: string[]): Promise<PurchaseOrderView[]> {
    if (ids.length === 0) return [];
    const orders = await tx
      .select({
        order: purchaseOrders,
        storeName: stores.name,
        supplierName: suppliers.name,
        supplierTaxId: suppliers.taxId,
      })
      .from(purchaseOrders)
      .innerJoin(stores, eq(stores.id, purchaseOrders.storeId))
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(inArray(purchaseOrders.id, ids))
      .orderBy(desc(purchaseOrders.number));
    const items = await tx
      .select({ item: purchaseOrderItems, name: products.name, unit: products.unit })
      .from(purchaseOrderItems)
      .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
      .where(inArray(purchaseOrderItems.orderId, ids))
      .orderBy(asc(purchaseOrderItems.line));
    const codes = items.length
      ? await tx
          .select({ productId: productBarcodes.productId, code: productBarcodes.code })
          .from(productBarcodes)
          .where(
            inArray(productBarcodes.productId, [...new Set(items.map((i) => i.item.productId))]),
          )
      : [];
    return orders.map(({ order: o, storeName, supplierName, supplierTaxId }) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      storeId: o.storeId,
      storeName,
      supplierId: o.supplierId,
      supplierName,
      supplierTaxId,
      expectedAt: o.expectedAt,
      notes: o.notes,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
      sentAt: o.sentAt?.toISOString() ?? null,
      receivedAt: o.receivedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      cancelReason: o.cancelReason,
      items: items
        .filter((i) => i.item.orderId === o.id)
        .map(({ item, name, unit }) => ({
          line: item.line,
          productId: item.productId,
          productName: name,
          unit,
          quantityMilli: item.quantityMilli,
          unitCostCents: item.unitCostCents,
          totalCents: item.totalCents,
          receivedMilli: item.receivedMilli,
          barcodes: codes
            .filter((code) => code.productId === item.productId)
            .map((code) => code.code),
        })),
    }));
  }

  /** Confere loja, fornecedor e produtos do cliente e calcula as linhas. */
  private async lines(tx: Tx, ctx: RequestContext, input: OrderInput) {
    assertStore(ctx, input.storeId);
    // As chaves estrangeiras ignoram o isolamento: confere que tudo é deste cliente.
    const [store] = await tx
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, input.storeId));
    if (!store) throw new AppError(422, 'invalid_store', 'Loja não encontrada.');
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw new AppError(422, 'invalid_supplier', 'Fornecedor não encontrado.');
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const found = await tx
      .select({ id: products.id, weighable: products.isWeighable, name: products.name })
      .from(products)
      .where(inArray(products.id, ids));
    const byId = new Map(found.map((p) => [p.id, p]));
    return input.items.map((item, index) => {
      const product = byId.get(item.productId);
      if (!product) throw new AppError(422, 'invalid_product', 'Produto do pedido não encontrado.');
      if (!product.weighable && item.quantityMilli % 1000 !== 0) {
        throw new AppError(
          422,
          'invalid_quantity',
          `${product.name} é comprado por unidade inteira.`,
        );
      }
      return {
        tenantId: ctx.tenantId,
        line: index + 1,
        productId: item.productId,
        quantityMilli: item.quantityMilli,
        unitCostCents: item.unitCostCents,
        totalCents: orderLineTotal(item.unitCostCents, item.quantityMilli),
      };
    });
  }

  async create(ctx: RequestContext, input: OrderInput): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => {
      const lines = await this.lines(tx, ctx, input);
      // Número em sequência por cliente; o advisory lock evita dois pedidos com o mesmo número.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`purchase-order:${ctx.tenantId}`}, 0))`,
      );
      const [last] = await tx
        .select({ n: sql<number>`coalesce(max(${purchaseOrders.number}), 0)::int` })
        .from(purchaseOrders);
      const id = uuidv7();
      await tx.insert(purchaseOrders).values({
        id,
        tenantId: ctx.tenantId,
        storeId: input.storeId,
        supplierId: input.supplierId,
        number: (last?.n ?? 0) + 1,
        expectedAt: input.expectedAt ?? null,
        notes: input.notes ?? null,
        totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
        createdBy: ctx.userId,
      });
      await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, orderId: id })));
      return this.view(tx, ctx, id);
    });
  }

  private async requireStatus(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    allowed: PurchaseOrderStatus[],
  ) {
    const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!order) throw notFound('Pedido de compra');
    assertStore(ctx, order.storeId);
    if (!allowed.includes(order.status)) {
      throw new AppError(
        409,
        'order_status',
        `O pedido nº ${order.number} está ${STATUS_LABEL[order.status]} e não pode mais ser alterado assim.`,
      );
    }
    return order;
  }

  /** Só o rascunho é editável. */
  async update(ctx: RequestContext, id: string, input: OrderInput): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => {
      await this.requireStatus(tx, ctx, id, ['draft']);
      const lines = await this.lines(tx, ctx, input);
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id));
      await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, orderId: id })));
      await tx
        .update(purchaseOrders)
        .set({
          storeId: input.storeId,
          supplierId: input.supplierId,
          expectedAt: input.expectedAt ?? null,
          notes: input.notes ?? null,
          totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id));
      return this.view(tx, ctx, id);
    });
  }

  /** Enviado ao fornecedor: o pedido fecha para edição. */
  async send(ctx: RequestContext, id: string): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => {
      const order = await this.requireStatus(tx, ctx, id, ['draft']);
      await tx
        .update(purchaseOrders)
        .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
        .where(eq(purchaseOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'purchase_order.sent',
        entity: 'purchase_order',
        entityId: id,
        data: { number: order.number, totalCents: order.totalCents },
      });
      return this.view(tx, ctx, id);
    });
  }

  async cancel(ctx: RequestContext, id: string, reason: string): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => {
      const order = await this.requireStatus(tx, ctx, id, ['draft', 'sent']);
      await tx
        .update(purchaseOrders)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'purchase_order.cancelled',
        entity: 'purchase_order',
        entityId: id,
        data: { number: order.number, reason, previousStatus: order.status },
      });
      return this.view(tx, ctx, id);
    });
  }

  /**
   * Entrada de mercadoria do pedido enviado (F4-02): o que chegou entra no estoque da loja, o
   * custo do produto vira o custo médio e o pedido fica recebido. Diferenças contra o pedido
   * ficam registradas no item e na auditoria.
   */
  async receive(ctx: RequestContext, id: string, input: ReceiveInput): Promise<PurchaseOrderView> {
    return withTenant(this.db, ctx, async (tx) => {
      const order = await this.requireStatus(tx, ctx, id, ['sent']);
      const items = await tx
        .select()
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.orderId, id))
        .orderBy(asc(purchaseOrderItems.line));
      const received = new Map(input.items.map((i) => [i.line, i.receivedMilli]));
      for (const line of received.keys()) {
        if (!items.some((i) => i.line === line)) {
          throw new AppError(422, 'invalid_line', `O pedido não tem a linha ${line}.`);
        }
      }
      const now = new Date();
      const divergences: {
        line: number;
        productId: string;
        orderedMilli: number;
        receivedMilli: number;
      }[] = [];
      for (const item of items) {
        const got = received.get(item.line) ?? 0;
        const [product] = await tx.select().from(products).where(eq(products.id, item.productId));
        if (!product) continue;
        if (!product.isWeighable && got % 1000 !== 0) {
          throw new AppError(
            422,
            'invalid_quantity',
            `${product.name} é recebido por unidade inteira.`,
          );
        }
        if (got !== item.quantityMilli) {
          divergences.push({
            line: item.line,
            productId: item.productId,
            orderedMilli: item.quantityMilli,
            receivedMilli: got,
          });
        }
        await tx
          .update(purchaseOrderItems)
          .set({ receivedMilli: got })
          .where(and(eq(purchaseOrderItems.orderId, id), eq(purchaseOrderItems.line, item.line)));
        if (got === 0) continue;
        const [stock] = await tx
          .select({ milli: sql<string>`coalesce(sum(${stockMovements.deltaMilli}), 0)::text` })
          .from(stockMovements)
          .where(eq(stockMovements.productId, item.productId));
        const costCents = averageCost(
          Number(stock?.milli ?? 0),
          product.costCents,
          got,
          item.unitCostCents,
        );
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: order.storeId,
          productId: item.productId,
          deltaMilli: got,
          reason: 'purchase',
          refId: id,
          note: `Pedido de compra nº ${order.number}`,
          actorId: ctx.userId,
          occurredAt: now,
        });
        if (costCents !== product.costCents) {
          await tx
            .update(products)
            .set({ costCents, updatedAt: now })
            .where(eq(products.id, product.id));
          // O custo novo vai às lojas vinculadas ao MercadoFlow, como na entrada pelo XML.
          const productCodes = await tx
            .select({ code: productBarcodes.code })
            .from(productBarcodes)
            .where(eq(productBarcodes.productId, product.id));
          await this.marketSync.enqueueProduct(tx, ctx.tenantId, {
            ...product,
            costCents,
            catalog: product.catalog ?? null,
            barcodes: productCodes.map((code) => code.code),
          });
        }
      }
      await tx
        .update(purchaseOrders)
        .set({ status: 'received', receivedAt: now, updatedAt: now })
        .where(eq(purchaseOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'purchase_order.received',
        entity: 'purchase_order',
        entityId: id,
        data: { number: order.number, divergences, note: input.note ?? null },
      });
      return this.view(tx, ctx, id);
    });
  }
}
