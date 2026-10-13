import { dec, fromCents, percent, toCents, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { assertBase, money, pct, step, TaxRuleDataError } from './shared';

/**
 * Imposto Seletivo (IS), cobrado a partir de 2027. As alíquotas serão fixadas em lei ordinária e
 * podem ser percentuais, por unidade de medida, ou as duas coisas (Constituição, art. 153, § 6º,
 * VI). O motor não traz nenhuma alíquota: tudo vem da regra, quando a lei existir.
 */
export interface IsEffect {
  /** Alíquota percentual sobre a base. */
  rate?: string;
  /** Valor por unidade de medida, em reais. */
  amountPerUnit?: string;
  rounding?: RoundingMode;
}

export interface IsResult {
  baseCents: number;
  rate: string | null;
  quantity: string | null;
  amountPerUnit: string | null;
  amountCents: number;
  trace: TraceStep[];
}

export function calculateIs(effect: IsEffect, input: { baseCents: number; quantity?: string }): IsResult {
  assertBase(input.baseCents);
  if (effect.rate === undefined && effect.amountPerUnit === undefined) {
    throw new TaxRuleDataError('IS', 'sem alíquota', 'informe a alíquota percentual, o valor por unidade, ou os dois');
  }
  const mode = effect.rounding ?? 'half-up';
  const trace: TraceStep[] = [step('Base de cálculo', money(input.baseCents))];
  const result: IsResult = {
    baseCents: input.baseCents,
    rate: null,
    quantity: null,
    amountPerUnit: null,
    amountCents: 0,
    trace,
  };
  if (effect.rate !== undefined) {
    const rate = dec(effect.rate);
    if (rate.isNegative()) throw new TaxRuleDataError('IS', 'alíquota', `alíquota negativa: ${effect.rate}`);
    const amount = toCents(fromCents(input.baseCents).mul(percent(rate)), mode);
    result.rate = rate.toFixed(2);
    result.amountCents += amount;
    trace.push(step(`IS a ${pct(rate)}`, money(amount), `${money(input.baseCents)} × ${pct(rate)}`));
  }
  if (effect.amountPerUnit !== undefined) {
    if (input.quantity === undefined) throw new Error('IS por unidade: informe a quantidade');
    const perUnit = dec(effect.amountPerUnit);
    const quantity = dec(input.quantity);
    if (perUnit.isNegative() || quantity.isNegative()) {
      throw new TaxRuleDataError('IS', 'por unidade', 'quantidade e valor por unidade não podem ser negativos');
    }
    const amount = toCents(quantity.mul(perUnit), mode);
    result.quantity = quantity.toFixed(4);
    result.amountPerUnit = perUnit.toFixed(4);
    result.amountCents += amount;
    trace.push(step('IS por unidade', money(amount), `${result.quantity} × R$ ${result.amountPerUnit}`));
  }
  return result;
}
