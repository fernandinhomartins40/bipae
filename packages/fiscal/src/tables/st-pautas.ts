import { isValidOn } from '../validity';
import data from './data/st-pautas.json';

/**
 * Pauta da substituição tributária (F3-26.f): o preço final em reais que a UF publica por marca,
 * embalagem e tamanho, usado como base da ST no lugar de valor × (1 + MVA). Gerada do ato oficial
 * (hoje, a Portaria SRE 27/2026 de SP, para refrigerantes, energéticos, cerveja e chope).
 */
export interface StPautaItem {
  /** Anexo da portaria ("I", "II", "III"). */
  annex: string;
  table: number;
  /** Fabricante ou grupo da tabela ("Coca Cola", "OUTRAS MARCAS"). */
  tableName: string;
  /** Número do item na tabela ("1.1"). */
  item: string;
  cest: string;
  /** Marca, embalagem e tamanho, como publicados. */
  description: string;
  /** Preço final por unidade, em centavos. */
  priceCents: number;
}

/** IVA-ST que vale quando não se usa a pauta (artigo 2º), por quem vende e por embalagem. */
export interface StPautaIva {
  annex: string;
  who: string;
  mva: string;
  applies: string;
}

export interface StPauta {
  uf: string;
  act: string;
  source: string;
  url: string;
  validFrom: string;
  validTo: string;
  annexNames: Record<string, string>;
  items: StPautaItem[];
  iva: StPautaIva[];
}

export const ST_PAUTAS: readonly StPauta[] = (data as { pautas: StPauta[] }).pautas;

/** A pauta da UF em vigor na data, ou null. */
export function stPautaFor(uf: string, date: string): StPauta | null {
  return (
    ST_PAUTAS.find(
      (p) => p.uf === uf && isValidOn({ start: p.validFrom, end: nextDay(p.validTo) }, date),
    ) ?? null
  );
}

/** O item da pauta pelo anexo e número ("III", "1.2"). */
export function findStPautaItem(
  uf: string,
  date: string,
  annex: string,
  item: string,
): StPautaItem | null {
  return stPautaFor(uf, date)?.items.find((i) => i.annex === annex && i.item === item) ?? null;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Busca por palavras da marca e da embalagem, sem acento; opcionalmente só um CEST. */
export function searchStPauta(
  uf: string,
  date: string,
  query: string,
  options: { cest?: string; limit?: number } = {},
): StPautaItem[] {
  const pauta = stPautaFor(uf, date);
  if (!pauta) return [];
  const words = fold(query).split(/\s+/).filter(Boolean);
  return pauta.items
    .filter((i) => !options.cest || i.cest === options.cest)
    .filter((i) => {
      const text = fold(`${i.tableName} ${i.description}`);
      return words.every((w) => text.includes(w));
    })
    .slice(0, options.limit ?? 30);
}

/** O último dia de vigência é inclusive; a validade do motor usa o primeiro dia sem efeito. */
function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
