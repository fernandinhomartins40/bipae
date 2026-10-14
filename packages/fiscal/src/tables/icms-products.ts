import data from './data/icms-products.json';

/**
 * Alíquotas internas de ICMS por mercadoria das 27 UFs, como o Portal Nacional da DIFAL publica
 * (F3-25), com a data de cada linha. É **referência para conferência**, não regra do motor: o
 * portal está atrasado em várias UFs (ver docs/fiscal/cobertura-ufs-regimes.md, seção 3). Uma
 * alíquota só vira regra quando a empresa (ou o contador) a cadastra em "Regras de ICMS".
 */
export interface IcmsProductLine {
  description: string;
  /** É a linha da alíquota geral da UF ("Regra Geral", "Alíquota modal"...). */
  general: boolean;
  /** NCM como o portal escreve, e os códigos achados nele (2 a 8 dígitos). */
  ncmText?: string;
  ncms?: string[];
  /** Alíquota como o portal escreve ("20,5%", "Isento") e, quando é um percentual simples, o número. */
  rateText: string;
  rate: string | null;
  fcpText?: string;
  fcp?: string | null;
  /** Base legal e observações do portal. */
  note: string;
  /** Data da atualização da linha no portal (AAAA-MM-DD); null quando o portal não informa. */
  updatedAt: string | null;
  /**
   * Defasada: a alíquota geral do portal não bate com a lei vigente da UF, e esta linha é de
   * antes (ou da mesma data) da linha geral.
   */
  stale: boolean;
}

export interface IcmsProductsByUf {
  uf: string;
  portalGeneralRate: string | null;
  /** Alíquota geral confirmada na lei da UF (tabela ICMS_GENERAL_RATES); null se pendente. */
  confirmedGeneralRate: string | null;
  /** O portal bate com a lei? null quando não dá para comparar. */
  generalMatches: boolean | null;
  items: IcmsProductLine[];
}

export const ICMS_PRODUCT_RATES: readonly IcmsProductsByUf[] = data as IcmsProductsByUf[];

export function icmsProductRates(uf: string): IcmsProductsByUf | null {
  return ICMS_PRODUCT_RATES.find((item) => item.uf === uf) ?? null;
}

/** Linhas do portal que citam o NCM do produto (pelo código inteiro ou por um prefixo). */
export function icmsProductLinesForNcm(uf: string, ncm: string): IcmsProductLine[] {
  const code = ncm.replace(/\D/g, '');
  return (icmsProductRates(uf)?.items ?? []).filter((item) =>
    item.ncms?.some((prefix) => code.startsWith(prefix)),
  );
}
