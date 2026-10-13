import { dec, fromCents, percent, toCents, type RoundingMode } from '../decimal';
import type { TraceStep } from '../engine';
import { findTaxSituation } from '../tables/tax-situations';
import { assertBase, money, pct, step, TaxRuleDataError } from './shared';

/** IPI por alíquota. No varejo é raro; existe para a indústria e o equiparado a industrial. */
export interface IpiEffect {
  cst: string;
  /** Alíquota em percentual (obrigatória nos CST tributados). */
  rate?: string;
  rounding?: RoundingMode;
}

export interface IpiResult {
  cst: string;
  /** Grupo do XML: "IPITrib" ou "IPINT". */
  group: string;
  baseCents: number;
  rate: string | null;
  amountCents: number;
  trace: TraceStep[];
}

export function calculateIpi(effect: IpiEffect, input: { baseCents: number }): IpiResult {
  assertBase(input.baseCents);
  const situation = findTaxSituation('ipi', effect.cst);
  if (!situation) throw new TaxRuleDataError('IPI', effect.cst, 'CST não existe na tabela oficial');
  const group = situation.groups[0]!;
  const trace: TraceStep[] = [step(`CST ${effect.cst}`, situation.description)];
  const result: IpiResult = { cst: effect.cst, group, baseCents: 0, rate: null, amountCents: 0, trace };

  // O grupo do schema separa o que tem valor (IPITrib) do que não tem (IPINT).
  if (group !== 'IPITrib') {
    trace.push(step('Sem IPI a destacar nesta situação', money(0)));
    return result;
  }
  if (effect.rate === undefined) throw new TaxRuleDataError('IPI', effect.cst, 'falta a alíquota');
  const rate = dec(effect.rate);
  if (rate.isNegative()) throw new TaxRuleDataError('IPI', effect.cst, `alíquota negativa: ${effect.rate}`);
  result.baseCents = input.baseCents;
  result.rate = rate.toFixed(2);
  result.amountCents = toCents(fromCents(input.baseCents).mul(percent(rate)), effect.rounding ?? 'half-up');
  trace.push(step('Valor da operação', money(input.baseCents)));
  trace.push(step(`IPI a ${pct(rate)}`, money(result.amountCents), `${money(input.baseCents)} × ${pct(rate)}`));
  return result;
}
