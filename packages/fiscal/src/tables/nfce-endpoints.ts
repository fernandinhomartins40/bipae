import data from './data/nfce-endpoints.json';

/**
 * Endereços da NFC-e por UF (F3-28), extraídos das páginas oficiais da SEFAZ Virtual do RS e do
 * Portal Nacional da NFC-e (ENCAT): quem autoriza, os webservices, a URL do QR Code e a URL de
 * consulta pela chave. Origem e data em TABLE_SOURCES.
 */
export type NfceService =
  | 'NFeAutorizacao'
  | 'NFeRetAutorizacao'
  | 'NFeInutilizacao'
  | 'NFeConsultaProtocolo'
  | 'NFeStatusServico'
  | 'RecepcaoEvento';

export interface NfceEndpoints {
  uf: string;
  /** Sigla da UF quando ela autoriza a própria NFC-e; "SVRS" quando usa a SEFAZ Virtual do RS. */
  authorizer: string;
  note?: string;
  webservices: { producao?: Partial<Record<NfceService, string>>; homologacao: Partial<Record<NfceService, string>> };
  qrCode: { producao: string | null; homologacao: string | null };
  urlChave: { producao: string | null; homologacao: string | null };
}

export const NFCE_ENDPOINTS: readonly NfceEndpoints[] = data as NfceEndpoints[];

export function nfceEndpoints(uf: string): NfceEndpoints | null {
  return NFCE_ENDPOINTS.find((item) => item.uf === uf) ?? null;
}
