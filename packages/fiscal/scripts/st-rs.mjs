// Extrai, do texto do RICMS/RS (Decreto 37.699/1997) no site de legislação da Receita Estadual,
// as mercadorias em substituição tributária do Apêndice II: Seção II (só do RS) e Seção III (de
// acordos com outras UFs), com CEST, NCM e a MVA da operação interna (F3-26.c.RS). Linhas
// revogadas ficam de fora. Nenhum valor é digitado à mão.

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
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();

const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const MVA = /^\d{1,3},\d{2}$/;
const NCM_TOKEN = /^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}$|^\d{8}$/;
const ROMAN = /^[IVXL]+$/;

const isNcmCell = (c) =>
  c !== '' && c.split(/\s+/).every((t) => NCM_TOKEN.test(t.replace(/,$/, '')));

/**
 * @param html página do RICMS/RS (texto completo, com os apêndices)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseRsApendiceII(html, knownCest) {
  const start = html.search(
    /Se(?:ç|&ccedil;)(?:ã|&atilde;)o\s*(?:<[^>]+>\s*)*II\s*(?:<[^>]+>\s*)*MERCADORIAS SUJEITAS/,
  );
  const end = html.search(/MERCADORIAS SUJEITAS AOS DIFERIMENTOS PREVISTOS/);
  if (start < 0 || end < start)
    throw new Error('Não achei as Seções II e III do Apêndice II do RICMS/RS');
  const body = html.slice(start, end);
  // A Seção II diz "NÃO CONSTANTES DE ACORDOS"; a III, só "CONSTANTES".
  const third = body.search(/(?<!N(?:Ã|&Atilde;)O\s*)CONSTANTES DE ACORDOS CELEBRADOS/);
  if (third < 0) throw new Error('Não achei a Seção III do Apêndice II do RICMS/RS');

  const segments = [];
  const problems = [];
  let segment = null;
  const open = (section, item, name) => {
    segment = { section, item, name, items: [] };
    segments.push(segment);
  };

  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const row of rows) {
    const section = row.index < third ? 'II' : 'III';
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
    if (cells.length === 0) continue;
    // Seção III: "ITEM XXII - PRODUTOS DE PERFUMARIA..." abre o segmento.
    const heading = /^ITEM ([IVXL]+) [–-] (.+?)(?: NOTA\b.*)?$/.exec(cells[0]);
    if (cells.length === 1 && heading) {
      if (/^REVOGADO/.test(heading[2])) segment = null;
      else open(section, heading[1], heading[2].trim());
      continue;
    }
    // Seção II: o número romano do item vem na primeira coluna (e vale para as linhas de baixo).
    if (section === 'II' && ROMAN.test(cells[0]) && cells.length > 1) {
      if (/^Revogado/.test(cells[1])) {
        segment = null;
        continue;
      }
      if (segment?.section !== 'II' || segment.item !== cells[0]) open('II', cells[0], null);
    }
    if (!segment) continue;
    if (cells.some((c) => /^Revogado/.test(c))) continue;
    const cestAt = cells.findIndex((c) => CEST.test(c));
    if (cestAt < 0) continue;
    // Na Seção III a primeira coluna é o número do item, não NCM.
    const ncmAt = cells.findIndex(
      (c, i) => i !== cestAt && !(section === 'III' && i === 0) && isNcmCell(c),
    );
    const mvaAt = cells.findIndex((c, i) => i > Math.max(cestAt, ncmAt) && MVA.test(c));
    const description = cells
      .filter(
        (c, i) =>
          i !== cestAt &&
          i !== ncmAt &&
          !MVA.test(c) &&
          !ROMAN.test(c) &&
          !/^\d+(?:\.\d+)?$/.test(c),
      )
      .sort((a, b) => b.length - a.length)[0];
    const cest = cells[cestAt].replace(/\./g, '');
    if (!knownCest.has(cest)) problems.push(`CEST ${cells[cestAt]} fora do Convênio ICMS 142/18`);
    const ncmText = ncmAt >= 0 ? cells[ncmAt] : '';
    const ncms = [
      ...new Set(
        ncmText
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => t.replace(/[.,]/g, '')),
      ),
    ];
    const number = section === 'III' ? cells[0] : null;
    segment.items.push({
      item: number && /^\d+(?:\.\d+)?$/.test(number) ? number : String(segment.items.length + 1),
      cest,
      ncms,
      ncmText,
      description: description ?? '',
      mva: mvaAt >= 0 ? cells[mvaAt].replace(',', '.') : null,
    });
  }
  if (problems.length > 0)
    throw new Error(`RICMS/RS, Apêndice II: ${problems.slice(0, 10).join('; ')}`);
  const result = segments.filter((s) => s.items.length > 0);
  const total = result.reduce((n, s) => n + s.items.length, 0);
  if (total < 150) throw new Error(`Esperava as Seções II e III inteiras; achei ${total} itens`);
  return result;
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Seções do Apêndice II no formato de st-references.json. */
export function rsStReferences(segments, { url, segmentName }) {
  const nameOf = (s) => (s.name ? sentence(s.name) : segmentName(s.items[0].cest));
  const annexes = segments.map((s) => {
    const ncmsOf = new Map();
    for (const i of s.items)
      ncmsOf.set(i.cest, [...new Set([...(ncmsOf.get(i.cest) ?? []), ...i.ncms])]);
    return {
      annex: `${s.section}-${s.item}`,
      name: nameOf(s),
      cests: [...ncmsOf].map(([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest })),
    };
  });
  const references = segments
    .filter((s) => s.items.some((i) => i.mva && i.ncms.length > 0))
    .map((s) => ({
      uf: 'RS',
      segment: `${s.section}-${s.item}`,
      segmentName: nameOf(s),
      act: `RICMS/RS, Apêndice II, Seção ${s.section}, item ${s.item}`,
      source: 'stRsRicms',
      url,
      validFrom: '2016-01-01',
      validTo: null,
      note:
        s.section === 'III'
          ? 'MVA da operação interna. Vindo de outra UF, a tabela traz as MVAs das operações com 12% e 4%; para outras alíquotas, ajustar pela fórmula da nota 04 da Seção III. O remetente do Simples Nacional usa a MVA original (nota 05). Vale a redação atual.'
          : 'MVA da operação interna (Seção II: substituição tributária só do RS, sem acordo com outras UFs). Vale a redação atual.',
      items: s.items.filter((i) => i.mva && i.ncms.length > 0),
    }));
  return {
    segment: {
      uf: 'RS',
      act: 'RICMS/RS, Apêndice II, Seções II e III (texto em vigor)',
      source: 'stRsRicms',
      url,
      annexes,
    },
    references,
  };
}
