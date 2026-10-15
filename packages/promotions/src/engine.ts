/**
 * Motor de promoções do caixa (F5-02). Puro, sem I/O: recebe os itens do carrinho e as
 * promoções vigentes e devolve o desconto de cada item, em centavos inteiros.
 *
 * Regras de aplicação:
 * - cada unidade entra em no máximo uma promoção (não acumulam);
 * - ordem fixa: combo, depois "leve X pague Y", depois faixa de quantidade;
 * - item com desconto manual do operador fica fora das promoções;
 * - "leve X pague Y" e combo contam unidades inteiras; produto pesado só entra na faixa;
 * - promoção que não deixaria o preço menor não é aplicada.
 */

export type PromotionRule =
  | {
      kind: 'buy_x_pay_y';
      /** Produtos que contam juntos (ex.: qualquer sabor do mesmo suco). */
      productIds: string[];
      buy: number;
      pay: number;
    }
  | {
      kind: 'quantity_tier';
      productIds: string[];
      /** A partir de tal quantidade (em milésimos), cada unidade sai por tal preço. */
      tiers: { minQuantityMilli: number; unitPriceCents: number }[];
    }
  | {
      kind: 'combo';
      items: { productId: string; quantityMilli: number }[];
      /** Preço do combo inteiro. */
      priceCents: number;
    };

export interface Promotion {
  id: string;
  name: string;
  /** Primeiro dia (AAAA-MM-DD). */
  startsOn: string;
  /** Último dia, inclusive; null = sem data para acabar. */
  endsOn: string | null;
  rule: PromotionRule;
}

export interface PromotionLine {
  line: number;
  productId: string;
  unitPriceCents: number;
  quantityMilli: number;
  isWeighable: boolean;
  /** false quando o operador já deu desconto manual no item. */
  eligible: boolean;
}

export interface PromotionDiscount {
  line: number;
  promotionId: string;
  discountCents: number;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  discountCents: number;
}

export interface PromotionResult {
  /** Desconto de cada item (um item pode ter partes em promoções diferentes). */
  discounts: PromotionDiscount[];
  applied: AppliedPromotion[];
  /** Soma por item, para o carrinho. */
  byLine: Map<number, number>;
}

const ORDER: Record<PromotionRule['kind'], number> = {
  combo: 0,
  buy_x_pay_y: 1,
  quantity_tier: 2,
};

/** preço × quantidade ÷ 1000, meio para cima (a mesma conta do carrinho). */
export function gross(unitPriceCents: number, quantityMilli: number): number {
  return Math.floor((unitPriceCents * quantityMilli + 500) / 1000);
}

export function isActiveOn(promotion: Promotion, date: string): boolean {
  return promotion.startsOn <= date && (promotion.endsOn === null || date <= promotion.endsOn);
}

/** Reparte `amount` pelos pesos, maior resto primeiro, para a soma bater exatamente. */
function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map(Math.floor);
  let rest = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest === 0) break;
    floors[i]!++;
    rest--;
  }
  return floors;
}

export function applyPromotions(
  lines: readonly PromotionLine[],
  promotions: readonly Promotion[],
  date: string,
): PromotionResult {
  /** Quantidade de cada item ainda livre para promoção, em milésimos. */
  const free = new Map<number, number>();
  for (const l of lines) if (l.eligible && l.quantityMilli > 0) free.set(l.line, l.quantityMilli);
  const discounts: PromotionDiscount[] = [];
  const applied: AppliedPromotion[] = [];

  const active = promotions
    .filter((p) => isActiveOn(p, date))
    .sort((a, b) => ORDER[a.rule.kind] - ORDER[b.rule.kind] || a.id.localeCompare(b.id));

  for (const promotion of active) {
    const found = run(promotion, lines, free);
    const total = found.reduce((s, d) => s + d.discountCents, 0);
    if (total <= 0) continue;
    discounts.push(...found.filter((d) => d.discountCents > 0));
    applied.push({ promotionId: promotion.id, name: promotion.name, discountCents: total });
  }

  const byLine = new Map<number, number>();
  for (const d of discounts) byLine.set(d.line, (byLine.get(d.line) ?? 0) + d.discountCents);
  // Garantia final: o desconto nunca passa do valor do item.
  for (const l of lines) {
    const value = byLine.get(l.line);
    if (value !== undefined)
      byLine.set(l.line, Math.min(value, gross(l.unitPriceCents, l.quantityMilli)));
  }
  return { discounts, applied, byLine };
}

/** Unidades inteiras livres de um item (produto pesado não conta). */
function wholeUnits(line: PromotionLine, free: Map<number, number>): number {
  if (line.isWeighable) return 0;
  return Math.floor((free.get(line.line) ?? 0) / 1000);
}

function run(
  promotion: Promotion,
  lines: readonly PromotionLine[],
  free: Map<number, number>,
): PromotionDiscount[] {
  const rule = promotion.rule;
  const id = promotion.id;

  if (rule.kind === 'combo') {
    const parts = rule.items.map((item) => {
      const units = Math.floor(item.quantityMilli / 1000);
      const pool = lines.filter((l) => l.productId === item.productId && wholeUnits(l, free) > 0);
      const available = pool.reduce((s, l) => s + wholeUnits(l, free), 0);
      return { units, pool, available };
    });
    if (parts.some((p) => p.units <= 0)) return [];
    const count = Math.min(...parts.map((p) => Math.floor(p.available / p.units)));
    if (count <= 0) return [];
    // Unidades que entram nos combos, item a item, na ordem do carrinho.
    const taken: { line: number; units: number; value: number }[] = [];
    for (const part of parts) {
      let need = part.units * count;
      for (const l of part.pool) {
        if (need === 0) break;
        const use = Math.min(need, wholeUnits(l, free));
        taken.push({ line: l.line, units: use, value: use * l.unitPriceCents });
        need -= use;
      }
    }
    const normal = taken.reduce((s, t) => s + t.value, 0);
    const discount = normal - rule.priceCents * count;
    if (discount <= 0) return [];
    for (const t of taken) free.set(t.line, (free.get(t.line) ?? 0) - t.units * 1000);
    const shares = allocate(
      discount,
      taken.map((t) => t.value),
    );
    return taken.map((t, i) => ({ line: t.line, promotionId: id, discountCents: shares[i]! }));
  }

  if (rule.kind === 'buy_x_pay_y') {
    if (rule.buy <= 0 || rule.pay < 0 || rule.pay >= rule.buy) return [];
    const units: { line: number; price: number }[] = [];
    for (const l of lines) {
      if (!rule.productIds.includes(l.productId)) continue;
      for (let i = 0; i < wholeUnits(l, free); i++)
        units.push({ line: l.line, price: l.unitPriceCents });
    }
    // Do mais caro para o mais barato: em cada grupo, saem de graça as unidades mais baratas.
    units.sort((a, b) => b.price - a.price || a.line - b.line);
    const groups = Math.floor(units.length / rule.buy);
    const out = new Map<number, number>();
    for (let g = 0; g < groups; g++) {
      const group = units.slice(g * rule.buy, (g + 1) * rule.buy);
      for (const unit of group) free.set(unit.line, (free.get(unit.line) ?? 0) - 1000);
      for (const unit of group.slice(rule.pay)) {
        out.set(unit.line, (out.get(unit.line) ?? 0) + unit.price);
      }
    }
    return [...out].map(([line, discountCents]) => ({ line, promotionId: id, discountCents }));
  }

  // Faixa de quantidade: a quantidade livre dos produtos do grupo, somada, escolhe a faixa.
  const pool = lines.filter(
    (l) => rule.productIds.includes(l.productId) && (free.get(l.line) ?? 0) > 0,
  );
  const quantity = pool.reduce((s, l) => s + (free.get(l.line) ?? 0), 0);
  const tier = [...rule.tiers]
    .filter((t) => t.minQuantityMilli <= quantity)
    .sort((a, b) => b.minQuantityMilli - a.minQuantityMilli)[0];
  if (!tier) return [];
  const out: PromotionDiscount[] = [];
  for (const l of pool) {
    const milli = free.get(l.line)!;
    if (tier.unitPriceCents >= l.unitPriceCents) continue;
    free.set(l.line, 0);
    out.push({
      line: l.line,
      promotionId: id,
      discountCents: gross(l.unitPriceCents, milli) - gross(tier.unitPriceCents, milli),
    });
  }
  return out;
}
