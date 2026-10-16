import type { SaleItem } from '@bipae/domain';

/**
 * Cart math (ADR-0008): integer cents and integer thousandths of quantity, explicit rounding.
 * Pure functions returning new carts, so the UI can undo and tests are trivial.
 */

export interface CatalogItem {
  id: string;
  name: string;
  unit: string;
  priceCents: number;
  isWeighable: boolean;
}

export interface CartLine {
  line: number;
  productId: string;
  name: string;
  unit: string;
  unitPriceCents: number;
  quantityMilli: number;
  /** Item discount in cents (already validated against the line gross). */
  discountCents: number;
  isWeighable: boolean;
}

export interface Cart {
  lines: CartLine[];
  /** Discount on the whole sale, allocated across lines when the sale closes. */
  saleDiscountCents: number;
  customerTaxId: string | null;
  quoteId: string | null;
  /** Comanda que este carrinho está mostrando (F5-07): mesa ou número. */
  tabId?: string | null;
  tabLabel?: string | null;
  /**
   * Promoções aplicadas (F5-02), calculadas a partir do carrinho por `withPromotions` a cada
   * mudança: desconto de cada item (número do item → centavos) e a lista para mostrar.
   */
  promotionDiscounts?: Record<number, number>;
  appliedPromotions?: AppliedPromotionView[];
}

export interface AppliedPromotionView {
  promotionId: string;
  name: string;
  discountCents: number;
}

export const EMPTY_CART: Cart = {
  lines: [],
  saleDiscountCents: 0,
  customerTaxId: null,
  quoteId: null,
};

export class CartError extends Error {}

/** price × quantity / 1000, half up. Safe up to ~R$ 90 bi × 1.000 un. */
export function lineGross(unitPriceCents: number, quantityMilli: number): number {
  return Math.floor((unitPriceCents * quantityMilli + 500) / 1000);
}

export function addItem(
  cart: Cart,
  item: CatalogItem,
  quantityMilli = 1000,
  priceCents?: number,
): Cart {
  if (!Number.isInteger(quantityMilli) || quantityMilli <= 0) {
    throw new CartError('Quantidade inválida.');
  }
  const unitPriceCents = priceCents ?? item.priceCents;
  // Same product (not weighed, same price) adds up on the same line, like a real register.
  const existing = cart.lines.find(
    (l) =>
      l.productId === item.id &&
      !l.isWeighable &&
      l.unitPriceCents === unitPriceCents &&
      l.discountCents === 0,
  );
  if (existing && !item.isWeighable) {
    return setQuantity(cart, existing.line, existing.quantityMilli + quantityMilli);
  }
  const line = (cart.lines.at(-1)?.line ?? 0) + 1;
  return {
    ...cart,
    lines: [
      ...cart.lines,
      {
        line,
        productId: item.id,
        name: item.name,
        unit: item.unit,
        unitPriceCents,
        quantityMilli,
        discountCents: 0,
        isWeighable: item.isWeighable,
      },
    ],
  };
}

function findLine(cart: Cart, line: number) {
  const found = cart.lines.find((l) => l.line === line);
  if (!found) throw new CartError('Item não encontrado no carrinho.');
  return found;
}

export function setQuantity(cart: Cart, line: number, quantityMilli: number): Cart {
  const current = findLine(cart, line);
  if (!Number.isInteger(quantityMilli) || quantityMilli <= 0) {
    throw new CartError('Quantidade inválida.');
  }
  if (!current.isWeighable && quantityMilli % 1000 !== 0) {
    throw new CartError(`"${current.name}" é vendido por unidade inteira.`);
  }
  const gross = lineGross(current.unitPriceCents, quantityMilli);
  return replaceLine(cart, {
    ...current,
    quantityMilli,
    discountCents: Math.min(current.discountCents, gross),
  });
}

export function removeLine(cart: Cart, line: number): Cart {
  findLine(cart, line);
  return { ...cart, lines: cart.lines.filter((l) => l.line !== line) };
}

export function setLineDiscount(cart: Cart, line: number, discountCents: number): Cart {
  const current = findLine(cart, line);
  const gross = lineGross(current.unitPriceCents, current.quantityMilli);
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > gross) {
    throw new CartError('O desconto não pode ser maior que o valor do item.');
  }
  return replaceLine(cart, { ...current, discountCents });
}

export function setSaleDiscount(cart: Cart, discountCents: number): Cart {
  const { subtotalCents, itemDiscountCents } = totals({ ...cart, saleDiscountCents: 0 });
  if (
    !Number.isInteger(discountCents) ||
    discountCents < 0 ||
    discountCents > subtotalCents - itemDiscountCents
  ) {
    throw new CartError('O desconto não pode ser maior que o total da venda.');
  }
  return { ...cart, saleDiscountCents: discountCents };
}

/**
 * Novos preços unitários para os itens que já estão no carrinho (F1-03: o cliente identificado
 * na venda tem tabela própria). Os descontos nunca passam dos novos valores.
 */
export function repriceLines(cart: Cart, prices: ReadonlyMap<string, number>): Cart {
  const lines = cart.lines.map((l) => {
    const price = prices.get(l.productId);
    if (price === undefined || price === l.unitPriceCents) return l;
    const gross = lineGross(price, l.quantityMilli);
    return { ...l, unitPriceCents: price, discountCents: Math.min(l.discountCents, gross) };
  });
  const next = { ...cart, lines };
  const { subtotalCents, itemDiscountCents } = totals({ ...next, saleDiscountCents: 0 });
  return {
    ...next,
    saleDiscountCents: Math.min(cart.saleDiscountCents, subtotalCents - itemDiscountCents),
  };
}

/** Percent (e.g. 10 for 10%) of the current total, rounded half up to cents. */
export function percentOf(cents: number, percent: number): number {
  return Math.floor((cents * Math.round(percent * 100) + 5000) / 10000);
}

function replaceLine(cart: Cart, updated: CartLine): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.line === updated.line ? updated : l)) };
}

export interface Totals {
  subtotalCents: number;
  /** Descontos nos itens: os do operador mais os das promoções. */
  itemDiscountCents: number;
  /** Só a parte das promoções (não conta no limite de desconto do operador). */
  promotionDiscountCents: number;
  saleDiscountCents: number;
  discountCents: number;
  totalCents: number;
  items: SaleItem[];
}

/**
 * Totals with the sale-level discount allocated proportionally across lines using the
 * largest-remainder method, so line totals always add up to the sale total (needed for
 * the fiscal document in Phase 3).
 */
export function totals(cart: Cart): Totals {
  const grosses = cart.lines.map((l) => lineGross(l.unitPriceCents, l.quantityMilli));
  const subtotalCents = grosses.reduce((a, b) => a + b, 0);
  // Desconto de promoção nunca passa do que sobra do item depois do desconto do operador.
  const promo = cart.lines.map((l, i) =>
    Math.min(cart.promotionDiscounts?.[l.line] ?? 0, grosses[i]! - l.discountCents),
  );
  const promotionDiscountCents = promo.reduce((a, b) => a + b, 0);
  const itemDiscountCents =
    cart.lines.reduce((a, l) => a + l.discountCents, 0) + promotionDiscountCents;
  const net = cart.lines.map((l, i) => grosses[i]! - l.discountCents - promo[i]!);
  const base = net.reduce((a, b) => a + b, 0);
  // O desconto na venda foi dado antes das promoções: nunca deixa o total negativo.
  const saleDiscountCents = Math.min(cart.saleDiscountCents, base);
  const allocation = allocate(saleDiscountCents, net, base);

  const items: SaleItem[] = cart.lines.map((l, i) => {
    const discountCents = l.discountCents + promo[i]! + allocation[i]!;
    return {
      line: l.line,
      productId: l.productId,
      name: l.name,
      unit: l.unit,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      grossCents: grosses[i]!,
      discountCents,
      totalCents: grosses[i]! - discountCents,
    };
  });
  const discountCents = itemDiscountCents + saleDiscountCents;
  return {
    subtotalCents,
    itemDiscountCents,
    promotionDiscountCents,
    saleDiscountCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    items,
  };
}

function allocate(amount: number, weights: number[], total: number): number[] {
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map(Math.floor);
  let remainder = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    floors[i]!++;
    remainder--;
  }
  return floors;
}

/**
 * Política de desconto: acima do limite do papel, alguém com permissão precisa autorizar.
 * Só conta o desconto dado pelo operador; o das promoções cadastradas fica de fora.
 */
export function discountNeedsAuthorization(cart: Cart, limitPercent: number): boolean {
  const t = totals(cart);
  const manual = t.discountCents - t.promotionDiscountCents;
  if (manual === 0) return false;
  return manual > percentOf(t.subtotalCents, limitPercent);
}
