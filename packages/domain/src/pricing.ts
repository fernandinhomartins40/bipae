/**
 * Formação de preço (F4-03) pelo divisor de markup: o preço cobre o custo e ainda sobram, sobre o
 * próprio preço, a margem, os impostos da venda e as despesas.
 *
 *   preço = custo ÷ (1 − (margem + impostos + despesas) ÷ 100)
 *
 * Percentuais em centésimos de ponto (basis points: 12,5% = 1250) para a conta ficar em inteiros;
 * o preço sai em centavos, arredondado meio para cima.
 */
export interface PriceBreakdown {
  priceCents: number;
  /** Quanto do preço vai para cada parte, em centavos (somam o preço). */
  costCents: number;
  taxesCents: number;
  expensesCents: number;
  marginCents: number;
}

/** "12,5" ou "12.5" → 1250; null se inválido. */
export function percentToBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return value <= 10_000 ? value : null;
}

export class PricingError extends Error {}

export function markupPrice(input: {
  costCents: number;
  marginBp: number;
  taxesBp: number;
  expensesBp?: number;
}): PriceBreakdown {
  const expensesBp = input.expensesBp ?? 0;
  for (const v of [input.costCents, input.marginBp, input.taxesBp, expensesBp]) {
    if (!Number.isSafeInteger(v) || v < 0)
      throw new PricingError('Valores inválidos para formar o preço.');
  }
  const totalBp = input.marginBp + input.taxesBp + expensesBp;
  if (totalBp >= 10_000) {
    throw new PricingError(
      'Margem, impostos e despesas somam 100% ou mais do preço: não há preço que cubra.',
    );
  }
  const divisor = BigInt(10_000 - totalBp);
  const priceCents = Number((BigInt(input.costCents) * 20_000n + divisor) / (divisor * 2n));
  const share = (bp: number) => Number((BigInt(priceCents) * BigInt(bp) * 2n + 10_000n) / 20_000n);
  const taxesCents = share(input.taxesBp);
  const expensesCents = share(expensesBp);
  return {
    priceCents,
    costCents: input.costCents,
    taxesCents,
    expensesCents,
    // O que sobra fica na margem, para as partes somarem o preço exato.
    marginCents: priceCents - input.costCents - taxesCents - expensesCents,
  };
}
