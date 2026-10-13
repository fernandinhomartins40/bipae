import { dec, fromCents, percent, toCents, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { findTaxSituation } from '../tables/tax-situations';
import { assertBase, money, pct, step, TaxRuleDataError } from './shared';

/**
 * PIS e COFINS dos regimes atuais (valem até 2026; extintos em 2027). As duas contribuições têm
 * a mesma tabela de CST e a mesma forma de cálculo; muda só a alíquota, que vem da regra.
 */
export type ContributionTax = 'PIS' | 'COFINS';

export interface ContributionEffect {
  cst: string;
  /** Alíquota em percentual (CST 01 e 02; opcional nos CST "outras operações"). */
  rate?: string;
  /** Valor por unidade de produto, em reais (CST 03), ex.: "0.0350". */
  amountPerUnit?: string;
  /** Tirar da base o ICMS que incidiu na operação? Vem da regra do regime, nunca suposto. */
  excludeIcms?: boolean;
  rounding?: RoundingMode;
}

export interface ContributionInput {
  /** Valor da operação em centavos. */
  baseCents: number;
  /** ICMS próprio destacado no item, para quando a regra manda tirá-lo da base. */
  icmsCents?: number;
  /** Quantidade vendida, na unidade da alíquota (CST 03). */
  quantity?: string;
}

export interface ContributionResult {
  tax: ContributionTax;
  cst: string;
  /** Grupo do XML ("PISAliq", "COFINSNT"...). */
  group: string;
  baseCents: number;
  rate: string | null;
  quantity: string | null;
  amountPerUnit: string | null;
  amountCents: number;
  trace: TraceStep[];
}

// Como cada CST é calculado. "optional": calcula se a regra trouxer alíquota; senão, zero.
type Method = 'rate' | 'quantity' | 'none' | 'optional';

const METHOD_BY_GROUP: Record<string, Method> = {
  Aliq: 'rate',
  Qtde: 'quantity',
  NT: 'none',
  Outr: 'optional',
};

export function calculateContribution(
  tax: ContributionTax,
  effect: ContributionEffect,
  input: ContributionInput,
): ContributionResult {
  assertBase(input.baseCents);
  const icmsCents = input.icmsCents ?? 0;
  assertBase(icmsCents, 'Valor do ICMS');
  const situation = findTaxSituation(tax === 'PIS' ? 'pis' : 'cofins', effect.cst);
  if (!situation) throw new TaxRuleDataError(tax, effect.cst, 'CST não existe na tabela oficial');
  const group = situation.groups[0]!;
  // O nome do grupo no schema diz a forma de cálculo: PISAliq, PISQtde, PISNT, PISOutr.
  const method = METHOD_BY_GROUP[group.replace(tax, '')]!;
  const mode = effect.rounding ?? 'half-up';
  const trace: TraceStep[] = [step(`CST ${effect.cst}`, situation.description)];
  const result: ContributionResult = {
    tax,
    cst: effect.cst,
    group,
    baseCents: 0,
    rate: null,
    quantity: null,
    amountPerUnit: null,
    amountCents: 0,
    trace,
  };

  if (method === 'quantity') {
    if (effect.amountPerUnit === undefined) throw new TaxRuleDataError(tax, effect.cst, 'falta o valor por unidade');
    if (input.quantity === undefined) throw new Error(`${tax} por quantidade: informe a quantidade vendida`);
    const perUnit = dec(effect.amountPerUnit);
    const quantity = dec(input.quantity);
    if (perUnit.isNegative() || quantity.isNegative()) {
      throw new TaxRuleDataError(tax, effect.cst, 'quantidade e valor por unidade não podem ser negativos');
    }
    result.quantity = quantity.toFixed(4);
    result.amountPerUnit = perUnit.toFixed(4);
    result.amountCents = toCents(quantity.mul(perUnit), mode);
    trace.push(
      step(`${tax} por unidade`, money(result.amountCents), `${result.quantity} × R$ ${result.amountPerUnit}`),
    );
    return result;
  }

  if (method === 'none' || (method === 'optional' && effect.rate === undefined)) {
    trace.push(step(`Sem ${tax} a destacar nesta situação`, money(0)));
    return result;
  }

  if (effect.rate === undefined) throw new TaxRuleDataError(tax, effect.cst, 'falta a alíquota');
  const rate = dec(effect.rate);
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new TaxRuleDataError(tax, effect.cst, `alíquota fora de 0 a 100%: ${effect.rate}`);
  }
  let base = fromCents(input.baseCents);
  trace.push(step('Valor da operação', money(input.baseCents)));
  if (effect.excludeIcms && icmsCents > 0) {
    if (icmsCents > input.baseCents) throw new Error('O ICMS do item não pode ser maior que o valor da operação');
    base = base.minus(fromCents(icmsCents));
    trace.push(step('ICMS fora da base', money(toCents(base)), `${money(input.baseCents)} − ${money(icmsCents)}`));
  }
  result.baseCents = toCents(base);
  result.rate = rate.toFixed(2);
  result.amountCents = toCents(base.mul(percent(rate)), mode);
  trace.push(step(`${tax} a ${pct(rate)}`, money(result.amountCents), `${money(result.baseCents)} × ${pct(rate)}`));
  return result;
}
