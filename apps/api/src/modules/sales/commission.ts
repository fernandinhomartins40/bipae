/**
 * Cálculo da comissão (F8-02), puro e sem banco.
 *
 * Regras decididas pelo dono do projeto em 20/10/2026 (ADR-0017):
 * - Cada vendedor tem um %; produto ou categoria podem ter um % próprio, que vale no lugar do
 *   dele (produto antes de categoria).
 * - Só conta venda paga: a parte paga na hora conta no dia da venda; a parte no crediário, no
 *   dia em que o cliente paga. Sempre com o % do dia da venda.
 * - Devolução desconta do vendedor do item, no dia da devolução. Devolução que só abateu o
 *   crediário não desconta: aquela parte nunca chegou a contar.
 * - Venda cancelada não conta.
 *
 * Arredondamento (ADR-0008): soma base × % em inteiros e arredonda uma vez, meio para cima.
 */

export interface CommissionRate {
  sellerId: string | null;
  productId: string | null;
  category: string | null;
  /** Centésimos de ponto (250 = 2,5%); nulo encerra a exceção. */
  rateBp: number | null;
  startsOn: string;
}

export interface RateQuery {
  sellerId: string;
  productId: string;
  category: string | null;
  /** Dia da venda (AAAA-MM-DD). */
  day: string;
}

/** A linha mais recente que já vale no dia; nulo quando nunca houve ou a exceção acabou. */
function latest(rates: CommissionRate[], day: string, match: (r: CommissionRate) => boolean) {
  let best: CommissionRate | null = null;
  for (const r of rates) {
    if (r.startsOn > day || !match(r)) continue;
    if (!best || r.startsOn >= best.startsOn) best = r;
  }
  return best;
}

const sameCategory = (a: string | null, b: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** % do item no dia: produto, senão categoria, senão o do vendedor, senão zero. */
export function rateFor(rates: CommissionRate[], q: RateQuery): number {
  const product = latest(rates, q.day, (r) => r.productId === q.productId);
  if (product?.rateBp != null) return product.rateBp;
  const category = latest(rates, q.day, (r) => sameCategory(r.category, q.category));
  if (category?.rateBp != null) return category.rateBp;
  return latest(rates, q.day, (r) => r.sellerId === q.sellerId)?.rateBp ?? 0;
}

/** Um pedaço de base de comissão: positivo (venda, crediário recebido) ou negativo (devolução). */
export interface CommissionEntry {
  sellerId: string;
  kind: 'sale' | 'credit' | 'return';
  baseCents: number;
  rateBp: number;
}

export interface CommissionTotals {
  sellerId: string;
  salesCents: number;
  creditReceivedCents: number;
  returnsCents: number;
  baseCents: number;
  commissionCents: number;
}

/** Soma por vendedor e arredonda uma vez (meio para cima; negativo arredonda para zero). */
export function totalize(entries: CommissionEntry[]): CommissionTotals[] {
  const by = new Map<string, CommissionTotals & { scaled: bigint }>();
  for (const e of entries) {
    const t =
      by.get(e.sellerId) ??
      ({
        sellerId: e.sellerId,
        salesCents: 0,
        creditReceivedCents: 0,
        returnsCents: 0,
        baseCents: 0,
        commissionCents: 0,
        scaled: 0n,
      } as CommissionTotals & { scaled: bigint });
    if (e.kind === 'sale') t.salesCents += e.baseCents;
    if (e.kind === 'credit') t.creditReceivedCents += e.baseCents;
    if (e.kind === 'return') t.returnsCents += -e.baseCents;
    t.baseCents += e.baseCents;
    t.scaled += BigInt(e.baseCents) * BigInt(e.rateBp);
    by.set(e.sellerId, t);
  }
  return [...by.values()].map(({ scaled, ...t }) => {
    const sign = scaled < 0n ? -1n : 1n;
    const abs = scaled * sign;
    return { ...t, commissionCents: Number(((abs * 2n + 10_000n) / 20_000n) * sign) };
  });
}

/**
 * Divide um valor entre partes proporcionalmente (centavos inteiros); a sobra dos
 * arredondamentos vai para as maiores partes, então a soma bate sempre com o total.
 */
export function allocate(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const out = raw.map(Math.floor);
  let rest = totalCents - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || weights[b.i]! - weights[a.i]!);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i]! += 1;
    rest--;
  }
  return out;
}
