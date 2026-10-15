import type { CompanyRegime } from '../regimes';
import { isValidOn, type Validity } from '../validity';
import data from './data/ibs-cbs-scope.json';

/**
 * Quem preenche o grupo do IBS e da CBS na nota, por regime e vigência (D-002). Em 2026, o
 * Simples Nacional e o MEI não preenchem: a tributação deles começa em 2027.
 */
export interface IbsCbsScopeRule {
  regimes: CompanyRegime[];
  validity: Validity;
  fill: boolean;
  reason: string;
  source: string;
  url: string;
}

export const IBS_CBS_SCOPE = data.rules as IbsCbsScopeRule[];

/** O motivo quando o regime não preenche o IBS e a CBS na data; null quando preenche. */
export function ibsCbsNotFilled(regime: CompanyRegime, date: string): string | null {
  const rule = IBS_CBS_SCOPE.find((r) => r.regimes.includes(regime) && isValidOn(r.validity, date));
  return rule && !rule.fill ? rule.reason : null;
}
