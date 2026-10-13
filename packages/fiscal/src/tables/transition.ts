import { isValidOn, type Validity } from '../validity';
import data from './data/transition.json';

/**
 * Regras de transição da Reforma Tributária que têm data marcada em texto oficial: o que entra e
 * o que sai da base do IBS e da CBS, e a redução do ICMS e do ISS até a extinção.
 */
export type BaseTax = 'ICMS' | 'ISS' | 'PIS' | 'COFINS' | 'IS';

export interface IbsCbsBaseRule {
  tax: BaseTax;
  /** "exclude": o tributo está dentro do preço e sai da base; "include": é cobrado à parte e entra. */
  effect: 'exclude' | 'include';
  validity: Validity;
  source: string;
}

export const IBS_CBS_BASE_RULES: readonly IbsCbsBaseRule[] = data.ibsCbsBase as IbsCbsBaseRule[];

/** O que ajusta a base do IBS e da CBS na data do fato gerador. */
export function ibsCbsBaseRules(date: string): IbsCbsBaseRule[] {
  return IBS_CBS_BASE_RULES.filter((rule) => isValidOn(rule.validity, date));
}

export interface IcmsIssProportion {
  /** Fração da alíquota da legislação que continua valendo ("0.9" = nove décimos). */
  factor: string;
  validity: Validity;
  source: string;
}

export const ICMS_ISS_PROPORTIONS: readonly IcmsIssProportion[] = data.icmsIssProportions;

/** Primeiro dia sem ICMS e sem ISS. */
export const ICMS_ISS_END: { date: string; source: string } = data.icmsIssEnd;

/**
 * Proporção da alíquota de ICMS/ISS da legislação que vale na data: cheia até 2028, reduzida de
 * 2029 a 2032, e null a partir de 2033, quando os dois impostos deixam de existir.
 */
export function icmsIssProportion(date: string): IcmsIssProportion | { factor: '1'; source: null } | null {
  if (date >= ICMS_ISS_END.date) return null;
  return ICMS_ISS_PROPORTIONS.find((item) => isValidOn(item.validity, date)) ?? { factor: '1', source: null };
}
