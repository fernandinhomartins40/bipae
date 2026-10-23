// Leitor mínimo de .xlsx (zip + XML), sem dependências. Devolve as planilhas como linhas de texto.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** Lê as entradas de um zip pelo diretório central. */
export function unzip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Arquivo não é um zip');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Diretório do zip corrompido');
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart =
      local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/_x000D_/g, '');

const textOf = (xml) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

const column = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Devolve [{ name, rows: string[][] }] com o valor bruto de cada célula. */
export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const get = (name) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1]),
  );
  const rels = new Map(
    [...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])[1],
      /Target="([^"]+)"/.exec(m[0])[1],
    ]),
  );
  const sheets = [];
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]);
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])[1]);
    const xml = get(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const rows = [];
    for (const row of xml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cell[1])[1];
        const type = /t="([^"]+)"/.exec(cell[1])?.[1];
        const body = cell[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (v !== undefined) value = decode(v);
        cells[column(ref)] = value;
      }
      rows.push(Array.from(cells, (c) => c ?? ''));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// Uso direto: node xlsx.mjs arquivo.xlsx [linhas]
if (process.argv[1]?.endsWith('xlsx.mjs') && process.argv[2]) {
  const limit = Number(process.argv[3] ?? 6);
  for (const sheet of readXlsx(process.argv[2])) {
    console.log(`\n## planilha "${sheet.name}" (${sheet.rows.length} linhas)`);
    for (const row of sheet.rows.slice(0, limit))
      console.log(JSON.stringify(row.map((c) => String(c).slice(0, 70))));
  }
}
