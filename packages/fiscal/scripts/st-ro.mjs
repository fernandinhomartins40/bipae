// Extrai, do Anexo VI do RICMS/RO (Decreto 22.721/2018, texto consolidado do portal de legislação
// da SEFIN-RO), as mercadorias em substituição tributária com CEST, NCM e a MVA original
// (F3-26.d.RO). As linhas revogadas não trazem o CEST e ficam de fora. Nada é digitado à mão.

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
    .trim();

const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const PERCENT = /^(\d{1,3}(?:,\d{1,2})?)\s*%$/;

/** NCM da célula: códigos às vezes colados ("2207.202208.40.00"). */
function ncmsOf(cell) {
  return [
    ...new Set(
      [...cell.matchAll(/\d{4}(?:\.\d{1,2}(?:\.\d{2})?)?/g)].map((m) => m[0].replace(/\./g, '')),
    ),
  ];
}

/**
 * @param html texto_html do Anexo VI (API pesquisar_detalhe_lei do portal da SEFIN-RO)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseRoAnexoVI(html, knownCest) {
  const names = new Map();
  const items = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      textOf(c[1]),
    );
    // Parte 1: "01 || Autopeças. || 01" (nome de cada segmento).
    if (cells.length === 3 && /^\d{2}$/.test(cells[0]) && cells[0] === cells[2]) {
      names.set(cells[0], cells[1].replace(/\.$/, ''));
      continue;
    }
    const cestAt = cells.findIndex((c) => CEST.test(c));
    if (cestAt < 1) continue;
    const mva = cells
      .slice(cestAt + 2)
      .map((c) => PERCENT.exec(c))
      .find(Boolean);
    if (!mva) continue;
    const cest = cells[cestAt].replace(/\./g, '');
    items.push({
      item: cells[0],
      cest,
      ncms: ncmsOf(cells[cestAt + 1] ?? ''),
      ncmText: cells[cestAt + 1] ?? '',
      description: cells[cestAt - 1],
      mva: mva[1].replace(',', '.'),
      known: knownCest.has(cest),
    });
  }
  if (items.length < 300)
    throw new Error(`Esperava o Anexo VI inteiro; achei ${items.length} itens`);
  if (items.filter((i) => !i.known).length > items.length / 10) {
    throw new Error('Anexo VI do RICMS/RO: muitos CEST fora do Convênio ICMS 142/18');
  }
  const segments = new Map();
  for (const { known: _k, ...i } of items) {
    const code = i.cest.slice(0, 2);
    if (!segments.has(code)) segments.set(code, { code, name: names.get(code) ?? null, items: [] });
    segments.get(code).items.push(i);
  }
  return [...segments.values()];
}

/** Anexo VI no formato de st-references.json. */
export function roStReferences(segments, { url, segmentName }) {
  const nameOf = (s) => s.name ?? segmentName(s.code);
  return {
    segment: {
      uf: 'RO',
      act: 'RICMS/RO, Anexo VI (texto consolidado)',
      source: 'stRoAnexoVI',
      url,
      annexes: segments.map((s) => ({
        annex: s.code,
        name: nameOf(s),
        cests: [...new Map(s.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
          ncms.length > 0 ? { cest, ncms } : { cest },
        ),
      })),
    },
    references: segments
      .map((s) => ({
        uf: 'RO',
        segment: s.code,
        segmentName: nameOf(s),
        act: 'RICMS/RO, Anexo VI',
        source: 'stRoAnexoVI',
        url,
        validFrom: '2018-04-05',
        validTo: null,
        note: 'MVA original. A tabela também traz a MVA ajustada e a corrigida para as entradas de outras UFs. Vale a redação atual.',
        items: s.items.filter((i) => i.ncms.length > 0),
      }))
      .filter((r) => r.items.length > 0),
  };
}
