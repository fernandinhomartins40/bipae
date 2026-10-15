import { applyPromotions, type Promotion } from '@bipae/promotions';
import type { Cart } from './cart';

/**
 * Aplica as promoções vigentes ao carrinho (F5-02). Devolve o mesmo carrinho com o desconto de
 * cada item e a lista do que foi aplicado; `totals` faz o resto. Item com desconto manual do
 * operador fica fora das promoções.
 */
export function withPromotions(cart: Cart, promotions: readonly Promotion[], date: string): Cart {
  if (promotions.length === 0 || cart.lines.length === 0) {
    const { promotionDiscounts: _d, appliedPromotions: _a, ...rest } = cart;
    return rest;
  }
  const result = applyPromotions(
    cart.lines.map((l) => ({
      line: l.line,
      productId: l.productId,
      unitPriceCents: l.unitPriceCents,
      quantityMilli: l.quantityMilli,
      isWeighable: l.isWeighable,
      eligible: l.discountCents === 0,
    })),
    promotions,
    date,
  );
  return {
    ...cart,
    promotionDiscounts: Object.fromEntries(result.byLine),
    appliedPromotions: result.applied,
  };
}

export type { Promotion } from '@bipae/promotions';

/** O dia no relógio do caixa (AAAA-MM-DD), que decide a vigência da promoção. */
export function localDay(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}
