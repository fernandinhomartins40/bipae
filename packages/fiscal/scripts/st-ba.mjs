// Extrai, do PDF oficial do Anexo 1 do RICMS/BA (Decreto 13.780/2012, redação vigente no ano, da
// SEFAZ-BA), as mercadorias em substituição tributária com CEST, NCM e a MVA original das
// operações internas (F3-26.c.BA). Notas e redações anteriores (entre aspas) ficam de fora, e itens
// revogados também. Nenhum valor é digitado à mão.

const ITEM_START = /^(\d{1,2}(?:\.\d{1,2}){1,3})(?:\s+(.*))?$/;
const SEGMENT = /^(\d{1,2})\.0\s+(.+?):?$/;
const CEST = /\b\d{2}\.\d{3}\.\d{2}\b/g;
const NCM_TOKEN = /^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}\.\d{2}$|^\d{8}$/;
const TAIL_MVA = /\(Alíq\. \d+%\)\s+(\d{1,3}(?:,\d{1,2})?)\s*%$/;
const BARE_MVA = /^(\d{1,3}(?:,\d{1,2})?)\s*%[”"]?$/;

/** Linhas do texto atual: sem notas, sem a redação anterior entre aspas. */
function currentLines(lines) {
  const out = [];
  let quoted = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^decreto_2012_13780/.test(line)) continue;
    if (quoted) {
      if (/”\s*$/.test(line)) quoted = false;
      continue;
    }
    if (/^Nota\b/.test(line) || /^Redação (anterior|original)/.test(line)) continue;
    if (/^“/.test(line)) {
      quoted = !/”\s*$/.test(line);
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * @param lines linhas do PDF (pdf-text.mjs)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos), em ordem
 */
export function parseBaAnexo1(lines, knownCest) {
  const text = currentLines(lines);
  const sorted = [...knownCest].sort();
  const segments = [];
  let segment = null;
  let item = null;
  const problems = [];

  const finish = () => {
    if (!item || !segment) {
      item = null;
      return;
    }
    const body = item.lines.join('\n');
    // "Ver o Anexo II (CEST) do Conv. ICMS 142/18": o item é o segmento inteiro do convênio; os
    // CEST citados nas notas são exceções, não o item.
    if (/Ver o Anexo [IVXL]+ \(CEST\)/.test(body)) {
      item = null;
      return;
    }
    // CEST: códigos soltos e faixas "17.044.00 a 17.044.27".
    const codes = [...body.matchAll(CEST)].map((m) => m[0].replace(/\./g, ''));
    const ranges = [...body.matchAll(/(\d{2}\.\d{3}\.\d{2})\s*a\s*(\d{2}\.\d{3}\.\d{2})/g)];
    const cests = new Set(codes);
    for (const [, from, to] of ranges) {
      const a = from.replace(/\./g, '');
      const b = to.replace(/\./g, '');
      for (const c of sorted) if (c >= a && c <= b) cests.add(c);
    }
    // Os CEST citados na descrição ("exceto as descritas nos CEST ...") não são do item.
    const head = item.lines.slice(0, 4).join(' ');
    const dottedOf = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}`;
    const ownText = (c) => {
      const at = head.indexOf(dottedOf(c));
      return at >= 0 && !/exceto|descrit|classificad/i.test(head.slice(Math.max(0, at - 60), at));
    };
    const own = [...cests].filter((c) => {
      if (ownText(c)) return true;
      // Dentro de uma faixa do próprio item ("17.044.00 a 17.044.27").
      return ranges.some(
        ([, from, to]) =>
          ownText(from.replace(/\./g, '')) &&
          c >= from.replace(/\./g, '') &&
          c <= to.replace(/\./g, ''),
      );
    });
    const tokens = item.lines
      .slice(0, 6)
      .join(' ')
      .split(/\s+/)
      .map((t) => t.replace(/\.$/, ''))
      .filter((t) => NCM_TOKEN.test(t) && !/^\d{2}\.\d{3}\.\d{2}$/.test(t));
    const ncms = [...new Set(tokens.map((t) => t.replace(/\./g, '')))];
    let mva = null;
    for (const l of item.lines) {
      // Na quebra de página a coluna da MVA original pode vir no fim da linha das ajustadas.
      const m = BARE_MVA.exec(l) ?? TAIL_MVA.exec(l);
      if (m) mva = m[1].replace(',', '.');
    }
    const descStart = item.lines.findIndex((l) => /[a-zà-ú]{3,}/i.test(l.replace(CEST, '')));
    const description = item.lines
      .slice(descStart, descStart + 4)
      .join(' ')
      .replace(/^[\d.\s a]+(?=[A-ZÀ-Ú])/, '')
      .split(/\s(?:Prot\.|Conv\.|Não tem|Nas aquisições)/)[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (own.length > 0) {
      segment.items.push({ item: item.item, cests: own, ncms, description, mva });
    }
    item = null;
  };

  for (const line of text) {
    const seg = SEGMENT.exec(line);
    if (seg && /[A-ZÀ-Ú]{3,}/.test(seg[2])) {
      finish();
      segment = { segment: seg[1], name: seg[2].replace(/:$/, '').trim(), items: [] };
      segments.push(segment);
      continue;
    }
    if (/^\d{1,2}\.0 Revogado/.test(line)) {
      finish();
      segment = null;
      continue;
    }
    const start = ITEM_START.exec(line);
    if (start && segment && start[1].startsWith(`${segment.segment}.`)) {
      finish();
      if (/^Revogad/.test(start[2] ?? '')) continue;
      item = { item: start[1], lines: start[2] ? [start[2]] : [] };
      continue;
    }
    if (item) item.lines.push(line);
  }
  finish();
  for (const s of segments) {
    for (const i of s.items) {
      for (const c of i.cests) {
        if (!knownCest.has(c))
          problems.push(`CEST ${c} do item ${i.item} fora do Convênio ICMS 142/18`);
      }
    }
  }
  if (problems.length > 0)
    throw new Error(`RICMS/BA, Anexo 1: ${problems.slice(0, 10).join('; ')}`);
  const total = segments.reduce((n, s) => n + s.items.length, 0);
  if (total < 150) throw new Error(`Esperava o Anexo 1 inteiro; achei ${total} itens`);
  return segments;
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Anexo 1 no formato de st-references.json. */
export function baStReferences(segments, { url }) {
  const annexes = segments
    .map((s) => {
      const ncmsOf = new Map();
      for (const i of s.items) {
        for (const c of i.cests) ncmsOf.set(c, [...new Set([...(ncmsOf.get(c) ?? []), ...i.ncms])]);
      }
      return {
        annex: s.segment,
        name: sentence(s.name),
        cests: [...ncmsOf].map(([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest })),
      };
    })
    .filter((a) => a.cests.length > 0);
  const references = segments
    .map((s) => ({
      uf: 'BA',
      segment: s.segment,
      segmentName: sentence(s.name),
      act: 'RICMS/BA, Anexo 1 (redação vigente em 2026)',
      source: 'stBaAnexo1',
      url,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      note: 'MVA original das operações internas. Nas aquisições de outra UF, a tabela traz a MVA ajustada para 4%, 7% e 12%, e alguns itens seguem o acordo interestadual citado. Vale a redação vigente no ano.',
      items: s.items
        .filter((i) => i.mva && i.ncms.length > 0)
        .flatMap((i) =>
          i.cests.map((cest, idx) => ({
            item: i.cests.length > 1 ? `${i.item}/${idx + 1}` : i.item,
            cest,
            ncms: i.ncms,
            ncmText: i.ncms.join(' '),
            description: i.description,
            mva: i.mva,
          })),
        ),
    }))
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'BA',
      act: 'RICMS/BA, Anexo 1 (redação vigente em 2026)',
      source: 'stBaAnexo1',
      url,
      annexes,
    },
    references,
  };
}
