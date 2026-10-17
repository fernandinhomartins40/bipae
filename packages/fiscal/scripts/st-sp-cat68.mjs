// Extrai, do texto consolidado da Portaria CAT 68/2019 (SEFAZ-SP) guardado em sources/, a
// situação de cada anexo de substituição tributária: o segmento, os CEST que ele lista e, quando
// foi revogado, a partir de que data e por qual portaria (F3-26.b). Nenhum valor é digitado à mão.
import { htmlText } from './difal.mjs';

const MONTHS = {
  janeiro: '01',
  fevereiro: '02',
  março: '03',
  marco: '03',
  abril: '04',
  maio: '05',
  junho: '06',
  julho: '07',
  agosto: '08',
  setembro: '09',
  outubro: '10',
  novembro: '11',
  dezembro: '12',
};

/** "1º de agosto de 2026" → "2026-08-01". */
function dateFromText(text) {
  const m = /(\d{1,2})º?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
}

const ROMAN = /^ANEXO ([IVXL]+)$/;

/**
 * @param html página consolidada da Portaria CAT 68/2019
 * @param knownCest conjunto dos CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseSpCat68(html, knownCest) {
  const lines = htmlText(html)
    .replace(/\u200b/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const starts = [];
  lines.forEach((line, i) => {
    if (ROMAN.test(line)) starts.push(i);
  });
  // O índice do começo da página repete os nomes: vale o último bloco de cada anexo.
  const byAnnex = new Map();
  starts.forEach((start, k) => {
    const annex = ROMAN.exec(lines[start])[1];
    const end = starts[k + 1] ?? lines.length;
    byAnnex.set(annex, lines.slice(start + 1, end));
  });
  const result = [];
  for (const [annex, body] of byAnnex) {
    if (body.length === 0) continue;
    // A nota de revogação vem antes ou depois do nome, mas sempre antes da lista de itens.
    const head = body.slice(
      0,
      Math.max(
        1,
        body.findIndex((l) => /^ITEM$/i.test(l)),
      ),
    );
    const revokedLine = head.find((l) => /^\(\s*(Anexo\s+)?revogado/i.test(l)) ?? '';
    const revoked = revokedLine !== '';
    // O nome pode quebrar em mais de uma linha: vai até a referência ao artigo do RICMS.
    const nameLines = [];
    for (const line of body) {
      if (line === revokedLine && nameLines.length === 0) continue;
      if (/^\(/.test(line) || /^ITEM$/i.test(line)) break;
      nameLines.push(line);
    }
    const nameText = nameLines.join(' ');
    if (!nameText) continue;
    // CEST de cada item, com a revogação do próprio item quando houver. O texto consolidado traz
    // a redação atual primeiro e as antigas depois: vale a primeira vez que o CEST aparece.
    const items = new Map();
    let header = '';
    for (const line of body) {
      if (/^\d+(\.\d+)*(\s|$)/.test(line) && !/^\d{2}\.\d{3}\.\d{2}/.test(line)) header = line;
      for (const m of line.matchAll(/\b(\d{2})\.(\d{3})\.(\d{2})\b/g)) {
        const cest = m.slice(1).join('');
        if (!knownCest.has(cest) || items.has(cest)) continue;
        const itemRevoked = /revogad/i.test(header);
        const act = itemRevoked ? /Portaria\s+(SRE|CAT)\s*-?\s*(\d+)\/(\d{2})/i.exec(header) : null;
        items.set(cest, {
          cest,
          ...(itemRevoked && {
            excludedFrom: dateFromText(header) ?? null,
            excludedBy: act
              ? `Portaria ${act[1].toUpperCase()} ${Number(act[2])}/20${act[3]}`
              : null,
          }),
        });
      }
    }
    const cests = [...items.values()];
    if (cests.length === 0) continue;
    const entry = {
      annex,
      name: nameText.charAt(0) + nameText.slice(1).toLowerCase(),
      cests,
    };
    if (revoked) {
      const act = /Portaria\s+(SRE|CAT)\s*-?\s*(\d+)\/(\d{2})/i.exec(revokedLine);
      const from = dateFromText(revokedLine);
      if (!act || !from)
        throw new Error(`Revogação do Anexo ${annex} sem portaria ou data: ${revokedLine}`);
      entry.excludedFrom = from;
      entry.excludedBy = `Portaria ${act[1].toUpperCase()} ${Number(act[2])}/20${act[3]}`;
    }
    result.push(entry);
  }
  if (result.length < 15) {
    throw new Error(`Esperava os anexos da Portaria CAT 68/2019; achei ${result.length}`);
  }
  return result.sort((a, b) => romanValue(a.annex) - romanValue(b.annex));
}

function romanValue(r) {
  const v = { I: 1, V: 5, X: 10, L: 50 };
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = v[r[i]];
    const next = v[r[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}
