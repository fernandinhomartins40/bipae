// Extrai, da página oficial da Portaria SRE 12/2026 (SEFAZ-SP) guardada em sources/, o IVA-ST
// (a MVA de São Paulo) de cada produto alimentício do Anexo XVI da Portaria CAT 68/2019: item,
// CEST, NCM, descrição e percentual (F3-26). Nenhum valor é digitado à mão.
import { htmlText, ncmCodes } from './difal.mjs';

/** "72,41%" → "72.41"; o que não for um percentual simples interrompe a geração. */
function ivaText(text) {
  const m = /^(\d{1,3}(?:,\d{1,4})?)\s*%$/.exec(text.trim());
  if (!m) throw new Error(`IVA-ST inesperado na Portaria SRE 12/2026: "${text}"`);
  return m[1].replace(',', '.');
}

/**
 * @param html página da Portaria SRE 12/2026
 * @param knownCest conjunto dos CEST do Convênio ICMS 142/18 (sem pontos), para conferir
 */
export function parseSpAlimenticios(html, knownCest) {
  const items = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      htmlText(c[1])
        .replace(/\u200b/g, '')
        .replace(/\n/g, ' ')
        .trim(),
    );
    if (cells.length !== 5 || !/^\d{2}\.\d{3}\.\d{2}$/.test(cells[1])) continue;
    const [item, cestText, ncmText, description, iva] = cells;
    const cest = cestText.replace(/\./g, '');
    if (!knownCest.has(cest)) {
      throw new Error(`CEST ${cestText} da Portaria SRE 12/2026 não está no Convênio ICMS 142/18`);
    }
    // A tabela oficial escreve algumas posições sem o zero da frente ("403" é a posição 04.03).
    const ncms = ncmCodes(ncmText.replace(/(^|[^\d.])(\d{3})(?![\d.])/g, '$10$2'));
    if (ncms.length === 0) throw new Error(`Item ${item} sem NCM na Portaria SRE 12/2026`);
    items.push({ item, cest, ncms, ncmText, description, mva: ivaText(iva) });
  }
  if (items.length < 60) {
    throw new Error(
      `Esperava a tabela inteira da Portaria SRE 12/2026; achei ${items.length} linhas`,
    );
  }
  return items;
}
