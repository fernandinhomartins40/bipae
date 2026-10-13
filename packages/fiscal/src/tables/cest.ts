import { isValidOn, type Validity } from '../validity';
import data from './data/cest.json';

/**
 * CEST (Código Especificador da Substituição Tributária), extraído do texto consolidado do
 * Convênio ICMS 142/18 no site do CONFAZ (scripts/cest.mjs; origem em TABLE_SOURCES.cest).
 *
 * A lista é nacional e diz quais mercadorias PODEM estar em substituição tributária. Quem decide
 * se uma mercadoria está de fato em ST é cada UF; isso não está nesta tabela.
 */
export interface Cest {
  /** Sete dígitos, sem pontos ("0302100"). */
  cest: string;
  /** Número do item no anexo do convênio ("21.0"). */
  item: string;
  /** Segmento (os dois primeiros dígitos do CEST). */
  segment: string;
  /** Prefixos de NCM/SH a que o CEST se aplica. Vazio = o convênio não restringe (itens "999"). */
  ncm: string[];
  /** A coluna NCM/SH como publicada, quando traz texto ("Capítulos 39, 49, 95, 96"). */
  ncmText?: string;
  description: string;
  /**
   * Desde quando esta redação vale. Quando o convênio não informa a data item a item, fica a
   * data de início do próprio convênio (01/01/2019).
   */
  start: string;
  /** Primeiro dia em que esta redação não vale mais (há outra redação a partir daí). */
  end?: string;
}

export interface CestSegment {
  code: string;
  name: string;
}

export const CEST_SEGMENTS: readonly CestSegment[] = data.segments;
export const CESTS: readonly Cest[] = data.items;

const byCode = new Map<string, Cest[]>();
for (const item of CESTS) byCode.set(item.cest, [...(byCode.get(item.cest) ?? []), item]);

/** Tira pontos e espaços: "03.021.00" → "0302100". */
export function normalizeCest(code: string): string {
  return code.replace(/[.\s]/g, '');
}

export function cestValidity(cest: Cest): Validity {
  return { start: cest.start, ...(cest.end !== undefined && { end: cest.end }) };
}

/** A redação do CEST em vigor na data; null se o código não existe ou não vale nesse dia. */
export function findCest(code: string, date: string): Cest | null {
  const versions = byCode.get(normalizeCest(code)) ?? [];
  return versions.find((item) => isValidOn(cestValidity(item), date)) ?? null;
}

export function findCestSegment(code: string): CestSegment | null {
  return CEST_SEGMENTS.find((segment) => segment.code === code) ?? null;
}

/**
 * Sugestões de CEST para um NCM, na data: os itens cujo prefixo de NCM/SH casa com o código, do
 * mais específico para o mais genérico. É só sugestão para o cadastro: o mesmo NCM costuma ter
 * vários CEST (por embalagem, por uso), e a escolha depende da descrição do produto.
 */
export function cestsForNcm(ncm: string, date: string): Cest[] {
  const digits = ncm.replace(/[.\s]/g, '');
  if (!/^\d{8}$/.test(digits)) return [];
  const matches: { item: Cest; length: number }[] = [];
  for (const item of CESTS) {
    if (!isValidOn(cestValidity(item), date)) continue;
    const length = Math.max(0, ...item.ncm.filter((prefix) => digits.startsWith(prefix)).map((p) => p.length));
    if (length > 0) matches.push({ item, length });
  }
  return matches.sort((a, b) => b.length - a.length || (a.item.cest < b.item.cest ? -1 : 1)).map((m) => m.item);
}
