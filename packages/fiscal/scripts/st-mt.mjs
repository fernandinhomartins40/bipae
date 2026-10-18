// Extrai, da Portaria 195/2019-SEFAZ/MT consolidada (página da SEFAZ-MT), a MVA de cada CEST em
// substituição tributária (F3-26.d.MT). São duas MVAs: a das tabelas do Anexo Único, para quem é
// optante pelo crédito outorgado do Anexo XVII do RICMS/MT (art. 1º), e a do art. 2º-B, por faixa
// de CEST, para os demais contribuintes. Linhas de redação anterior, revogadas ou com vigência
// encerrada ficam de fora. Nenhum valor é digitado à mão.

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
  Uacute: 'Ú',
};

const textOf = (html) =>
  html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ')
    .trim();

/** Linha que não vale mais: redação anterior ou original, revogada ou com vigência encerrada. */
const OLD =
  /reda[çc][ãa]o (?:origina\s?l|anterior)|revogad|efeitos (?:a partir )?de [^)]*? a \d{1,2}[./]\s?\d{1,2}[./]\d{2,4}/i;

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const romanOf = (text) =>
  [...text].reduce(
    (acc, ch, i, all) => acc + (ROMAN[ch] < (ROMAN[all[i + 1]] ?? 0) ? -ROMAN[ch] : ROMAN[ch]),
    0,
  );

const CEST_TEXT = /^\d{2}\.\d{3}\.\d{2}$/;
const cestDigits = (text) => text.replace(/\D/g, '');

/** "3815.12.10 3815.12.90" → ["38151210", "38151290"] */
const ncmsOf = (text) =>
  text
    .split(/\s+/)
    .map((t) => t.replace(/\D/g, ''))
    .filter((t) => t.length >= 2);

/**
 * Lê a página (HTML já decodificado). `known` são os CEST do Convênio ICMS 142/2018. Devolve as
 * linhas do Anexo Único e as faixas do art. 2º-B.
 */
export function parseMtPortaria195(html, known) {
  const start = html.search(/ANEXO (?:&Uacute;|Ú)NICO/);
  if (start < 0) throw new Error('Portaria 195/2019 (MT): Anexo Único não encontrado');
  const rows = [];
  const unknown = new Set();
  const seen = new Set();
  // Títulos das tabelas ("XX - VENDAS PORTA A PORTA"). Quando a numeração volta para trás, é a
  // tabela antiga, de antes da renumeração, e fica de fora até a numeração voltar a subir.
  const anexo = html.slice(start);
  let table = 0;
  let old = false;
  const pieces = anexo.split(/(?=<tr[^>]*>)/i);
  for (const piece of pieces) {
    // O título fica no texto entre as tabelas.
    const between = textOf(piece.replace(/<tr[^>]*>[\s\S]*?<\/tr>/gi, ' '));
    for (const h of between.matchAll(/(?:^| )([IVXL]+)(?:-[A-Z])? - [A-ZÇÃÕÁÉÍÓÚÂÊÔ]{3,}/g)) {
      const n = romanOf(h[1]);
      old = n < table;
      if (!old) table = n;
    }
    const tr = /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(piece);
    if (!tr || old) continue;
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
    if (cells.length !== 5) continue;
    const [item, cestText, ncmText, description, mvaText] = cells;
    if (!CEST_TEXT.test(cestText)) continue; // cabeçalho, revogada sem CEST ou célula torta
    if (OLD.test(description)) continue;
    const mva = /^(\d{1,3}(?:,\d{1,2})?)%$/.exec(mvaText)?.[1];
    if (!mva) continue;
    const cest = cestDigits(cestText);
    // A redação atual vem primeiro; outra linha do mesmo item e CEST na tabela é a antiga.
    const key = `${table}|${item.replace(/\.0$/, '')}|${cest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!known.has(cest)) {
      unknown.add(cest);
      continue;
    }
    rows.push({
      item,
      cest,
      ncms: ncmsOf(ncmText),
      ncmText,
      description: description
        .replace(/\s*\((?:cf\.|Nova reda|Reda|Acrescentad)[^)]*\)/gi, '')
        .trim(),
      mva,
    });
  }
  if (rows.length < 500) throw new Error(`Portaria 195/2019 (MT): só ${rows.length} linhas`);

  // Art. 2º-B: "I - autopeças - CEST 01.001.00 a 01.999.00: 65,29%;". Ignora as redações antigas
  // que vêm logo depois ("Redação anterior ... XV - ...: 59,75%;").
  const text = textOf(html.slice(0, start));
  const art = text.indexOf('Art. 2°-B');
  const end = text.indexOf('§ 1°', art);
  if (art < 0 || end < 0) throw new Error('Portaria 195/2019 (MT): art. 2º-B não encontrado');
  const ranges = [];
  const body = text
    .slice(art, end)
    .replace(
      /Reda[çc][ãa]o (?:anterior|original)[\s\S]*?(?=\b[IVXL]+(?:-[A-Z])? - [a-zà-ú])/gi,
      ' ',
    );
  for (const m of body.matchAll(
    /\b([IVXL]+(?:-[A-Z])?) - ([^-]+?) - CEST ([\d. a e]+?): (\d{1,3},\d{2})%/g,
  )) {
    const spans = [...m[3].matchAll(/(\d{2}\.\d{3}\.\d{2})(?: a (\d{2}\.\d{3}\.\d{2}))?/g)].map(
      (s) => [cestDigits(s[1]), cestDigits(s[2] ?? s[1])],
    );
    // Redação antiga do mesmo inciso que escapou da limpeza: fica a primeira (a atual).
    if (ranges.some((r) => r.inciso === m[1])) continue;
    ranges.push({ inciso: m[1], name: m[2].trim(), spans, mva: m[4] });
  }
  if (ranges.length < 20)
    throw new Error(`Portaria 195/2019 (MT): art. 2º-B com ${ranges.length} incisos`);
  return { rows, ranges, unknown: [...unknown].sort() };
}

/** No formato de st-references.json; `segmentName` dá o nome do segmento do CEST. */
export function mtStReferences({ rows, ranges }, { url, segmentName }) {
  const rangeOf = (cest) =>
    ranges.find((r) => r.spans.some(([a, b]) => cest >= a && cest <= b)) ?? null;
  const bySegment = new Map();
  for (const row of rows) {
    const code = row.cest.slice(0, 2);
    if (!bySegment.has(code)) bySegment.set(code, new Map());
    const items = bySegment.get(code);
    // Uma linha por CEST e MVA, com os NCM de todas as linhas.
    const key = `${row.cest}|${row.mva}`;
    const found = items.get(key);
    if (found) {
      for (const n of row.ncms) if (!found.ncms.includes(n)) found.ncms.push(n);
    } else {
      items.set(key, { ...row, ncms: [...row.ncms] });
    }
  }
  const references = [...bySegment].map(([code, items]) => {
    const lines = [...items.values()].flatMap((i) => {
      const other = rangeOf(i.cest);
      const base = { cest: i.cest, ncms: i.ncms, ncmText: i.ncmText };
      return [
        {
          ...base,
          item: `${i.item}/1`,
          description: `${i.description} — destinatário optante pelo crédito outorgado (Anexo Único)`,
          mva: i.mva,
        },
        ...(other
          ? [
              {
                ...base,
                item: `${i.item}/2`,
                description: `${i.description} — demais destinatários (art. 2º-B, inciso ${other.inciso})`,
                mva: other.mva,
              },
            ]
          : []),
      ];
    });
    return {
      uf: 'MT',
      segment: code,
      segmentName: segmentName(code),
      act: 'Portaria 195/2019-SEFAZ/MT (consolidada), Anexo Único e art. 2º-B',
      source: 'stMtPortaria195',
      url,
      validFrom: '2020-01-01',
      validTo: null,
      note: 'Duas MVAs: a do Anexo Único vale para o destinatário optante pelo crédito outorgado do Anexo XVII do RICMS/MT (art. 1º); a do art. 2º-B vale para os demais. O atacadista que cumpre o art. 2º-A pode reduzir a MVA do Anexo Único em 50%. Vale a redação atual.',
      items: lines,
    };
  });
  const annexes = references.map((r) => ({
    annex: r.segment,
    name: r.segmentName,
    cests: [...new Map(r.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
      ncms.length > 0 ? { cest, ncms } : { cest },
    ),
  }));
  return {
    segment: {
      uf: 'MT',
      act: 'Portaria 195/2019-SEFAZ/MT, Anexo Único (consolidada pela SEFAZ-MT)',
      source: 'stMtPortaria195',
      url,
      annexes,
    },
    references,
  };
}
