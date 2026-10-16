import { asc, inArray, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { productBarcodes, products, saleItems, salePayments, sales } from '../../db/schema';

/**
 * O formato público de produto e de venda (ADR-0016), o mesmo na leitura pela API e no corpo
 * dos webhooks. Dinheiro em centavos e quantidades em milésimos.
 */

export async function publicProducts(tx: Tx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      priceCents: products.priceCents,
      active: products.active,
      ncm: products.ncm,
      cest: products.cest,
      parentId: products.parentId,
      attributes: products.attributes,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(where)
    .orderBy(asc(products.id));
  const rows = limit ? await query.limit(limit) : await query;
  const codes = rows.length
    ? await tx
        .select({ productId: productBarcodes.productId, code: productBarcodes.code })
        .from(productBarcodes)
        .where(
          inArray(
            productBarcodes.productId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    barcodes: codes.filter((c) => c.productId === r.id).map((c) => c.code),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function publicSales(tx: Tx, where: SQL | undefined, limit?: number) {
  const query = tx
    .select({
      id: sales.id,
      storeId: sales.storeId,
      terminalId: sales.terminalId,
      kind: sales.kind,
      status: sales.status,
      originalSaleId: sales.originalSaleId,
      subtotalCents: sales.subtotalCents,
      discountCents: sales.discountCents,
      totalCents: sales.totalCents,
      occurredAt: sales.occurredAt,
      cancelledAt: sales.cancelledAt,
    })
    .from(sales)
    .where(where)
    .orderBy(asc(sales.id));
  const rows = limit ? await query.limit(limit) : await query;
  const ids = rows.map((r) => r.id);
  const [items, payments] = ids.length
    ? await Promise.all([
        tx
          .select({
            saleId: saleItems.saleId,
            line: saleItems.line,
            productId: saleItems.productId,
            name: saleItems.name,
            unit: saleItems.unit,
            quantityMilli: saleItems.quantityMilli,
            unitPriceCents: saleItems.unitPriceCents,
            discountCents: saleItems.discountCents,
            totalCents: saleItems.totalCents,
          })
          .from(saleItems)
          .where(inArray(saleItems.saleId, ids))
          .orderBy(asc(saleItems.line)),
        tx
          .select({
            saleId: salePayments.saleId,
            method: salePayments.method,
            amountCents: salePayments.amountCents,
            changeCents: salePayments.changeCents,
          })
          .from(salePayments)
          .where(inArray(salePayments.saleId, ids))
          .orderBy(asc(salePayments.idx)),
      ])
    : [[], []];
  return rows.map((r) => ({
    ...r,
    occurredAt: r.occurredAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    items: items.filter((i) => i.saleId === r.id).map(({ saleId: _s, ...i }) => i),
    payments: payments.filter((p) => p.saleId === r.id).map(({ saleId: _s, ...p }) => p),
  }));
}
