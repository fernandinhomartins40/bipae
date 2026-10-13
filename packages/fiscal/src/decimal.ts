import DecimalJs from 'decimal.js';

/**
 * Decimal de precisão arbitrária para o cálculo fiscal (ADR-0008). Dinheiro entra e sai em
 * centavos inteiros; no meio do caminho (base × alíquota, reduções, rateios) nada usa ponto
 * flutuante, e todo arredondamento é explícito.
 */
const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Decimal>;

/** Arredondamento por campo; vem da tabela de regras, nunca fixo no cálculo (dúvida D-008). */
export type RoundingMode = 'half-up' | 'half-even' | 'truncate';

const MODES: Record<RoundingMode, DecimalJs.Rounding> = {
  'half-up': DecimalJs.ROUND_HALF_UP,
  'half-even': DecimalJs.ROUND_HALF_EVEN,
  truncate: DecimalJs.ROUND_DOWN,
};

export function dec(value: number | string | Dec): Dec {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error(`Valor numérico inválido: ${String(value)}`);
  return result;
}

export function round(value: Dec, places = 2, mode: RoundingMode = 'half-up'): Dec {
  return value.toDecimalPlaces(places, MODES[mode]);
}

/** Centavos inteiros → decimal em reais (1234 → 12.34). */
export function fromCents(cents: number): Dec {
  if (!Number.isSafeInteger(cents)) throw new Error(`Centavos precisam ser um número inteiro: ${cents}`);
  return dec(cents).div(100);
}

/** Decimal em reais → centavos inteiros, com o arredondamento indicado. */
export function toCents(value: Dec, mode: RoundingMode = 'half-up'): number {
  const cents = round(value.mul(100), 0, mode).toNumber();
  if (!Number.isSafeInteger(cents)) throw new Error('Valor grande demais para centavos');
  return cents;
}

/** Percentual como aparece na legislação ("18", "0.9") → fração (0.18, 0.009). */
export function percent(rate: number | string | Dec): Dec {
  return dec(rate).div(100);
}

/** Texto com casas fixas, como o leiaute dos documentos fiscais pede ("1234.50"). */
export function format(value: Dec, places = 2): string {
  return round(value, places).toFixed(places);
}
