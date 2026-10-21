// Extrai, do Subanexo I do Anexo III do RICMS/MS (Decreto 9.203/1998, arquivo .doc "versão atual"
// publicado no portal de legislação da SEFAZ-MS), as mercadorias em substituição tributária com
// CEST, NCM e a MVA das operações internas (F3-26.d.MS). O texto vem do Word pelo word-extractor:
// células separadas por tabulação. Depois da redação atual o arquivo repete as redações anteriores
// ("REDAÇÃO VIGENTE ATÉ ..."); delas só sai a lista de CEST das tabelas revogadas. Nada é digitado
// à mão.

const ROMAN = /^Tabela\s+([IVXL]+(?:-[AB])?)\s*$/i;
const ITEM = /^\d{1,3}(?:\.\d{1,2})?$/;
const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const MVA = /^\d{1,3},\d{2}$/;
const NCM_PIECE = /^\d{2,4}(?:\.\d{1,2}){0,2}$/;
const HISTORY = /^REDAÇÃO (?:ANTERIOR )?VIGENTE ATÉ\s+(\d{1,2})[º°]?\.(\d{1,2})\.(\d{2,4})/;
// Revogações antes do Convênio ICMS 142/2018 usam a numeração antiga do CEST: ficam de fora.
const OLDEST_EXCLUSION = '2019-01-01';

/** "1º.4.2025", "27.12.2024", "1º.01.18" → AAAA-MM-DD. */
function isoOf(day, month, year) {
  const y = year.length === 2 ? `20${year}` : year;
  return `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const DATE = /Efeitos a partir de\s+(\d{1,2})[º°]?\s*\.(\d{1,2})\.(\d{2,4})/gi;
const datesIn = (text) => [...text.matchAll(DATE)].map((m) => isoOf(m[1], m[2], m[3]));

const dayBefore = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Célula de NCM: "2205", "8413.19.00 8413.50.90", "Capítulos 13 e 15 a 23". */
function ncmsOf(token) {
  const chapters = /^Cap[ií]tulos?\s+(.+)$/i.exec(token);
  if (chapters) {
    const out = [];
    for (const m of chapters[1].matchAll(/(\d{2})(?:\s+a\s+(\d{2}))?/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let c = from; c <= to; c++) out.push(String(c).padStart(2, '0'));
    }
    return out.length > 0 ? out : null;
  }
  const pieces = token.split(/\s+/).filter(Boolean);
  if (pieces.length === 0 || !pieces.every((p) => NCM_PIECE.test(p))) return null;
  return pieces.map((p) => p.replace(/\./g, ''));
}

/** Divide um trecho do texto em tabelas: número romano, título e corpo. */
function tablesOf(lines) {
  const tables = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const head = ROMAN.exec(lines[i].trim());
    if (head) {
      const title = [];
      let k = i + 1;
      while (k < lines.length && /^[A-ZÀ-Ú"][A-ZÀ-Ú ,"\-:]+$/.test(lines[k].trim())) {
        title.push(lines[k].trim().replace(/:$/, ''));
        k++;
      }
      current = { roman: head[1].toUpperCase(), title: title.join(' '), body: [] };
      tables.push(current);
      continue;
    }
    if (current) current.body.push(lines[i]);
  }
  return tables;
}

/** Itens com CEST de uma tabela (as linhas revogadas não trazem o CEST e ficam de fora). */
function itemsOf(body) {
  const tokens = body
    .join('\n')
    .split(/[\t\n]/)
    .map((t) => t.replace(/\u00a0/g, ' ').trim())
    .filter((t) => t !== '');
  const items = [];
  for (let k = 0; k < tokens.length; k++) {
    if (!ITEM.test(tokens[k]) || !CEST.test(tokens[k + 1] ?? '')) continue;
    const item = { item: tokens[k], cest: tokens[k + 1].replace(/\./g, ''), ncms: [], mva: null };
    let at = k + 2;
    const ncmText = [];
    while (at < tokens.length && ncmsOf(tokens[at])) {
      item.ncms.push(...ncmsOf(tokens[at]));
      ncmText.push(tokens[at]);
      at++;
    }
    item.ncms = [...new Set(item.ncms)];
    item.ncmText = ncmText.join(' ');
    // Quatro colunas de MVA: operação interna e as ajustadas para 4%, 7% e 12%.
    if (tokens.slice(at, at + 4).every((t) => MVA.test(t))) {
      item.mva = tokens[at]
        .replace(',', '.')
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
      at += 4;
    }
    item.description = (tokens[at] ?? '').replace(/\s+/g, ' ');
    items.push(item);
    k = at - 1;
  }
  return items;
}

/**
 * @param text corpo do documento (word-extractor)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseMsSubanexoI(text, knownCest) {
  const lines = text.split('\n');
  const cut = lines.findIndex((l) => HISTORY.test(l.trim()));
  if (cut < 0) throw new Error('Subanexo I do Anexo III (MS): não achei o fim da redação atual');
  const current = tablesOf(lines.slice(0, cut)).filter((t) => t.roman !== 'I');

  // Redações anteriores, cada uma com a data em que deixou de valer.
  const history = [];
  for (let i = cut; i < lines.length; i++) {
    const h = HISTORY.exec(lines[i].trim());
    if (h) history.push({ until: isoOf(h[1], h[2], h[3]), lines: [] });
    else history.at(-1)?.lines.push(lines[i]);
  }

  const problems = [];
  const tables = current.map((t) => {
    const body = t.body.join('\n');
    const notes = t.body.filter((l) => /^\s*\(/.test(l)).join(' ');
    const qualifier = /^\s*\((?:UFs|Nos casos)[^)]*\)?/m.exec(body)?.[0].trim() ?? null;
    const revocation =
      /\(Tabela\s+[IVXL-]+:\s*Revogada pelo Decreto n[º°o]?\s*([\d.]+\/\d{4})(.*?)Efeitos a partir de\s+(\d{1,2})[º°]?\.(\d{1,2})\.(\d{2,4})/i.exec(
        notes,
      );
    const items = itemsOf(t.body);
    for (const i of items) if (!knownCest.has(i.cest)) problems.push(`${t.roman} ${i.cest}`);
    const table = {
      roman: t.roman,
      title: t.title,
      qualifier: qualifier ? qualifier.replace(/^\(|\)$/g, '') : null,
      segment: items[0]?.cest.slice(0, 2) ?? null,
      // Desde a alteração mais recente da tabela (notas "Efeitos a partir de ..."), no mínimo
      // a redação do Decreto 14.383/2016 (1º/03/2016).
      validFrom: ['2016-03-01', ...datesIn(body)].sort().at(-1),
      items,
      revoked: [],
    };
    if (revocation) {
      const from = isoOf(revocation[3], revocation[4], revocation[5]);
      table.excludedFrom = from;
      table.excludedBy = `Decreto ${revocation[1]}`;
      if (from >= OLDEST_EXCLUSION) {
        // A lista que saiu da ST vem da redação que valeu até a véspera.
        const before = history.find((h) => h.until === dayBefore(from));
        const old = before && tablesOf(before.lines).find((o) => o.roman === t.roman);
        if (!old) problems.push(`Tabela ${t.roman}: sem a redação anterior à revogação`);
        const inForce = new Set(items.map((i) => i.cest));
        table.revoked = [
          ...new Set(
            itemsOf(old?.body ?? [])
              .map((i) => i.cest)
              .filter((c) => knownCest.has(c) && !inForce.has(c)),
          ),
        ].sort();
        if (!table.segment) table.segment = table.revoked[0]?.slice(0, 2) ?? null;
      }
    }
    return table;
  });

  const total = tables.reduce((n, t) => n + t.items.length, 0);
  if (total < 400) throw new Error(`Esperava o Subanexo I inteiro; achei ${total} itens`);
  if (problems.length > total / 10) {
    throw new Error(`Subanexo I do Anexo III (MS): ${problems.slice(0, 10).join('; ')}`);
  }
  return tables.filter((t) => t.items.length > 0 || t.revoked.length > 0);
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');
const nameOf = (t) => `${sentence(t.title)}${t.qualifier ? ` (${t.qualifier})` : ''}`;

/** Subanexo I no formato de st-references.json. */
export function msStReferences(tables, { url }) {
  const act = 'RICMS/MS, Anexo III, Subanexo I';
  return {
    segment: {
      uf: 'MS',
      act: `${act} (versão atual da SEFAZ-MS)`,
      source: 'stMsAnexoIII',
      url,
      annexes: tables.map((t) => ({
        annex: t.roman,
        name: nameOf(t),
        cests: [
          ...[...new Map(t.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
            ncms.length > 0 ? { cest, ncms } : { cest },
          ),
          ...t.revoked.map((cest) => ({
            cest,
            excludedFrom: t.excludedFrom,
            excludedBy: t.excludedBy,
          })),
        ],
      })),
    },
    references: tables
      .map((t) => ({
        uf: 'MS',
        segment: t.segment,
        segmentName: nameOf(t),
        act: `${act}, Tabela ${t.roman}`,
        source: 'stMsAnexoIII',
        url,
        validFrom: t.validFrom,
        validTo: null,
        note: 'MVA das operações internas. A tabela também traz a MVA ajustada para as entradas com 4%, 7% e 12%. Vale a redação atual, desde a alteração mais recente da tabela.',
        items: t.items
          .filter((i) => i.mva && i.ncms.length > 0)
          .map(({ item, cest, ncms, ncmText, description, mva }) => ({
            item,
            cest,
            ncms,
            ncmText,
            description,
            mva,
          })),
      }))
      .filter((r) => r.items.length > 0),
  };
}
