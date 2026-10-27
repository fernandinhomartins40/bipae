import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createZip } from '../../common/zip';

/** Uma tabela pronta para exportar: títulos das colunas e as linhas já como texto. */
export interface ReportTable {
  title: string;
  subtitle: string;
  columns: { label: string; align?: 'right' }[];
  rows: string[][];
}

/**
 * Texto que o Excel leria como fórmula (um nome de cliente "=HYPERLINK(...)", por exemplo) ganha
 * uma aspa simples na frente (F7-02.c, injeção de CSV). Número, mesmo negativo ("-5,00" ou
 * "-R$ 3,00"), continua como está.
 */
export function neutralizeFormula(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (/^[-+]\s?(R\$\s?)?[\d.,]+%?$/.test(value)) return value;
  return `'${value}`;
}

/** CSV para o Excel brasileiro: separador ";", BOM UTF-8 e aspas quando preciso. */
export function toCsv(table: ReportTable): Buffer {
  const cell = (raw: string) => {
    const value = neutralizeFormula(raw);
    return /[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  const lines = [
    table.columns.map((c) => cell(c.label)),
    ...table.rows.map((r) => r.map(cell)),
  ].map((r) => r.join(';'));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

const xml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Coluna do Excel: 0 → A, 26 → AA. */
const columnName = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);

/** XLSX mínimo (uma planilha, textos em linha), sem dependência externa. */
export function toXlsx(table: ReportTable): Buffer {
  const all = [table.columns.map((c) => c.label), ...table.rows];
  const sheetRows = all
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (value, c) =>
              `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ];
  return createZip(files);
}

/** As fontes padrão do PDF (WinAnsi) não têm alguns caracteres; troca pelo mais próximo. */
const winAnsi = (text: string) =>
  text.replace(/[−–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** PDF em A4 deitado, com cabeçalho e as colunas distribuídas na largura. */
export async function toPdf(table: ReportTable): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 842;
  const height = 595;
  const margin = 36;
  const size = 9;
  const lineHeight = 14;
  const usable = width - margin * 2;
  // A primeira coluna (o nome) fica com mais espaço.
  const firstShare = table.columns.length > 1 ? 0.34 : 1;
  const colWidth = (i: number) =>
    i === 0 ? usable * firstShare : (usable * (1 - firstShare)) / (table.columns.length - 1);
  const xOf = (i: number) =>
    margin + Array.from({ length: i }, (_, k) => colWidth(k)).reduce((a, b) => a + b, 0);
  const fit = (text: string, w: number, f = font) => {
    let t = winAnsi(text);
    // Texto que não cabe na coluna é cortado e termina com ".".
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -2) + '.';
    return t;
  };
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const header = (first: boolean) => {
    if (first) {
      page.drawText(winAnsi(table.title), { x: margin, y, size: 14, font: bold });
      y -= 18;
      page.drawText(winAnsi(table.subtitle), {
        x: margin,
        y,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 20;
    }
    table.columns.forEach((c, i) => {
      const text = fit(c.label, colWidth(i), bold);
      const x =
        c.align === 'right'
          ? xOf(i) + colWidth(i) - bold.widthOfTextAtSize(text, size) - 3
          : xOf(i);
      page.drawText(text, { x, y, size, font: bold });
    });
    y -= 4;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5 });
    y -= lineHeight - 2;
  };
  header(true);
  for (const row of table.rows) {
    if (y < margin) {
      page = pdf.addPage([width, height]);
      y = height - margin;
      header(false);
    }
    row.forEach((value, i) => {
      const text = fit(value, colWidth(i));
      const x =
        table.columns[i]?.align === 'right'
          ? xOf(i) + colWidth(i) - font.widthOfTextAtSize(text, size) - 3
          : xOf(i);
      page.drawText(text, { x, y, size, font });
    });
    y -= lineHeight;
  }
  return Buffer.from(await pdf.save());
}
