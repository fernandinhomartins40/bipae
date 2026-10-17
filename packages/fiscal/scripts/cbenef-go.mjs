// Extrai, do Anexo Único da Instrução Normativa 1.518/2022-GSE de Goiás (texto consolidado no
// portal de legislação da Secretaria da Economia), cada código de cBenef com os CST, a descrição e
// o dispositivo legal (F3-27.b.GO). O texto traz a linha antiga, a nota "Redação com vigência de
// ... a ..." e a linha nova (ou "REVOGADO"): vale a última. Nada é digitado à mão.

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

/** "21.06.23" → "2023-06-21" */
const isoFromGo = (t) => {
  const m = /(\d{2})\.(\d{2})\.(\d{2,4})/.exec(t);
  return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}` : null;
};

/** @param html IN_1518_2022.htm (Windows-1252, lido como latin1) */
export function parseCbenefGo(html) {
  let header = null;
  let note = null;
  const byCode = new Map();
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
    if (cells[0] === 'CÓDIGO') {
      header = cells;
      continue;
    }
    if (cells.length === 1 && /vig[êe]ncia/i.test(cells[0])) {
      note = cells[0];
      continue;
    }
    if (!header || !/^GO\d{6}$/.test(cells[0] ?? '')) continue;
    const code = cells[0];
    if (/^REVOGAD/i.test(cells[1] ?? '')) {
      // "Redação com vigência de 01.01.23 a 21.06.23 REVOGA...": o código vale até a segunda data.
      const dates = note
        ? [...note.matchAll(/\d{2}\.\d{2}\.\d{2,4}/g)].map((d) => isoFromGo(d[0]))
        : [];
      const prev = byCode.get(code);
      byCode.set(code, {
        ...(prev ?? { code, csts: [], description: '' }),
        to: dates[1] ?? dates[0] ?? null,
      });
      note = null;
      continue;
    }
    const csts = header
      .map((h, i) => [/^CST (\d{2})$/.exec(h)?.[1], i])
      .filter(([cst, i]) => cst && (cells[i] ?? '').toUpperCase() === 'SIM')
      .map(([cst]) => cst);
    const legal = header.findIndex((h) => /^DISPOSITIVO LEGAL$|^DESCRIÇÃO$/.test(h));
    const readable = header.findIndex((h) => /^DESCRIÇÃO (NOS DOCUMENTOS|PARA NFA)/.test(h));
    const text = [cells[readable], cells[legal] ? `(${cells[legal]})` : '']
      .filter(Boolean)
      .join(' ');
    // A última redação vence (a antiga vem antes da nota de vigência).
    byCode.set(code, {
      code,
      csts,
      from: null,
      to: null,
      description: text.replace(/\s+/g, ' ').trim(),
    });
    note = null;
  }
  const codes = [...byCode.values()].map((c) => ({ from: null, ...c }));
  if (codes.length < 250)
    throw new Error(`Esperava a tabela cBenef de GO inteira; achei ${codes.length} códigos`);
  return codes;
}
