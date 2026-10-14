import { Inject, Injectable } from '@nestjs/common';
import {
  uuidv7,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type purchaseOrderInput,
} from '@bipae/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { products, purchaseOrderItems, purchaseOrders, stores, suppliers } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type OrderInput = z.output<typeof purchaseOrderInput>;

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
}
