// Extrai, do Anexo 1-A do RICMS/SC (página da SEF/SC com a redação atual e a passada), as
// mercadorias em substituição tributária e a MVA de cada CEST, e as seções revogadas com a data e
// o decreto, com os CEST que estavam nelas (F3-26.c.SC). O que a SEF/SC marca como redação passada
// só serve para saber o que saiu da ST. Nenhum valor é digitado à mão.

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  sect: '§',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  atilde: 'ã',
  otilde: 'õ',
  Atilde: 'Ã',
  Otilde: 'Õ',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  Acirc: 'Â',
  Ecirc: 'Ê',
  Ocirc: 'Ô',
  agrave: 'à',
  Agrave: 'À',
  ccedil: 'ç',
  Ccedil: 'Ç',
  uuml: 'ü',
  ndash: '–',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
};

const textOf = (html) =>
  html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ')
    .replace(/[\u0096\u0097]/g, '–')
    .trim();

const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const MVA = /^\d{1,3},\d{2}$/;
const NCM_TOKEN = /^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}$|^\d{8}$/;

/** "01.04.18" → "2018-04-01" */
const isoFromSc = (text) => {
  const m = /(\d{2})\.(\d{2})\.(\d{2,4})/.exec(text);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
};

/** "Dec. 1541/18" → "Decreto 1.541/2018" */
const decreeOf = (text) => {
  const m = /Dec(?:reto)?\.?\s*(\d[\d.]*)\/(\d{2,4})/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '')).toLocaleString('pt-BR');
  return `Decreto ${n}/${m[2].length === 2 ? `20${m[2]}` : m[2]}`;
};

/**
 * @param html página RICMS_01_01_A_pas.htm (redação atual e passada)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseScAnexo1A(html, knownCest) {
  const sections = [];
  let current = null; // seção vigente: { roman, name, legend, items }
  let revoked = null; // seção revogada: { roman, name, excludedFrom, excludedBy, cests }
  const problems = [];
  let legend = []; // legendas "(i) %MVA ..." vistas antes ou depois da tabela

  const blocks = html.matchAll(/<table[\s\S]*?<\/table>|<p class=([\w-]+)[^>]*>([\s\S]*?)<\/p>/gi);
  for (const block of blocks) {
    if (block[1]) {
      const cls = block[1];
      const text = textOf(block[2]);
      if (!text) continue;
      // Seção revogada: "Seção XII - REVOGADA – Dec. 1541/18, art. 3º... - Efeitos a partir de 01.04.18:"
      const rev = /^Se[çc][ãa]o ([IVXL]+(?:-A)?)\s*[–-]\s*REVOGAD[AO]\b(.*)$/i.exec(text);
      if (/^redaoatualttulo/.test(cls) && rev) {
        current = null;
        revoked = {
          roman: rev[1],
          name: null,
          excludedFrom: isoFromSc(rev[2].slice(rev[2].indexOf('partir de'))),
          excludedBy: decreeOf(rev[2]),
          cests: new Set(),
        };
        sections.push({ kind: 'revoked', ...revoked, cestsSet: revoked.cests });
        continue;
      }
      const named = /^Se[çc][ãa]o ([IVXL]+(?:-A)?)\s*[–-]\s*(.+?)\s*[–-]\s*REVOGAD/i.exec(text);
      if (cls === 'redaoatual' && named && revoked?.roman === named[1]) {
        sections.at(-1).name = named[2];
        continue;
      }
      // Seção vigente: o título vem em parágrafos "secao05" ("Seção IV Cervejas, ...").
      const sec = /^Se[çc][ãa]o ([IVXL]+(?:-A)?)(?:\s+(.*))?$/.exec(text);
      if (cls === 'secao05' && sec) {
        revoked = null;
        current = { kind: 'current', roman: sec[1], name: sec[2] ?? '', items: [], legend: [] };
        sections.push(current);
        legend = [];
        continue;
      }
      if (cls === 'secao05' && current && current.name === '') {
        current.name = text;
        continue;
      }
      // Redação passada da seção revogada, às vezes em parágrafos: "11.001.00  2828.90.11 ...".
      const pastCest = /^(\d{2}\.\d{3}\.\d{2})\b/.exec(text);
      if (revoked && /^redaopassada/.test(cls) && pastCest) {
        revoked.cests.add(pastCest[1].replace(/\./g, ''));
        continue;
      }
      const leg = /^\((i{1,3}|iv|v)\)\s*(.+?)\.?$/.exec(text);
      if (leg && current && /^redaoatual/.test(cls)) {
        legend.push([leg[1], leg[2]]);
        current.legend = legend;
      }
      continue;
    }
    // Tabela: atual ou passada, pela classe dos parágrafos das células.
    const table = block[0];
    const past = /class=redaopassada/i.test(table) && !/class=redaoatual/i.test(table);
    for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
      const cestAt = cells.findIndex((c) => CEST.test(c));
      if (cestAt < 0) continue;
      const cest = cells[cestAt].replace(/\./g, '');
      if (revoked && past) {
        revoked.cests.add(cest);
        continue;
      }
      if (!current || past) continue;
      if (cells.some((c) => /^REVOGAD/.test(c))) continue;
      if (!knownCest.has(cest)) problems.push(`CEST ${cells[cestAt]} fora do Convênio ICMS 142/18`);
      const ncmCell = cells[cestAt + 1] ?? '';
      const ncms = [
        ...new Set(
          ncmCell
            .split(/[\s,;]+/)
            .filter((t) => NCM_TOKEN.test(t))
            .map((t) => t.replace(/\./g, '')),
        ),
      ];
      const mvas = cells.slice(cestAt + 3).filter((c) => MVA.test(c));
      current.items.push({
        item: cestAt > 0 ? cells[0] : cells[cestAt],
        cest,
        ncms,
        ncmText: ncmCell,
        description: cells[cestAt + 2] ?? '',
        mvas: mvas.map((m) => m.replace(',', '.')),
      });
    }
  }
  if (problems.length > 0)
    throw new Error(`RICMS/SC, Anexo 1-A: ${problems.slice(0, 10).join('; ')}`);
  const result = sections
    .map(({ cestsSet, ...s }) => (s.kind === 'revoked' ? { ...s, cests: [...cestsSet].sort() } : s))
    .filter((s) => (s.kind === 'current' ? s.items.length > 0 : true));
  const total = result.filter((s) => s.kind === 'current').reduce((n, s) => n + s.items.length, 0);
  if (total < 100) throw new Error(`Esperava o Anexo 1-A inteiro; achei ${total} itens`);
  for (const s of result.filter((r) => r.kind === 'revoked')) {
    if (!s.excludedFrom || !s.excludedBy)
      problems.push(`Seção ${s.roman} revogada sem data ou decreto`);
  }
  if (problems.length > 0) throw new Error(`RICMS/SC, Anexo 1-A: ${problems.join('; ')}`);
  return result;
}

/**
 * Anexo 1-A no formato de st-references.json. As colunas de MVA "ajustada" (interestaduais e TTD)
 * ficam de fora: a sugestão é a MVA original; com duas originais (atacadista e indústria), cada
 * uma vira uma linha com o nome.
 */
export function scStReferences(sections, { url }) {
  const current = sections.filter((s) => s.kind === 'current' && !/n[ãa]o sujeitos/i.test(s.name));
  const inForce = new Set(current.flatMap((s) => s.items.map((i) => i.cest)));
  const annexes = [
    ...current.map((s) => ({
      annex: s.roman,
      name: s.name,
      cests: [...new Map(s.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
        ncms.length > 0 ? { cest, ncms } : { cest },
      ),
    })),
    ...sections
      .filter((s) => s.kind === 'revoked')
      .map((s) => ({
        annex: s.roman,
        name: s.name ?? `Seção ${s.roman}`,
        excludedFrom: s.excludedFrom,
        excludedBy: s.excludedBy,
        cests: s.cests.filter((c) => !inForce.has(c)).map((cest) => ({ cest })),
      }))
      .filter((a) => a.cests.length > 0),
  ];
  const references = current
    .map((s) => {
      const items = s.items.flatMap((i) => {
        const original = i.mvas
          .map((mva, idx) => ({ mva, label: s.legend[idx]?.[1] ?? null }))
          .filter((m) => !/ajustada/i.test(m.label ?? ''));
        if (i.ncms.length === 0) return [];
        return original.map((m, idx) => ({
          item: original.length > 1 ? `${i.item}/${idx + 1}` : i.item,
          cest: i.cest,
          ncms: i.ncms,
          ncmText: i.ncmText,
          description:
            original.length > 1 && m.label
              ? `${i.description} — ${m.label.replace(/^%\s*MVA\s*/i, '')}`
              : i.description,
          mva: m.mva,
        }));
      });
      return {
        uf: 'SC',
        segment: s.roman,
        segmentName: s.name,
        act: `RICMS/SC, Anexo 1-A, Seção ${s.roman}`,
        source: 'stScAnexo1A',
        url,
        validFrom: '2018-01-01',
        validTo: null,
        note: 'MVA original das operações internas. A tabela também traz as MVAs ajustadas para as entradas com 12% e 4% (e, nas bebidas alcoólicas, para o diferimento parcial do TTD). Vale a redação atual.',
        items,
      };
    })
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'SC',
      act: 'RICMS/SC, Anexo 1-A (redação atual e passada da SEF/SC)',
      source: 'stScAnexo1A',
      url,
      annexes,
    },
    references,
  };
}
