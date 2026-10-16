import { Inject, Injectable, Logger } from '@nestjs/common';
import { purchaseOrderInput, uuidv7 } from '@bipae/domain';
import { dec, round, toCents } from '@bipae/fiscal';
import { and, eq } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, parse } from '../../common/errors';
import { asPlatform, withTenant, type Db, type Tx } from '../../db/client';
import { mercadoflowLinks, mercadoflowPendings, suppliers } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { PurchaseOrdersService } from '../purchases/purchase-orders.service';
import { asTenant } from './mercadoflow.confere';
import { ownerContext, productByGtin } from './mercadoflow.pendings.helpers';
import { MercadoflowWebhooks, type MercadoflowEvent } from './mercadoflow.webhook';

/** Um item do pedido guardado na pendência. */
export interface OrderItem {
  gtin: string;
  description: string;
  /** Quantidade em milésimos (unidades de compra). */
  quantityMilli: number;
  unitCostCents: number;
  productId: string | null;
  productName: string | null;
}

/** O pedido guardado na pendência. */
export interface OrderData {
  orderNumber: string;
  supplierCnpj: string;
  supplierName: string;
  supplierId: string | null;
  totalCents: number | null;
  items: OrderItem[];
  /** Pedido de compra criado no Bipaê. */
  purchaseOrderId?: string;
}

interface RemoteItem {
  gtin?: unknown;
  description?: unknown;
  name?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  unitPrice?: unknown;
  price?: unknown;
}

/** Valor do JSON em decimal (sem conta de ponto flutuante); inválido vira null. */
const decimal = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    return dec(String(value));
  } catch {
    return null;
  }
};

const cnpjDigits = (value: unknown) => (typeof value === 'string' ? value.replace(/\D/g, '') : '');

/** O que falta para o pedido virar pedido de compra, em linguagem simples. */
function problemOf(data: OrderData): string | null {
  const missing: string[] = [];
  if (!data.supplierId) {
    missing.push(
      `Cadastre o fornecedor ${data.supplierName} (CNPJ ${data.supplierCnpj}) em Fornecedores.`,
    );
  }
  const products = data.items.filter((i) => !i.productId);
  if (products.length > 0) {
    missing.push(
      `Cadastre ${products.length === 1 ? 'o produto' : `os ${products.length} produtos`} ${products
        .slice(0, 3)
        .map((i) => `${i.description} (${i.gtin})`)
        .join(', ')}${products.length > 3 ? ' e outros' : ''}.`,
    );
  }
  return missing.length ? missing.join(' ') : null;
}

/**
 * Pedido enviado ao fornecedor pelo MercadoFlow (MF-11.c, aviso order.sent). Quando o
 * fornecedor (pelo CNPJ) e os produtos (pelo código de barras) estão cadastrados, o Bipaê cria o
 * pedido de compra já como "Enviado ao fornecedor", para a entrada da mercadoria conferir
 * depois. Senão, o pedido espera numa pendência que diz o que cadastrar; depois de cadastrar,
 * "Aplicar" cria o pedido. Nada é cadastrado sozinho (seção 1 do contrato).
 */
@Injectable()
export class MercadoflowOrders {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowWebhooks) webhooks: MercadoflowWebhooks,
  ) {
    webhooks.on('order.sent', (tx, event) => this.received(tx, event));
    webhooks.after('order.sent', (event) => this.createWhenReady(event));
  }

  /** Fornecedor e produtos, procurados de novo (podem ter sido cadastrados depois). */
  private async resolve(tx: Tx, data: OrderData): Promise<OrderData> {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.taxId, data.supplierCnpj));
    const items: OrderItem[] = [];
    for (const item of data.items) {
      const product = await productByGtin(tx, item.gtin);
      items.push({ ...item, productId: product?.id ?? null, productName: product?.name ?? null });
    }
    return { ...data, supplierId: supplier?.id ?? null, items };
  }

  private async received(tx: Tx, event: MercadoflowEvent) {
    const raw = event.data as {
      orderNumber?: unknown;
      supplierCnpj?: unknown;
      supplierName?: unknown;
      totalValue?: unknown;
      items?: RemoteItem[];
    };
    const orderNumber =
      typeof raw.orderNumber === 'string' || typeof raw.orderNumber === 'number'
        ? String(raw.orderNumber).slice(0, 40)
        : '';
    const supplierCnpj = cnpjDigits(raw.supplierCnpj);
    if (!event.marketId || !orderNumber || supplierCnpj.length !== 14) {
      throw new Error('Aviso de pedido sem número ou sem CNPJ do fornecedor.');
    }
    const items: OrderItem[] = [];
    for (const item of raw.items ?? []) {
      const gtin = typeof item.gtin === 'string' ? item.gtin.trim() : '';
      const quantity = decimal(item.quantity);
      if (!/^\d{8,14}$/.test(gtin) || !quantity || quantity.lte(0)) continue;
      const cost = decimal(item.unitCost ?? item.unitPrice ?? item.price);
      items.push({
        gtin,
        description: String(item.description ?? item.name ?? gtin).slice(0, 120),
        quantityMilli: round(quantity.mul(1000), 0).toNumber(),
        unitCostCents: cost && cost.gte(0) ? toCents(cost) : 0,
        productId: null,
        productName: null,
      });
    }
    if (items.length === 0) throw new Error('Aviso de pedido sem itens válidos.');
    const total = decimal(raw.totalValue);
    const [link] = await tx
      .select()
      .from(mercadoflowLinks)
      .where(
        and(eq(mercadoflowLinks.marketId, event.marketId), eq(mercadoflowLinks.status, 'ATIVA')),
      );
    if (!link) throw new Error('Nenhuma loja do Bipaê tem este mercado.');
    await asTenant(tx, link.tenantId, async () => {
      const [existing] = await tx
        .select({ status: mercadoflowPendings.status })
        .from(mercadoflowPendings)
        .where(
          and(
            eq(mercadoflowPendings.storeId, link.storeId),
            eq(mercadoflowPendings.kind, 'order'),
            eq(mercadoflowPendings.sourceKey, orderNumber),
          ),
        );
      // Pedido já criado no Bipaê: um aviso repetido não cria outro.
      if (existing && existing.status !== 'pending') return;
      const data = await this.resolve(tx, {
        orderNumber,
        supplierCnpj,
        supplierName: String(raw.supplierName ?? supplierCnpj).slice(0, 120),
        supplierId: null,
        totalCents: total && total.gte(0) ? toCents(total) : null,
        items,
      });
      const values = {
        data: data as unknown as Record<string, unknown>,
        problem: problemOf(data),
        updatedAt: new Date(),
      };
      if (existing) {
        await tx
          .update(mercadoflowPendings)
          .set(values)
          .where(
            and(
              eq(mercadoflowPendings.storeId, link.storeId),
              eq(mercadoflowPendings.kind, 'order'),
              eq(mercadoflowPendings.sourceKey, orderNumber),
            ),
          );
      } else {
        await tx.insert(mercadoflowPendings).values({
          id: uuidv7(),
          tenantId: link.tenantId,
          storeId: link.storeId,
          marketId: event.marketId!,
          kind: 'order',
          sourceKey: orderNumber,
          ...values,
        });
      }
    });
  }

  /** Com tudo cadastrado, o pedido de compra nasce logo depois do aviso. */
  private async createWhenReady(event: MercadoflowEvent) {
    const orderNumber = String((event.data as { orderNumber?: unknown }).orderNumber ?? '');
    const [row] = await asPlatform(this.db, (tx) =>
      tx
        .select()
        .from(mercadoflowPendings)
        .where(
          and(
            eq(mercadoflowPendings.marketId, event.marketId ?? ''),
            eq(mercadoflowPendings.kind, 'order'),
            eq(mercadoflowPendings.sourceKey, orderNumber),
            eq(mercadoflowPendings.status, 'pending'),
          ),
        ),
    );
    if (!row || row.problem) return;
    const ctx = await ownerContext(this.db, row.tenantId);
    if (!ctx) return;
    await this.apply(ctx, row, true).catch((error: Error) =>
      this.logger.warn(`Pedido ${orderNumber} do MercadoFlow não criado: ${error.message}`),
    );
  }

  /** Cria o pedido de compra já enviado ao fornecedor. */
  async apply(
    ctx: RequestContext,
    row: typeof mercadoflowPendings.$inferSelect,
    automatic = false,
  ) {
    const data = await withTenant(this.db, ctx, (tx) =>
      this.resolve(tx, row.data as unknown as OrderData),
    );
    const problem = problemOf(data);
    if (problem) {
      await withTenant(this.db, ctx, (tx) =>
        tx
          .update(mercadoflowPendings)
          .set({
            data: data as unknown as Record<string, unknown>,
            problem,
            updatedAt: new Date(),
          })
          .where(eq(mercadoflowPendings.id, row.id)),
      );
      throw new AppError(409, 'missing_registration', problem);
    }
    const order = await this.orders.create(
      ctx,
      parse(purchaseOrderInput, {
        storeId: row.storeId,
        supplierId: data.supplierId,
        notes: `Pedido nº ${data.orderNumber} enviado ao fornecedor pelo MercadoFlow.`,
        items: data.items.map((i) => ({
          productId: i.productId,
          quantityMilli: i.quantityMilli,
          unitCostCents: i.unitCostCents,
        })),
      }),
    );
    await this.orders.send(ctx, order.id);
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .update(mercadoflowPendings)
        .set({
          status: 'applied',
          problem: null,
          data: { ...data, purchaseOrderId: order.id } as unknown as Record<string, unknown>,
          resolvedBy: ctx.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mercadoflowPendings.id, row.id));
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.order_received',
        entity: 'purchase_order',
        entityId: order.id,
        data: { orderNumber: data.orderNumber, supplierCnpj: data.supplierCnpj, automatic },
      });
    });
    return { ok: true, purchaseOrderId: order.id, number: order.number };
  }
}
