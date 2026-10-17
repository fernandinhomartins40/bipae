// Extrai, da Portaria 16-R/2019 da SEFAZ-ES no texto atualizado (Legislação On-Line), os produtos
// em substituição tributária com CEST, NCM e a MVA original (F3-26.d.ES). A página pinta a redação
// anterior de verde: essas linhas ficam de fora, e os itens revogados (verdes, logo depois da nota
// "revogado pela Portaria ..., efeitos a partir de ...") viram "saiu da ST". Nada é digitado à mão.

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
const NCM_TOKEN = /^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}$|^\d{8}$/;
const SECTION = /^([IVXL]+)\s*[-–]\s*(.+)$/;

/** "02.09.22" → "2022-09-02" */
const isoFromEs = (text) => {
  const m = /(\d{2})\.(\d{2})\.(\d{2,4})/.exec(text);
  return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * @param html Port16-R - ATUALIZADA.htm
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseEsPortaria16R(html, knownCest) {
  const sections = [];
  let section = null;
  let pending = []; // itens à espera da linha "a) MVA original"
  let revokedNote = null; // última nota "revogado ... efeitos a partir de ..."
  let history = false;

  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const raw = row[1];
    const colors = new Set([...raw.matchAll(/color:\s*([#\w]+)/gi)].map((m) => m[1].toLowerCase()));
    const cells = [...raw.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
    const text = cells.filter(Boolean).join(' ');
    if (!text) continue;
    // "Redação Original, efeitos até ..." abre um trecho antigo (às vezes sem cor), que vai até a
    // próxima "Nova Redação" ou a próxima linha em preto.
    if (/^Reda[çc][ãa]o (original|anterior)/i.test(text)) {
      history = true;
      continue;
    }
    if (/^Nova Reda[çc][ãa]o/i.test(text) || colors.has('black')) history = false;
    const old = history || (colors.has('green') && !colors.has('black'));

    const note =
      /revogad[oa]\s+pel[ao]\s+Portaria\s+n?[ºo°]?\s*([\d-]+R)[^,]*,\s*de\s*\d{2}\.\d{2}\.\d{2,4},?\s*efeitos a partir de\s*(\d{2}\.\d{2}\.\d{2,4})/i.exec(
        text,
      );
    if (note && !old) {
      revokedNote = { by: `Portaria ${note[1]}`, from: isoFromEs(note[2]) };
      continue;
    }
    const cestAt = cells.findIndex((c) => CEST.test(c));
    if (old) {
      // Item verde logo depois da nota de revogação: saiu da ST.
      if (revokedNote && cestAt >= 0 && section) {
        section.revoked.push({ cest: cells[cestAt].replace(/\./g, ''), ...revokedNote });
      }
      continue;
    }
    if (cestAt < 0) revokedNote = null;

    const sec = SECTION.exec(cells[0] ?? '');
    if (sec && cestAt < 0 && /[A-ZÀ-Ú]{4}/.test(sec[2])) {
      section = {
        roman: sec[1],
        name: sec[2].replace(/\s*\(.*$/, '').trim(),
        items: [],
        revoked: [],
      };
      sections.push(section);
      pending = [];
      continue;
    }
    if (!section) continue;

    // "a) MVA original 50,00%": vale para os itens que esperavam.
    const orig = /^a\)\s*MVA(?:[-\s]ST)?\s+original\b/i.exec(cells[0] ?? '');
    if (orig) {
      const pct = cells.map((c) => /^(\d{1,3}(?:,\d{1,2})?)\s*%$/.exec(c)).find(Boolean);
      if (pct) {
        for (const it of pending) it.mva = pct[1].replace(',', '.');
        pending = [];
      }
      continue;
    }
    if (cestAt >= 1) {
      const cest = cells[cestAt].replace(/\./g, '');
      const ncmText = cells[cestAt + 1] ?? '';
      const ncms = [
        ...new Set(
          ncmText
            .split(/[\s,;/]+/)
            .filter((t) => NCM_TOKEN.test(t))
            .map((t) => t.replace(/\./g, '')),
        ),
      ];
      const head = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(cells[0]);
      const item = {
        item: head ? head[1] : String(section.items.length + 1),
        cest,
        ncms,
        ncmText,
        description: head ? head[2] : cells[0],
        mva: null,
        known: knownCest.has(cest),
      };
      // MVA na própria linha (algumas tabelas trazem a coluna preenchida).
      const own = cells
        .slice(cestAt + 2)
        .map((c) => /^(\d{1,3}(?:,\d{1,2})?)\s*%?$/.exec(c))
        .find(Boolean);
      if (own) item.mva = own[1].replace(',', '.');
      else pending.push(item);
      section.items.push(item);
    }
  }
  const result = sections.filter((s) => s.items.length > 0 || s.revoked.length > 0);
  const items = result.flatMap((s) => s.items);
  if (items.length < 200)
    throw new Error(`Esperava a Portaria 16-R inteira; achei ${items.length} itens`);
  if (items.filter((i) => !i.known).length > items.length / 10) {
    throw new Error('Portaria 16-R: muitos CEST fora do Convênio ICMS 142/18');
  }
  return result;
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Portaria 16-R no formato de st-references.json. */
export function esStReferences(sections, { url }) {
  const annexes = sections.map((s) => {
    const inForce = new Map(s.items.map((i) => [i.cest, i.ncms]));
    return {
      annex: s.roman,
      name: sentence(s.name),
      cests: [
        ...[...inForce].map(([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest })),
        ...s.revoked
          .filter((r) => !inForce.has(r.cest))
          .map((r) => ({ cest: r.cest, excludedFrom: r.from, excludedBy: r.by })),
      ],
    };
  });
  const references = sections
    .map((s) => ({
      uf: 'ES',
      segment: s.roman,
      segmentName: sentence(s.name),
      act: 'Portaria SEFAZ 16-R/2019 (texto atualizado)',
      source: 'stEsPortaria16R',
      url,
      validFrom: '2019-04-01',
      validTo: null,
      note: 'MVA original. Vindo de outra UF, a portaria traz a MVA ajustada para 4%, 7% e 12%. Vale a redação atual de cada item.',
      items: s.items.filter((i) => i.mva && i.ncms.length > 0).map(({ known: _k, ...i }) => i),
    }))
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'ES',
      act: 'Portaria SEFAZ 16-R/2019 (texto atualizado)',
      source: 'stEsPortaria16R',
      url,
      annexes,
    },
    references,
  };
}
