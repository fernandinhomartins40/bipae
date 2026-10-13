import { isValidOn, type Validity } from '../validity';
import cbsPublished from './data/cbs-rates.json';
import fcp from './data/fcp.json';
import legal from './data/legal-rates.json';
import pisCofins from './data/pis-cofins-rates.json';

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

/**
 * Alíquotas gerais do PIS e da COFINS por regime de apuração. Valem até 31/12/2026: as duas
 * contribuições são extintas em 2027 (EC 132/2023). Alíquotas diferenciadas por produto
 * (monofásicos, alíquota zero) não estão aqui: entram como regra mais específica, por NCM.
 *
 * O início da vigência é 01/01/2026, o começo do período que o sistema cobre, e não a data em
 * que cada lei entrou em vigor: o Bipaê não calcula documento anterior a isso.
 */
export interface PisCofinsRate {
  id: string;
  tax: 'PIS' | 'COFINS';
  /** Cumulativo (Lucro Presumido, em regra) ou não cumulativo (Lucro Real, em regra). */
  regime: 'cumulativo' | 'nao-cumulativo';
  rate: string;
  validity: Validity;
  source: string;
  url: string;
}

export const PIS_COFINS_RATES: readonly PisCofinsRate[] = pisCofins as PisCofinsRate[];

/** A alíquota geral em vigor na data; null se não houver (de 2027 em diante). */
export function pisCofinsRate(
  tax: PisCofinsRate['tax'],
  regime: PisCofinsRate['regime'],
  date: string,
): PisCofinsRate | null {
  return (
    PIS_COFINS_RATES.find(
      (rate) => rate.tax === tax && rate.regime === regime && isValidOn(rate.validity, date),
    ) ?? null
  );
}
