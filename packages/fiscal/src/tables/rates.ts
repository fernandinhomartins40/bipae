import { isValidOn, type Validity } from '../validity';
import cbsPublished from './data/cbs-rates.json';
import fcp from './data/fcp.json';
import legal from './data/legal-rates.json';

/**
 * Alíquotas de referência com vigência. Só entra aqui o que tem número em texto oficial; ano sem
 * alíquota publicada fica sem regra (a dúvida D-004 cobre 2027 em diante), nunca com valor suposto.
 */
export interface ReferenceRate {
  id: string;
  tax: 'IBS' | 'CBS';
  /** Ente a que a alíquota pertence. O IBS de 2027–2028 tem parte estadual e parte municipal. */
  sphere: 'federal' | 'estadual' | 'municipal';
  /** Percentual, como na lei ("0.9" = 0,9%). */
  rate: string;
  validity: Validity;
  source: string;
  url: string;
}

export const REFERENCE_RATES: readonly ReferenceRate[] = legal as ReferenceRate[];

/** As alíquotas de referência de um tributo em vigor na data (uma por ente). Vazio = não publicada. */
export function referenceRates(tax: ReferenceRate['tax'], date: string): ReferenceRate[] {
  return REFERENCE_RATES.filter((rate) => rate.tax === tax && isValidOn(rate.validity, date));
}

/** A Tabela de Alíquotas da CBS como publicada no Portal da NF-e. `rate: null` = ainda sem alíquota. */
export interface PublishedCbsRate {
  year: number;
  rate: string | null;
  note?: string;
}

export const CBS_PUBLISHED_RATES: readonly PublishedCbsRate[] = cbsPublished;

/** Fundo de Combate à Pobreza por UF, da tabela do Portal da NF-e. */
export interface FcpByUf {
  cUF: string;
  uf: string;
  /** "fixed": a UF aceita só as alíquotas listadas; "max": aceita qualquer valor até o teto. */
  kind: 'fixed' | 'max';
  rates: string[];
  note: string;
}

export const FCP_BY_UF: readonly FcpByUf[] = fcp as FcpByUf[];

const fcpByUf = new Map(FCP_BY_UF.map((item) => [item.uf, item]));

export function findFcp(uf: string): FcpByUf | null {
  return fcpByUf.get(uf) ?? null;
}
