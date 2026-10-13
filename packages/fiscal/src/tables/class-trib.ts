import data from './data/class-trib.json';

/**
 * CST e Classificação Tributária (cClassTrib) do IBS e da CBS, da tabela oficial do Informe
 * Técnico 2025.002 (gerada por scripts/import-tables.mjs; origem em TABLE_SOURCES.classTrib).
 * Os nomes dos indicadores seguem os grupos do leiaute a que cada um se refere.
 */
export interface CstIbsCbs {
  cst: string;
  description: string;
  /** Quais grupos do XML este CST exige (colunas ind_g* da tabela oficial). */
  groups: {
    ibsCbs: boolean;
    mono: boolean;
    reduction: boolean;
    deferral: boolean;
    creditTransfer: boolean;
    presumedCreditZfm: boolean;
    accrualAdjustment: boolean;
    baseReducer: boolean;
  };
}

export interface ClassTrib {
  cClassTrib: string;
  cst: string;
  name: string;
  description: string;
  /** Tipo de alíquota, como publicado ("Padrão", "Fixa", "Sem alíquota"...). */
  rateType: string;
  /** Percentual de redução da alíquota do IBS ("60" = 60%). */
  pRedIBS: string;
  /** Percentual de redução da alíquota da CBS. */
  pRedCBS: string;
  groups: {
    regularTaxation: boolean;
    presumedCredit: boolean;
    monoStandard: boolean;
    monoWithholding: boolean;
    monoWithheld: boolean;
    biofuelDifference: boolean;
    creditReversal: boolean;
  };
  /** Tipo de receita bruta do Simples Nacional (ver TP_RBSN). */
  tpRBSN: string;
  /** Regra do campo indDoacao (ver TP_DOACAO). */
  tpDoacao: string;
  start: string;
  end?: string;
  updatedAt: string | null;
  /** Em quais documentos o código é aceito. */
  documents: { nfe: boolean; nfce: boolean; nfse: boolean };
  annex?: string;
  /** Artigo da LC 214/2025 que fundamenta a classificação. */
  law?: string;
  lawUrl: string;
}

export const CSTS_IBS_CBS: readonly CstIbsCbs[] = data.csts;
export const CLASS_TRIBS: readonly ClassTrib[] = data.classes;
export const TP_RBSN: Readonly<Record<string, string>> = data.tpRBSN;
export const TP_DOACAO: Readonly<Record<string, string>> = data.tpDoacao;

const cstByCode = new Map(CSTS_IBS_CBS.map((item) => [item.cst, item]));
const classByCode = new Map(CLASS_TRIBS.map((item) => [item.cClassTrib, item]));

export function findCstIbsCbs(cst: string): CstIbsCbs | null {
  return cstByCode.get(cst) ?? null;
}

export function findClassTrib(cClassTrib: string): ClassTrib | null {
  return classByCode.get(cClassTrib) ?? null;
}

/** As classificações de um CST, na ordem da tabela oficial. */
export function classTribsOf(cst: string): ClassTrib[] {
  return CLASS_TRIBS.filter((item) => item.cst === cst);
}

export type ClassTribStatus = 'vigente' | 'fora-da-vigencia' | 'vigencia-indefinida';

/**
 * Situação de uma classificação numa data. A tabela oficial não diz se o dia do fim da vigência
 * ainda vale ou não (dúvida D-016; há códigos com início e fim no mesmo dia). Nesse dia exato a
 * resposta é "vigencia-indefinida", e quem chama não deve escolher o código sozinho.
 */
export function classTribStatus(item: ClassTrib, date: string): ClassTribStatus {
  if (date < item.start) return 'fora-da-vigencia';
  if (item.end === undefined || date < item.end) return 'vigente';
  return date === item.end ? 'vigencia-indefinida' : 'fora-da-vigencia';
}
