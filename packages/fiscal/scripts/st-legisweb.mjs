// Leitor comum dos textos de norma do LegisWeb (www.legisweb.com.br), usado para a ST do Tocantins
// e do Amapá (F3-26.d.TO e F3-26.d.AP). O dono aprovou o LegisWeb como fonte de texto de norma
// quando o site da SEFAZ não abre (27/10/2026); é cópia de terceiros, então tudo o que sai daqui é
// conferido contra a tabela de CEST do Convênio ICMS 142/18, e o que não fecha vai para a lista de
// pendências em vez de virar suposição.

const entities = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', apos: "'" };

const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m);

/**
 * O LegisWeb mistura UTF-8 e Windows-1252 na mesma página (as versões antigas da norma vieram de
 * outra origem): cada linha é lida como UTF-8 e, se não for válida, como Windows-1252.
 */
export function legisWebHtml(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const ansi = new TextDecoder('windows-1252');
  const lines = [];
  let start = 0;
  for (let i = 0; i <= buffer.length; i++) {
    if (i < buffer.length && buffer[i] !== 0x0a) continue;
    const bytes = buffer.subarray(start, i);
    try {
      lines.push(utf8.decode(bytes));
    } catch {
      lines.push(ansi.decode(bytes));
    }
    start = i + 1;
  }
  return lines.join('\n');
}

const clean = (html) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/**
 * As tabelas do texto da norma, na ordem. `pre` é o texto solto entre a tabela anterior e esta
 * (títulos e notas de alteração); cada célula traz o texto e o `colspan`.
 */
export function legisWebTables(html) {
  const start = html.indexOf('name="ini-legis"');
  if (start < 0) throw new Error('LegisWeb: não achei o início do texto da norma');
  const body = html.slice(start);
  const tables = [];
  let last = 0;
  for (const m of body.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
      [...r[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => ({
        text: clean(c[2]),
        span: Number(/colspan="?(\d+)/i.exec(c[1])?.[1] ?? 1),
      })),
    );
    tables.push({ pre: clean(body.slice(last, m.index)), rows });
    last = m.index + m[0].length;
  }
  return tables;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d, m, y) => `${y.length === 2 ? `20${y}` : y}-${pad(m)}-${pad(d)}`;

/**
 * Notas de alteração entre parênteses ("Redação do item dada pelo Decreto Nº 3762 DE 18/03/2025,
 * efeitos a partir de 01/05/2025", "Revogado pelo Decreto ..."). Devolve o tipo, o decreto, a data
 * dele e a data de efeitos quando o texto traz uma.
 */
export function legisWebNotes(text) {
  const notes = [];
  for (const m of text.matchAll(/\(([^()]*(?:Decreto|Efeitos)[^()]*)\)/g)) {
    const body = m[1];
    const decree = /Decreto\s+N\S{0,3}\s*([\d.]+)\s+DE\s+(\d\d)\/(\d\d)\/(\d{4})/i.exec(body);
    if (!decree) continue;
    const effect = /efeitos\s+(?:a\s+partir\s+)?de\s+(\d\d)\/(\d\d)\/(\d{4})/i.exec(body);
    notes.push({
      kind: /^\s*Revogad/i.test(body)
        ? 'revogado'
        : /^\s*Exclu[ií]d/i.test(body)
          ? 'excluido'
          : 'redacao',
      decree: `Decreto ${decree[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}/${decree[4]}`,
      decreeDate: iso(decree[2], decree[3], decree[4]),
      effectDate: effect ? iso(effect[1], effect[2], effect[3]) : null,
      text: body,
    });
  }
  return notes;
}

/** Texto sem as notas de alteração entre parênteses. */
export const withoutNotes = (text) =>
  text
    .replace(/\([^()]*(?:Decreto|Efeitos)[^()]*\)\s*:?/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim();

/** Data de um texto ("a partir de 01.10.16", "até 30.09. 2016"), ou null. */
export function legisWebDescriptionDates(description) {
  const date = (re) => {
    const m = re.exec(description);
    return m ? iso(m[1], m[2], m[3]) : null;
  };
  return {
    from: date(/(?:efeitos|vig[êe]ncia)\s+a\s+partir\s+de\s+(\d\d)[./]\s*(\d\d)[./]\s*(\d{2,4})/i),
    until: date(/vig[êe]ncia\s+at[ée]\s+(\d\d)[./]\s*(\d\d)[./]\s*(\d{2,4})/i),
  };
}

/** "71,78%" -> "71.78"; "100,00 %" -> "100". */
export const percent = (text) =>
  text
    .replace(/\s?%$/, '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');

export const isPercent = (text) => /^\d{1,3}(?:,\d{1,4})?\s?%$/.test(text.trim());

/**
 * NCM de uma célula: "3815.12.10 | 3815.12.90", "Capítulos 13 e 15 a 23". Devolve as posições sem
 * pontos e o que não deu para ler (por exemplo, "204" sem o zero da posição, que não se corrige
 * à mão).
 */
export function legisWebNcms(text) {
  const chapters = /^Cap[ií]tulos?\s+(.+)$/i.exec(text);
  if (chapters) {
    const out = [];
    for (const m of chapters[1].matchAll(/(\d{1,2})(?:\s+a\s+(\d{1,2}))?/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let c = from; c <= to; c++) out.push(pad(c));
    }
    return { ncms: out, invalid: [] };
  }
  const ncms = [];
  const invalid = [];
  for (const raw of text.split(/[\s|,;]+/).filter(Boolean)) {
    const token = raw.replace(/[.,;]+$/, '');
    // "1101.0010" é o 1101.00.10 sem um ponto: os oito dígitos são os mesmos.
    if (/^\d{2}(?:\.\d{2}){0,3}$|^\d{4}(?:\.\d{1,2}){0,2}$|^\d{4}\.\d{4}$/.test(token)) {
      ncms.push(token.replace(/\./g, ''));
      continue;
    }
    // Dois códigos colados ("1602.311602.32").
    const glued = [...token.matchAll(/(\d{4})\.(\d{1,2})(?:\.(\d{1,2}))?(?=\d{4}\.|$)/g)];
    if (glued.length > 1 && glued.map((g) => g[0]).join('') === token) {
      for (const g of glued) ncms.push(g[0].replace(/\./g, ''));
    } else {
      invalid.push(raw);
    }
  }
  return { ncms: [...new Set(ncms)], invalid };
}

const CEST = /^(\d{2})\.(\d{3})\.(\d{2})$/;
export const cestOf = (text) => {
  const m = CEST.exec(text.trim());
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
};

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');
export { sentence };

const maxDate = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;
export { maxDate };

/**
 * Seções lidas (já com as linhas em vigor, as revogadas e as pendências) no formato de
 * st-references.json: uma referência por seção, segmento (dois primeiros dígitos do CEST) e data de
 * início, para a vigência valer por linha, e a lista de CEST de cada seção com o que saiu da ST.
 */
export function legisWebStReferences(
  sections,
  { uf, act, source, url, segmentName, note, annexNote },
) {
  const references = [];
  for (const s of sections) {
    const groups = new Map();
    for (const i of s.items) {
      if (i.mva == null || i.ncms.length === 0) continue;
      const key = `${i.cest.slice(0, 2)}|${i.validFrom}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const [key, items] of groups) {
      const [segment, validFrom] = key.split('|');
      references.push({
        uf,
        segment,
        segmentName: segmentName(segment) ?? s.name,
        act: `${act}, ${s.label}`,
        source,
        url,
        validFrom,
        validTo: null,
        note: [note, annexNote?.(s)].filter(Boolean).join(' '),
        items: items.map(({ item, cest, ncms, description, mva }) => ({
          item,
          cest,
          ncms,
          description,
          mva,
        })),
      });
    }
  }
  const segment = {
    uf,
    act,
    source,
    url,
    annexes: sections
      .map((s) => {
        const cests = new Map();
        for (const i of s.items) {
          if (!cests.has(i.cest)) {
            cests.set(i.cest, { cest: i.cest, ...(i.ncms.length > 0 && { ncms: i.ncms }) });
          }
        }
        for (const r of s.revoked) {
          if (!cests.has(r.cest)) {
            cests.set(r.cest, {
              cest: r.cest,
              ...(r.ncms?.length > 0 && { ncms: r.ncms }),
              excludedFrom: r.from,
              excludedBy: r.by,
            });
          }
        }
        return { annex: s.annex, name: s.name, cests: [...cests.values()] };
      })
      .filter((a) => a.cests.length > 0),
  };
  return { segment, references };
}
