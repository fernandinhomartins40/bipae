import data from './data/icms-uf.json';

/**
 * Alíquota geral ("modal") do ICMS de cada UF e alíquotas interestaduais. O Bipaê cobre as 27
 * UFs, mas só traz número para as que foram confirmadas em fonte oficial; as demais ficam
 * listadas como pendentes, para o sistema dizer "falta configurar" em vez de supor um valor
 * (ver docs/fiscal/cobertura-ufs-regimes.md e a dúvida D-021).
 *
 * A alíquota geral não inclui o adicional do fundo de combate à pobreza (FCP_BY_UF), nem vale
 * para produto com alíquota própria (cesta básica, bebidas...): isso é regra mais específica.
 */
export type UfRateStatus = 'confirmado' | 'pendente' | 'divergente';

export interface IcmsGeneralRate {
  uf: string;
  status: UfRateStatus;
  /** Percentual ("20.5"). Só existe quando o status é "confirmado". */
  rate?: string;
  /** Lei e artigo, com a data de início quando conhecida. */
  law: string;
  url: string;
  /** Por que ainda não está confirmado. */
  note?: string;
}

export const ICMS_GENERAL_RATES: readonly IcmsGeneralRate[] = data.general as IcmsGeneralRate[];

/** Data em que as fontes foram conferidas (AAAA-MM-DD). */
export const ICMS_RATES_CHECKED_AT: string = data.checkedAt;

/** As 27 unidades da federação, na ordem da tabela. */
export const UFS: readonly string[] = ICMS_GENERAL_RATES.map((item) => item.uf);

const byUf = new Map(ICMS_GENERAL_RATES.map((item) => [item.uf, item]));

/** A situação da alíquota geral de uma UF; null se a sigla não existe. */
export function icmsGeneralRate(uf: string): IcmsGeneralRate | null {
  return byUf.get(uf) ?? null;
}

export interface InterstateRate {
  rate: string;
  reason: 'importado' | 'sul-sudeste-para-demais' | 'geral';
  source: string;
}

const INTERSTATE = data.interstate;
const southSoutheast = new Set(INTERSTATE.southSoutheastExceptEs);

/**
 * Alíquota interestadual do ICMS: 4% para mercadoria importada ou com conteúdo de importação
 * acima de 40%; 7% nas saídas do Sul e do Sudeste (menos o ES) para as demais UFs; 12% no resto.
 */
export function interstateRate(
  ufOrigem: string,
  ufDestino: string,
  options: { imported?: boolean } = {},
): InterstateRate {
  if (!byUf.has(ufOrigem) || !byUf.has(ufDestino)) throw new Error(`UF inválida: ${ufOrigem} → ${ufDestino}`);
  if (ufOrigem === ufDestino) throw new Error('Operação dentro da mesma UF não tem alíquota interestadual');
  if (options.imported) return { rate: INTERSTATE.imported, reason: 'importado', source: INTERSTATE.source };
  if (southSoutheast.has(ufOrigem) && !southSoutheast.has(ufDestino)) {
    return { rate: INTERSTATE.fromSouthSoutheast, reason: 'sul-sudeste-para-demais', source: INTERSTATE.source };
  }
  return { rate: INTERSTATE.general, reason: 'geral', source: INTERSTATE.source };
}
