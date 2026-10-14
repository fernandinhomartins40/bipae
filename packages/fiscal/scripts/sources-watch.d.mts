/** Tipos da comparação das fontes oficiais (F3-31), usados nos testes. */
export function listingTitles(html: string): string[];
export function diffTitles(
  saved: string[],
  current: string[],
): { added: string[]; removed: string[] };
export function diffRows(
  saved: unknown[],
  current: unknown[],
  examples?: number,
): { changed: boolean; added: number; removed: number; examples: string[] };
export function reportMarkdown(
  results: { title: string; page: string; status: 'mudou' | 'igual' | 'erro'; details: string[] }[],
  checkedAt: string,
): string;
