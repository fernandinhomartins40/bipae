import { isValidOn, type Validity } from '../validity';
import data from './data/ncm.json';

/**
 * NCM vigente, da tabela do Portal Único Siscomex (gerada por scripts/import-tables.mjs; origem em
 * TABLE_SOURCES.ncm). A tabela é grande, então fica num módulo à parte:
 * `import { findNcm } from '@bipae/fiscal/tables/ncm'`.
 */
export interface Ncm {
  /** Só dígitos: 8 no NCM completo, menos nos níveis de cima (capítulo, posição, subposição). */
  code: string;
  description: string;
  start: string;
  /** Primeiro dia em que o código não vale mais. */
  end?: string;
}

/** Texto do Siscomex sobre a data da tabela e o ato que a atualizou por último. */
export const NCM_TABLE_INFO: { updatedAt: string; act: string } = {
  updatedAt: data.updatedAt,
  act: data.act,
};

const toNcm = (row: string[]): Ncm => ({
  code: row[0]!,
  description: row[1]!,
  start: row[2]!,
  ...(row[3] !== undefined && { end: row[3] }),
});

const byCode = new Map((data.items as string[][]).map((row) => [row[0]!, row]));

/** Tira pontos e espaços: "2203.00.00" → "22030000". */
export function normalizeNcm(code: string): string {
  return code.replace(/[.\s]/g, '');
}

/** O NCM completo (8 dígitos) que pode ir no produto e na nota; null se não existir na tabela. */
export function findNcm(code: string): Ncm | null {
  const digits = normalizeNcm(code);
  const row = /^\d{8}$/.test(digits) ? byCode.get(digits) : undefined;
  return row ? toNcm(row) : null;
}

export function ncmValidity(ncm: Ncm): Validity {
  return { start: ncm.start, ...(ncm.end !== undefined && { end: ncm.end }) };
}

export function isNcmValidOn(ncm: Ncm, date: string): boolean {
  return isValidOn(ncmValidity(ncm), date);
}

/**
 * O caminho do capítulo até o código, para mostrar ao usuário: a descrição do NCM sozinha quase
 * sempre é "Outros" e só faz sentido junto dos níveis de cima.
 */
export function ncmPath(code: string): Ncm[] {
  const digits = normalizeNcm(code);
  const path: Ncm[] = [];
  for (const length of [2, 4, 5, 6, 7, 8]) {
    if (digits.length < length) break;
    const row = byCode.get(digits.slice(0, length));
    if (row) path.push(toNcm(row));
  }
  return path;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Busca para o cadastro de produto: por começo do código ("2203") ou por palavras da descrição,
 * sem diferenciar acento nem maiúscula. As palavras podem estar em qualquer nível do caminho
 * ("arroz polido" acha 1006.30.21). Devolve só NCMs completos.
 */
export function searchNcm(query: string, limit = 20): Ncm[] {
  const text = query.trim();
  if (!text || limit <= 0) return [];
  const digits = normalizeNcm(text);
  const byPrefix = /^\d+$/.test(digits);
  const words = fold(text).split(/\s+/);
  const found: Ncm[] = [];
  for (const [code, row] of byCode) {
    if (code.length !== 8) continue;
    const hit = byPrefix
      ? code.startsWith(digits)
      : words.every((word) => ncmPath(code).some((level) => fold(level.description).includes(word)));
    if (hit) {
      found.push(toNcm(row));
      if (found.length >= limit) break;
    }
  }
  return found;
}
