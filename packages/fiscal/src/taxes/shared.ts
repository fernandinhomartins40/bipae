import { format, fromCents, type Dec } from '../decimal';
import type { TraceStep } from '../engine';

/** Situação tributária que o motor ainda não sabe calcular. Nunca vira cálculo aproximado. */
export class UnsupportedTaxSituationError extends Error {
  constructor(
    readonly tax: string,
    readonly code: string,
  ) {
    super(
      `O cálculo de ${tax} para a situação tributária ${code} ainda não está disponível no Bipaê. ` +
        'Use outra situação ou informe os valores com o seu contador.',
    );
  }
}

/** Regra de tributo com dado faltando ou incoerente: é erro na tabela de regras, não na venda. */
export class TaxRuleDataError extends Error {
  constructor(tax: string, code: string, problem: string) {
    super(`Regra de ${tax} (${code}) incompleta: ${problem}`);
  }
}

export const money = (cents: number) => format(fromCents(cents), 2);
export const pct = (value: Dec) => `${format(value, 2)}%`;

export function assertBase(cents: number, label = 'Base de cálculo'): void {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`${label} inválida: ${cents}`);
}

export const step = (label: string, value: string, formula?: string): TraceStep => ({
  label,
  ...(formula !== undefined && { formula }),
  value,
});
