import data from './data/nfe-endpoints.json';

/**
 * Endereços da NF-e (modelo 55) por UF (F3-08.b), extraídos da "Relação de Serviços Web" do
 * Portal Nacional da NF-e, nas páginas de produção e de homologação: quem autoriza (a própria UF,
 * a SEFAZ Virtual do RS ou a do Ambiente Nacional), quem atende em contingência (SVC-AN ou
 * SVC-RS) e os webservices de cada um. Origem e data em TABLE_SOURCES.
 */
export type NfeService =
  | 'NFeAutorizacao'
  | 'NFeRetAutorizacao'
  | 'NFeInutilizacao'
  | 'NFeConsultaProtocolo'
  | 'NFeStatusServico'
  | 'NFeConsultaCadastro'
  | 'RecepcaoEvento';

export type NfeEnvironment = 'producao' | 'homologacao';

export interface NfeEndpoints {
  uf: string;
  /** Sigla da UF quando ela autoriza a própria NF-e; "SVRS" ou "SVAN" quando usa uma virtual. */
  authorizer: Record<NfeEnvironment, string>;
  /** Quem autoriza em contingência (SVC-AN ou SVC-RS). Pode mudar de um ambiente para o outro. */
  contingency: Record<NfeEnvironment, 'SVC-AN' | 'SVC-RS'>;
  webservices: Record<NfeEnvironment, Partial<Record<NfeService, string>>>;
  contingencyWebservices: Record<NfeEnvironment, Partial<Record<NfeService, string>>>;
}

const table = data as {
  national: Record<NfeEnvironment, { NFeDistribuicaoDFe: string; RecepcaoEvento: string }>;
  ufs: NfeEndpoints[];
};

export const NFE_ENDPOINTS: readonly NfeEndpoints[] = table.ufs;

/** Serviços do Ambiente Nacional: distribuição de documentos e eventos nacionais. */
export const NFE_NATIONAL_ENDPOINTS = table.national;

export function nfeEndpoints(uf: string): NfeEndpoints | null {
  return NFE_ENDPOINTS.find((item) => item.uf === uf) ?? null;
}
