import { ALL_PERMISSIONS } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { asPlatform, type Db, type Tx } from '../../db/client';
import {
  memberships,
  priceTableItems,
  productBarcodes,
  products,
  roles,
  stores,
} from '../../db/schema';

/** Apoio das pendências do MercadoFlow (MF-11): preço da loja, produto e quem assina. */

/** O preço atual do produto na loja: o da tabela de preço dela, senão o do cadastro. */
export async function storePrice(tx: Tx, storeId: string, productId: string) {
  const [store] = await tx
    .select({ priceTableId: stores.priceTableId })
    .from(stores)
    .where(eq(stores.id, storeId));
  if (store?.priceTableId) {
    const [item] = await tx
      .select({ priceCents: priceTableItems.priceCents })
      .from(priceTableItems)
      .where(
        and(
          eq(priceTableItems.priceTableId, store.priceTableId),
          eq(priceTableItems.productId, productId),
        ),
      );
    if (item) return item.priceCents;
  }
  const [product] = await tx
    .select({ priceCents: products.priceCents })
    .from(products)
    .where(eq(products.id, productId));
  return product?.priceCents ?? null;
}

export async function productByGtin(tx: Tx, gtin: string) {
  const [row] = await tx
    .select({ id: products.id, name: products.name })
    .from(productBarcodes)
    .innerJoin(products, eq(products.id, productBarcodes.productId))
    .where(eq(productBarcodes.code, gtin));
  return row ?? null;
}

/**
 * Quem assina a aplicação automática na auditoria: o dono da empresa (a opção automática foi
 * ligada por alguém com permissão de gerenciar lojas).
 */
export async function ownerContext(db: Db, tenantId: string): Promise<RequestContext | null> {
  const [owner] = await asPlatform(db, (tx) =>
    tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(roles.systemKey, 'owner'),
          eq(memberships.active, true),
        ),
      )
      .limit(1),
  );
  return owner
    ? {
        tenantId,
        userId: owner.userId,
        permissions: [...ALL_PERMISSIONS],
        terminalId: null,
        storeIds: null,
      }
    : null;
}
