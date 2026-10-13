import { isValidOn, type Validity } from '../validity';
import data from './data/cfop.json';

/**
 * Tabela de CFOP publicada no Portal Nacional da NF-e (gerada por scripts/import-tables.mjs a
 * partir da planilha oficial; a origem e a data ficam em TABLE_SOURCES.cfop).
 */
export interface Cfop {
  code: string;
  title: string;
  /** Data a partir da qual o código pode ser usado (AAAA-MM-DD). */
  start: string;
  /** Data a partir da qual o código deixa de ser aceito. */
  end?: string;
  /** Permitido na NF-e / NFC-e. */
  nfe: boolean;
  communication: boolean;
  transport: boolean;
  /** Corresponde a operação de devolução. */
  devolution: boolean;
  /** Corresponde a operação de retorno. */
  return: boolean;
  annulment: boolean;
  /** Corresponde a operação de remessa. */
  shipment: boolean;
  /** Indicador indComb da tabela oficial (0, 1 ou 2), para combustíveis e lubrificantes. */
  fuel: number;
  /** Permitido na NF-e de contribuinte exclusivo do IBS/CBS (indExcIBSCBS, NT 2026.007). */
  ibsCbsOnlyTaxpayer: boolean;
}

export const CFOPS: readonly Cfop[] = data;

const byCode = new Map(CFOPS.map((cfop) => [cfop.code, cfop]));

export function findCfop(code: string): Cfop | null {
  return byCode.get(code) ?? null;
}

export function cfopValidity(cfop: Cfop): Validity {
  return { start: cfop.start, ...(cfop.end !== undefined && { end: cfop.end }) };
}

export function isCfopValidOn(cfop: Cfop, date: string): boolean {
  return isValidOn(cfopValidity(cfop), date);
}

export type CfopDirection = 'entrada' | 'saida';
export type CfopScope = 'interna' | 'interestadual' | 'exterior';

// O primeiro dígito do CFOP diz o sentido e o alcance da operação (Convênio s/nº de 1970).
const FIRST_DIGIT: Record<string, { direction: CfopDirection; scope: CfopScope }> = {
  '1': { direction: 'entrada', scope: 'interna' },
  '2': { direction: 'entrada', scope: 'interestadual' },
  '3': { direction: 'entrada', scope: 'exterior' },
  '5': { direction: 'saida', scope: 'interna' },
  '6': { direction: 'saida', scope: 'interestadual' },
  '7': { direction: 'saida', scope: 'exterior' },
};

/** Sentido e alcance pelo primeiro dígito; null para código fora do padrão. */
export function cfopGroup(code: string): { direction: CfopDirection; scope: CfopScope } | null {
  return (/^\d{4}$/.test(code) && FIRST_DIGIT[code[0]!]) || null;
}
