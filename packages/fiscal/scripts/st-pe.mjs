// Extrai, do RICMS/PE (Decreto 44.650/2017) no texto consolidado da SEFAZ-PE, as mercadorias em
// substituição tributária e a MVA de cada uma (F3-26.d.PE). O Anexo 37 descreve cada segmento em
// prosa, sempre pelos itens dos anexos do Convênio ICMS 142/2018 ("itens 1.0 a 5.0 do Anexo X"),
// e as MVAs vêm no artigo da seção "Da MVA" ou nas tabelas dos Anexos 37-A, 37-B e 37-C. O item do
// Convênio vira CEST pela tabela do CEST já gerada (cest.json). Nenhum valor é digitado à mão.
//
// Capítulos em que a base não é uma MVA única (pauta da Sefaz, PMC da CMED, MVA por tipo de
// remetente ou regras do Convênio 51/2000) ficam de fora, com o motivo, e aparecem como "falta
// configurar" na regra de ICMS.

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
};

/** Texto corrido do HTML (Windows-1252 já decodificado). */
export function peText(html) {
  return html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ');
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const roman = (text) =>
  [...text].reduce(
    (acc, ch, i, all) => acc + (ROMAN[ch] < (ROMAN[all[i + 1]] ?? 0) ? -ROMAN[ch] : ROMAN[ch]),
    0,
  );

/** "1º.12.2023" → "2023-12-01" */
const isoFromPe = (text) => {
  const m = /(\d{1,2})[º°]?\.(\d{1,2})\.(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Onde começa o próximo dispositivo: o texto de uma redação anterior acaba ali. */
const NEXT_PROVISION =
  /(?=\bArt\. ?\d|\bSeção [IVXL]+\b|CAP[ÍI]TULO|§ ?\d|\bParágrafo único|\b[IVXL]+ - |\b\d{1,2}\. (?=[A-Z0-9])|\b[a-z]\) )/g;

/**
 * Tira as notas de vigência "(Dec. ... – efeitos ...)" e os blocos "Redação anterior, efeitos até
 * ...:", que repetem o dispositivo como era antes. O bloco antigo começa com o mesmo rótulo do
 * dispositivo (Art. 45., II -, a), 1.) e vai até o próximo dispositivo.
 */
export function withoutOldText(text) {
  const t = text.replace(/\((?:Dec\.?|Decreto)[^)]*\)/g, ' ').replace(/\s+/g, ' ');
  let out = '';
  let from = 0;
  const marker = /Redação anterior[^:]*:/g;
  let m;
  while ((m = marker.exec(t))) {
    out += t.slice(from, m.index);
    let j = m.index + m[0].length;
    const label =
      /^\s*(?:Art\. ?\d+[º°-]*[A-Z]?\s*\.?|[IVXL]+ -|[a-z]\)|\d{1,2}\.|§ ?\d+º?|Parágrafo único\.?)/.exec(
        t.slice(j),
      );
    if (label) j += label[0].length;
    NEXT_PROVISION.lastIndex = j;
    const next = NEXT_PROVISION.exec(t);
    from = next ? next.index : t.length;
    marker.lastIndex = from;
  }
  return (out + t.slice(from)).replace(/\s+/g, ' ');
}

/** "1.0 a 5.0", "2.0 e 4.0", "6.0 a 8.0, 10.0 a 10.2" → lista de itens do Convênio. */
export function itemsOf(text, available) {
  const out = new Set();
  const key = (item) => item.split('.').map(Number);
  const cmp = (a, b) => {
    const [x, y] = [key(a), key(b)];
    return x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
  };
  for (const part of text.split(/,|\be\b/)) {
    const range = /(\d+\.\d+)\s*(?:a|ao)\s*(\d+\.\d+)/.exec(part);
    if (range) {
      for (const item of available) {
        if (cmp(item, range[1]) >= 0 && cmp(item, range[2]) <= 0) out.add(item);
      }
      continue;
    }
    const single = /(\d+\.\d+)/.exec(part);
    if (single) out.add(single[1]);
  }
  return [...out].sort(cmp);
}

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const STOP = new Set([
  'das',
  'dos',
  'de',
  'do',
  'da',
  'e',
  'com',
  'operacoes',
  'novo',
  'outros',
  'outras',
]);
/** Palavras do nome, pelas 5 primeiras letras (cobre plural e "automotor"/"automotores"). */
const wordsOf = (text) =>
  new Set(
    fold(text)
      .split(/[^a-z]+/)
      .filter((w) => w && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
/** Segmento do CEST com exatamente as mesmas palavras do nome do capítulo. */
function segmentByName(chapterName, segments) {
  const words = wordsOf(chapterName);
  const found = segments.filter((s) => {
    const other = wordsOf(s.name);
    return other.size === words.size && [...words].every((w) => other.has(w));
  });
  return found.length === 1 ? found[0] : null;
}

/** Capítulos lidos e o motivo dos que ficam de fora. */
const SKIPPED = [
  [
    /BEBIDAS QUENTES/,
    'A base é o preço a consumidor final do ato da Sefaz; a MVA só vale na falta dele.',
  ],
  [
    /ÁGUA MINERAL OU POTÁVEL, REFRIGERANTE/,
    'A base é o preço a consumidor final do ato da Sefaz; a MVA muda conforme quem vende.',
  ],
  [
    /ÁGUA MINERAL NATURAL OU ADICIONADA/,
    'Água em garrafão retornável: a base é o preço do ato da Sefaz.',
  ],
  [
    /REVENDEDOR QUE EFETUE VENDA/,
    'Venda porta a porta: MVA de 59,54% ou de 10% conforme o credenciamento do remetente.',
  ],
  [/FATURAMENTO DIRETO/, 'Faturamento direto do fabricante: regras do Convênio ICMS 51/2000.'],
  [/AUTOPEÇAS/, 'A MVA muda conforme quem vende (fabricante para índice de fidelidade ou demais).'],
  [/MEDICAMENTOS/, 'A base é o preço máximo ao consumidor da CMED; a MVA só vale na falta dele.'],
];
/** Capítulos que remetem às tabelas dos Anexos 37-A, 37-B e 37-C (lidas à parte). */
const TABLE_CHAPTERS = /Anexo 37-[ABC]/;

/**
 * Lê o Anexo 37 e as tabelas 37-A a 37-C. `segments` é a lista de segmentos do cest.json, na ordem
 * dos anexos do Convênio (o Anexo II é o primeiro); `cests` são os itens do cest.json.
 */
export function parsePeAnexo37(html, { segments, cests }) {
  const text = peText(html);
  const start = text.indexOf('DAS OPERAÇÕES COM LÂMINA DE BARBEAR');
  const tablesAt = text.indexOf('ANEXO 37-A ', start);
  const end = text.indexOf('ANEXO 38 ', tablesAt);
  if (start < 0 || tablesAt < 0 || end < 0) throw new Error('Anexo 37 do RICMS/PE não encontrado');
  const segmentOfAnnex = (annexRoman) => {
    const segment = segments[roman(annexRoman) - 2];
    if (!segment) throw new Error(`Anexo ${annexRoman} do Convênio ICMS 142/2018 sem segmento`);
    return segment;
  };
  const itemsOfSegment = (code) =>
    cests.filter((c) => c.segment === code && !c.end).map((c) => c.item);
  const cestsOf = (code, items) =>
    cests.filter((c) => c.segment === code && !c.end && items.includes(c.item));

  const chapters = [];
  const skipped = [];
  const raw = text.slice(start - 40, tablesAt);
  const heads = [
    ...raw.matchAll(/CAP[ÍI]TULO ?([IVXL]+) (DAS (?:OPERAÇÕES|OPERACÕES)[^(]*?)\s*(?=\(|Seção)/g),
  ];
  for (let h = 0; h < heads.length; h++) {
    const head = heads[h];
    const body = raw.slice(head.index, heads[h + 1]?.index ?? raw.length);
    const name = head[2].trim();
    const validFrom = isoFromPe(/efeitos a partir de ([^)]+)\)/.exec(body)?.[1] ?? '');
    const skip = SKIPPED.find(([re]) => re.test(name));
    if (skip) {
      skipped.push({ chapter: head[1], name, reason: skip[1] });
      continue;
    }
    const clean = withoutOldText(body);
    if (TABLE_CHAPTERS.test(clean)) continue;
    // O capítulo é lido por artigo: cada frase de MVA diz de que artigo trata, e o escopo (itens do
    // Convênio ICMS 142/2018) está nesse artigo.
    const articles = new Map();
    const marks = [...clean.matchAll(/Art\. ?(\d+) ?\./g)];
    marks.forEach((m, k) =>
      articles.set(m[1], clean.slice(m.index, marks[k + 1]?.index ?? clean.length)),
    );
    const scopeOf = (article) => {
      const textOf = articles.get(article) ?? '';
      const scope =
        /relacionad[oa]s? (?:n[oa]s? (?:item|itens|subitem|subitens) (.+?) do|no) Anexo ([IVXL]+) do Convênio ICMS 142\/2018/.exec(
          textOf,
        );
      if (scope) {
        const segment = segmentOfAnnex(scope[2]);
        const available = itemsOfSegment(segment.code);
        return { segment, items: scope[1] ? itemsOf(scope[1], available) : available };
      }
      // Sem itens no texto ("nos termos do Convênio ICMS 118/2017"), o artigo cobre o segmento
      // inteiro: o do CEST com as mesmas palavras no nome do capítulo.
      const byName = segmentByName(name, segments);
      if (byName && /nos termos do Convênio ICMS \d+\/\d{4}/.test(textOf)) {
        return { segment: byName, items: itemsOfSegment(byName.code) };
      }
      return null;
    };
    const lines = [];
    // a) Várias MVAs, uma por item: "I - 60,03% (...), item 1.0; II - 102,31% (...), itens 2.0 e 4.0".
    for (const list of clean.matchAll(
      /MVAs aplicáveis às operações de que trata o art\. ?(\d+) são as seguintes, de acordo com os itens do Anexo ([IVXL]+) do Convênio ICMS 142\/2018: (.*?)(?=Seção|Subseção|CAP[ÍI]TULO| II - n|$)/g,
    )) {
      const segment = segmentOfAnnex(list[2]);
      const available = itemsOfSegment(segment.code);
      for (const m of list[3].matchAll(
        /(?:[IVXL]+ -|[a-z]\)) (\d[\d,]*)% \([^)]*\),? (?:itens|item) (.+?)(?:;|\.(?= |$))/g,
      )) {
        lines.push({ segment, mva: m[1], items: itemsOf(m[2], available) });
      }
    }
    // b) Uma MVA para alguns itens e outra para os demais (eletrônicos).
    for (const split of clean.matchAll(
      /MVA aplicável às operações de que trata o art\. ?(\d+) é: a\) (\d[\d,]*)% \([^)]*\), para as mercadorias relacionadas nos itens (.+?) do Anexo ([IVXL]+) do Convênio ICMS 142\/2018; ou b\) (\d[\d,]*)% \([^)]*\), para as demais mercadorias/g,
    )) {
      const scope = scopeOf(split[1]);
      if (!scope) throw new Error(`RICMS/PE, capítulo ${head[1]}: art. ${split[1]} sem escopo`);
      const special = itemsOf(split[3], itemsOfSegment(segmentOfAnnex(split[4]).code));
      lines.push({ segment: scope.segment, mva: split[2], items: special });
      lines.push({
        segment: scope.segment,
        mva: split[5],
        items: scope.items.filter((i) => !special.includes(i)),
      });
    }
    // c) Uma MVA só: "A MVA aplicável às operações de que trata o art. 35 é 30%".
    for (const single of clean.matchAll(
      /MVA aplicável às operações de que trata o art\. ?(\d+) é (\d[\d,]*)%/g,
    )) {
      const scope = scopeOf(single[1]);
      if (!scope) throw new Error(`RICMS/PE, capítulo ${head[1]}: art. ${single[1]} sem escopo`);
      lines.push({ segment: scope.segment, mva: single[2], items: scope.items });
    }
    if (lines.length === 0) {
      throw new Error(`RICMS/PE, Anexo 37, capítulo ${head[1]} (${name}): MVA fora do formato`);
    }
    const items = lines.flatMap((l) =>
      cestsOf(l.segment.code, l.items).map((c) => ({
        item: c.item,
        cest: c.cest,
        ncms: c.ncm,
        description: c.description,
        mva: l.mva,
      })),
    );
    if (items.length === 0) throw new Error(`RICMS/PE, capítulo ${head[1]}: nenhum CEST`);
    const cestCount = new Set(items.map((i) => i.cest)).size;
    if (cestCount !== items.length) {
      throw new Error(`RICMS/PE, capítulo ${head[1]}: CEST com duas MVAs`);
    }
    chapters.push({ chapter: head[1], name, validFrom, items });
  }

  // Tabelas: "ITEM DO ANEXO XIX DO CONVÊNIO ICMS 142/2018 MVA ... (%) 1.0 76,45 2.0 49,87 ...".
  const tables = [];
  const tableText = text.slice(tablesAt, end);
  for (const t of tableText.matchAll(
    /ANEXO (37-[ABC]) \((?:Dec\.?|Decreto)[^)]*?efeitos a partir de ([^)]+)\) ([^(]+?)(?= \(|ITEM DO ANEXO)/g,
  )) {
    const from = t.index;
    const next = tableText.indexOf('ANEXO 37-', from + 10);
    const body = tableText.slice(from, next < 0 ? tableText.length : next);
    const blocks = [
      ...body.matchAll(/ITEM DO ANEXO ([IVXL]+) DO CONVÊNIO ICMS 142\/2018 MVA[^%]*\(%\)/g),
    ];
    for (let b = 0; b < blocks.length; b++) {
      const segment = segmentOfAnnex(blocks[b][1]);
      const chunk = body.slice(
        blocks[b].index + blocks[b][0].length,
        blocks[b + 1]?.index ?? body.length,
      );
      // Os itens vêm em ordem crescente; o que aparece de novo (ou para trás) depois de uma
      // "Redação anterior" é o valor antigo e fica de fora.
      const seen = new Map();
      let last = -1;
      for (const m of chunk
        .replace(/\((?:Dec\.?|Decreto)[^)]*\)/g, ' ')
        .matchAll(/(\d{1,3}\.\d) (\d{1,3}(?:,\d{1,2})?)(?= |$)/g)) {
        const order = Number(m[1]);
        if (order <= last) continue;
        last = order;
        seen.set(m[1], m[2]);
      }
      const items = [...seen].flatMap(([item, mva]) =>
        cestsOf(segment.code, [item]).map((c) => ({
          item: c.item,
          cest: c.cest,
          ncms: c.ncm,
          description: c.description,
          mva,
        })),
      );
      tables.push({
        table: t[1],
        name: t[3].replace(/SUJEITOS AO REGIME.*$/, '').trim(),
        annex: blocks[b][1],
        validFrom: isoFromPe(t[2]),
        rows: seen.size,
        items,
      });
    }
  }
  const total =
    chapters.reduce((n, c) => n + c.items.length, 0) +
    tables.reduce((n, t) => n + t.items.length, 0);
  if (chapters.length < 10 || tables.length < 4 || total < 300) {
    throw new Error(
      `Esperava o Anexo 37 inteiro; achei ${chapters.length} capítulos, ${tables.length} tabelas e ${total} CEST`,
    );
  }
  return { chapters, tables, skipped };
}

const sentence = (text) => text.charAt(0) + text.slice(1).toLowerCase();

/** No formato de st-references.json. */
export function peStReferences({ chapters, tables, skipped }, { url }) {
  const common = {
    uf: 'PE',
    source: 'stPeRicms',
    url,
    validTo: null,
    note: 'MVA das operações internas ou de importação. Na entrada de outra UF, a MVA é ajustada (RICMS/PE, Anexo 37, art. 11). Vale a redação atual.',
  };
  const fromChapters = chapters.map((c) => ({
    ...common,
    segment: c.chapter,
    segmentName: sentence(c.name.replace(/^DAS OPERAÇÕES COM /, '')),
    act: `RICMS/PE (Decreto 44.650/2017), Anexo 37, Capítulo ${c.chapter}`,
    validFrom: c.validFrom,
    items: c.items,
  }));
  const fromTables = tables.map((t) => ({
    ...common,
    segment: `${t.table}/${t.annex}`,
    segmentName: sentence(t.name),
    act: `RICMS/PE (Decreto 44.650/2017), Anexo ${t.table}`,
    validFrom: t.validFrom,
    items: t.items,
  }));
  const references = [...fromChapters, ...fromTables].filter((r) => r.items.length > 0);
  const annexes = references.map((r) => ({
    annex: r.segment,
    name: r.segmentName,
    cests: [...new Map(r.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
      ncms.length > 0 ? { cest, ncms } : { cest },
    ),
  }));
  return {
    segment: {
      uf: 'PE',
      act: 'RICMS/PE (Decreto 44.650/2017), Anexo 37 e Anexos 37-A a 37-C (texto consolidado da SEFAZ-PE)',
      source: 'stPeRicms',
      url,
      annexes,
    },
    references,
    // Fora da tabela, com o motivo (vai para docs/fiscal/cobertura-ufs-regimes.md).
    notRead: skipped.map((s) => ({ chapter: s.chapter, name: s.name, reason: s.reason })),
  };
}
