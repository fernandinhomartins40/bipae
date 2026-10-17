// Extrai, das páginas oficiais do RICMS/MG (Anexo XV, Parte 2, texto "sem dispositivos" da SEF/MG,
// que traz só o que está em vigor) e das notas de rodapé, a MVA de cada item de ST por capítulo e
// a data de efeito de cada linha (F3-26.c.MG). Itens revogados viram "saiu da ST" com a data da
// nota. Nenhum valor é digitado à mão.

// Entidades do HTML da SEF/MG (as do Latin-1 que aparecem no texto).
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

const cellText = (html) =>
  html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/[\s\u00a0\u0093\u0094]+/g, ' ')
    .trim();

/** Posições de NCM da célula; "Capítulos 33 e 34" vira os capítulos. Tokens malformados ficam de fora. */
function ncmTokens(text) {
  const chapters = /^Cap[ií]tulos? (.+)$/i.exec(text);
  if (chapters) return { ncms: [...chapters[1].matchAll(/\d{2}/g)].map((m) => m[0]), bad: [] };
  const ncms = [];
  const bad = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}(?:\.\d{2})?$|^\d{8}$/.test(raw))
      ncms.push(raw.replace(/\./g, ''));
    else if (/^[eE]$/.test(raw)) continue;
    else bad.push(raw);
  }
  return { ncms: [...new Set(ncms)], bad };
}

const NOTE_CELL = /^\(\s*([\d ,]+)\s*\)$/;
const ITEM = /^(\d+)\.(\d+)$/;
const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const MVA = /^\d{1,3}(?:[.,]\d{1,2})?$/;

const isoFromBr = (d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

/**
 * Notas de rodapé: "( 4301 ) Efeitos a partir de 1º/10/2021 - Redação dada pelo art. 1º ... do
 * Dec. nº 48.248, de 04/08/2021".
 */
export function parseMgNotes(htmls) {
  const notes = new Map();
  for (const html of htmls) {
    const text = cellText(html);
    const re =
      /\(\s*(\d+)\s*\)\s*Efeitos a partir de (\d{1,2})[º°o]?\/(\d{1,2})\/(\d{4})\s*-\s*(.*?)(?=\(\s*\d+\s*\)\s*Efeitos|$)/g;
    for (const m of text.matchAll(re)) {
      const [, num, d, mo, y, rest] = m;
      const dec = /Dec(?:reto)?\.? nº ([\d.]+), de \d{1,2}\/\d{1,2}\/(\d{4})/.exec(rest);
      notes.set(num, {
        from: isoFromBr(d, mo, y),
        revoked: /^Revogad/.test(rest.trim()),
        act: dec ? `Decreto ${dec[1]}/${dec[2]}` : null,
      });
    }
  }
  if (notes.size < 1000) throw new Error(`Esperava as notas do RICMS/MG; achei ${notes.size}`);
  return notes;
}

/** "07.003.01" a partir do capítulo 7 e do item 3.1 (a numeração da Parte 2 é a do CEST). */
const cestOf = (chapter, major, minor) =>
  `${chapter.padStart(2, '0')}${major.padStart(3, '0')}${minor.padStart(2, '0')}`;

/**
 * @param pages páginas da Parte 2 (HTML)
 * @param notes notas de rodapé (parseMgNotes)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseMgParte2(pages, notes, knownCest) {
  const chapters = [];
  let chapter = null;
  let labels = null; // subcolunas da MVA no cabeçalho do capítulo ("Indústria", "Atacadista")
  let pendingItem = null; // item cujas MVAs vêm na linha de baixo (rowspan)
  const problems = [];
  const badNcm = [];

  const noteOf = (list) => {
    // Vale a última nota da linha (a mais recente).
    const n = list.at(-1);
    const note = n ? notes.get(n) : null;
    if (n && !note) problems.push(`nota ${n} não encontrada`);
    return note ?? null;
  };

  const pushItem = (base, values, valueLabels) => {
    const mvas = values.filter((v) => MVA.test(v));
    if (mvas.length === 0) return; // sem MVA na tabela (combustíveis remetem a outro capítulo)
    mvas.forEach((v, idx) => {
      const label = mvas.length > 1 ? valueLabels?.[values.indexOf(v)] : null;
      chapter.items.push({
        ...base,
        item: mvas.length > 1 ? `${base.item}/${idx + 1}` : base.item,
        description: label ? `${base.description} — ${label}` : base.description,
        mva: v.replace(',', '.'),
      });
    });
  };

  for (const html of pages) {
    for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      let cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1]));
      const noteCell = NOTE_CELL.exec(cells[0] ?? '');
      const noteNums = noteCell ? noteCell[1].split(/[ ,]+/).filter(Boolean) : [];
      if (noteCell) cells = cells.slice(1);
      // Células vazias no fim da linha (as tabelas têm colunas de sobra); as do meio contam.
      while (cells.length > 0 && cells.at(-1) === '') cells.pop();
      if (cells.length === 0) continue;

      // Linha de baixo de um item com subcolunas: só os valores.
      if (pendingItem && cells.every((c) => MVA.test(c) || c === '-')) {
        pushItem(pendingItem.base, cells, pendingItem.labels);
        pendingItem = null;
        continue;
      }
      pendingItem = null;

      const title = /^(\d{1,2})\.\s*([A-ZÀ-Ú].*)$/.exec(cells[0]);
      if (cells.length === 1 && title && title[2] === title[2].toUpperCase()) {
        const alias = /Ver Cap[ií]tulo/i.test(title[2]);
        chapter = {
          chapter: title[1],
          name: title[2].replace(/\s*-\s*\(\s*Ver Cap.*$/i, '').trim(),
          alias,
          items: [],
          revoked: [],
        };
        chapters.push(chapter);
        labels = null;
        continue;
      }
      if (!chapter) continue;
      if (cells[0] === 'ITEM' && cells.includes('CEST')) {
        chapter.hasExceptions = cells.some((c) => /^EXCE/.test(c));
        labels = null;
        continue;
      }
      // Subcolunas da MVA, logo abaixo do cabeçalho.
      if (
        !labels &&
        chapter.items.length === 0 &&
        cells.every((c) => !MVA.test(c) && !ITEM.test(c))
      ) {
        if (cells.length >= 2 && cells.every((c) => c.length < 40)) labels = cells;
        continue;
      }
      const item = ITEM.exec(cells[0]);
      if (!item) continue;
      const [, major, minor] = item;
      const derived = cestOf(chapter.chapter, major, minor);
      if (/^Revogad/.test(cells[1] ?? '')) {
        const note = noteOf(noteNums);
        if (!note) problems.push(`item revogado ${chapter.chapter}/${cells[0]} sem nota`);
        chapter.revoked.push({
          item: cells[0],
          cest: derived,
          // A nota da linha "Revogado" diz desde quando (às vezes é a nova redação da tabela).
          excludedFrom: note?.from ?? null,
          excludedBy: note?.act ?? null,
        });
        continue;
      }
      if (!CEST.test(cells[1] ?? '')) continue;
      const cest = cells[1].replace(/\./g, '');
      if (cest !== derived)
        problems.push(`item ${chapter.chapter}/${cells[0]} com CEST ${cells[1]}`);
      if (!knownCest.has(cest)) problems.push(`CEST ${cells[1]} fora do Convênio ICMS 142/18`);
      const ncmText = cells[2] ?? '';
      const { ncms, bad } = ncmTokens(ncmText);
      if (bad.length > 0) badNcm.push(`${chapter.chapter}/${cells[0]}: ${bad.join(' ')}`);
      // Sem NCM na célula ("outras peças... não relacionadas"), o item vale pelo CEST.
      if (ncms.length === 0 && ncmText !== '')
        problems.push(`item ${chapter.chapter}/${cells[0]} sem NCM: ${ncmText}`);
      const exceptions = chapter.hasExceptions && cells[5] && cells[5] !== '-' ? cells[5] : null;
      const note = noteOf(noteNums);
      const base = {
        item: cells[0],
        cest,
        ncms,
        ncmText,
        description: exceptions ? `${cells[3]} (exceto: ${exceptions})` : cells[3],
        from: note?.from ?? null,
      };
      const values = cells.slice(chapter.hasExceptions ? 6 : 5);
      if (values.length > 0 && values.every((v) => !MVA.test(v) && v !== '-' && !/^Vide/.test(v))) {
        // Rótulos nesta linha, valores na de baixo.
        pendingItem = { base, labels: values };
        continue;
      }
      pushItem(base, values, labels);
    }
  }
  if (problems.length > 0)
    throw new Error(`RICMS/MG, Anexo XV: ${problems.slice(0, 10).join('; ')}`);
  const result = chapters.filter((c) => !c.alias);
  const total = result.reduce((n, c) => n + c.items.length, 0);
  if (total < 500) throw new Error(`Esperava a Parte 2 inteira do Anexo XV; achei ${total} itens`);
  return { chapters: result, badNcm };
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Capítulos do Anexo XV no formato de st-references.json (lista em ST e MVA por item). */
export function mgStReferences(chapters, { url }) {
  const annexes = chapters.map((c) => {
    const ncmsOf = new Map();
    for (const i of c.items)
      ncmsOf.set(i.cest, [...new Set([...(ncmsOf.get(i.cest) ?? []), ...i.ncms])]);
    return {
      annex: c.chapter,
      name: sentence(c.name),
      cests: [
        ...[...ncmsOf].map(([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest })),
        ...c.revoked
          .filter((r) => !ncmsOf.has(r.cest))
          .map((r) => ({ cest: r.cest, excludedFrom: r.excludedFrom, excludedBy: r.excludedBy })),
      ].sort((a, b) => (a.cest < b.cest ? -1 : 1)),
    };
  });
  const references = chapters
    .filter((c) => c.items.some((i) => i.ncms.length > 0))
    .map((c) => ({
      uf: 'MG',
      segment: c.chapter.padStart(2, '0'),
      segmentName: sentence(c.name),
      act: 'RICMS/MG, Anexo XV, Parte 2',
      source: 'stMgAnexoXV',
      url,
      // Desde a data de efeito mais antiga da redação atual dos itens (notas de rodapé).
      validFrom: c.items.map((i) => i.from).sort()[0],
      validTo: null,
      note: 'MVA original. Vindo de outra UF, usar a MVA ajustada pela fórmula do § 5º do art. 19 da Parte 1 do Anexo XV do RICMS/MG. Vale a redação atual de cada item; onde há duas MVAs, a da indústria e a do atacadista ou distribuidor, a descrição diz qual é.',
      items: c.items.filter((i) => i.ncms.length > 0).map(({ from: _f, ...i }) => i),
    }));
  return {
    segment: {
      uf: 'MG',
      act: 'RICMS/MG, Anexo XV, Parte 2 (texto em vigor, sem os dispositivos revogados)',
      source: 'stMgAnexoXV',
      url,
      annexes,
    },
    references,
  };
}
