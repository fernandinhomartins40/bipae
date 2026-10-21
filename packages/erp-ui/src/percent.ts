/** "2,5" ou "2.5" ou "2,5%" → 250 (centésimos de ponto). Nulo quando não é uma porcentagem válida. */
export function parsePercentBp(text: string): number | null {
  const clean = text.trim().replace('%', '').trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp <= 10_000 ? bp : null;
}

/** 250 → "2,5%"; 1000 → "10%". */
export function formatBp(bp: number): string {
  return `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}
