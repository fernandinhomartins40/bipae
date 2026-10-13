import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';
import {
  A4,
  layoutDanfeNfe,
  type DanfeLayoutOptions,
  type DanfePage,
  type Measure,
} from './layout';
import { readNfe, type DanfeNfe } from './nfe-data';

/**
 * Converte as folhas do leiaute em PDF. As fontes são as Times padrão do PDF (o item 3.7 do
 * manual pede Times New Roman ou Courier New), sem arquivo de fonte embutido.
 */

// Caracteres da codificação WinAnsi das fontes padrão além do Latin-1.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Troca o que a fonte padrão não desenha: tira o acento ou usa "?". */
export function winAnsi(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(char)
    ) {
      out += char;
      continue;
    }
    const plain = char.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    out += plain.length === 1 && plain.codePointAt(0)! < 0x7f ? plain : '?';
  }
  return out;
}

export interface DanfeFonts {
  regular: PDFFont;
  bold: PDFFont;
}

export function measureWith(fonts: DanfeFonts): Measure {
  return (text, size, bold) =>
    (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(winAnsi(text), size);
}

export async function createDanfeDocument(): Promise<{ doc: PDFDocument; fonts: DanfeFonts }> {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  return { doc, fonts };
}

function drawPage(doc: PDFDocument, fonts: DanfeFonts, page: DanfePage) {
  const pdfPage = doc.addPage([A4.width, A4.height]);
  const flip = (y: number) => A4.height - y;
  const black = rgb(0, 0, 0);
  for (const op of page.ops) {
    switch (op.kind) {
      case 'watermark': {
        const font = fonts.bold;
        const size = 70;
        const width = font.widthOfTextAtSize(op.text, size);
        pdfPage.drawText(winAnsi(op.text), {
          x: A4.width / 2 - (width / 2) * Math.cos(Math.PI / 4),
          y: A4.height / 2 - (width / 2) * Math.sin(Math.PI / 4),
          size,
          font,
          color: rgb(0.85, 0.85, 0.85),
          rotate: degrees(45),
          opacity: 0.6,
        });
        break;
      }
      case 'rect':
        pdfPage.drawRectangle({
          x: op.x,
          y: flip(op.y + op.h),
          width: op.w,
          height: op.h,
          borderColor: black,
          borderWidth: 0.5,
          ...(op.fill && { color: rgb(0.92, 0.92, 0.92) }),
        });
        break;
      case 'line':
        pdfPage.drawLine({
          start: { x: op.x1, y: flip(op.y1) },
          end: { x: op.x2, y: flip(op.y2) },
          thickness: 0.4,
          color: black,
          ...(op.dashed && { dashArray: [2, 2] }),
        });
        break;
      case 'bars': {
        let x = op.x;
        op.widths.forEach((modules, i) => {
          const width = modules * op.module;
          // Elementos pares são barras; ímpares, espaços.
          if (i % 2 === 0)
            pdfPage.drawRectangle({ x, y: flip(op.y + op.h), width, height: op.h, color: black });
          x += width;
        });
        break;
      }
      case 'text': {
        const font = op.bold ? fonts.bold : fonts.regular;
        const text = winAnsi(op.text);
        const width = font.widthOfTextAtSize(text, op.size);
        const x =
          op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x;
        pdfPage.drawText(text, { x, y: flip(op.y), size: op.size, font, color: black });
        break;
      }
    }
  }
}

/** PDF do DANFE a partir do XML autorizado (nfeProc) ou, com `preview`, do XML da nota. */
export async function renderDanfeNfe(
  xmlOrData: string | DanfeNfe,
  options: DanfeLayoutOptions = {},
): Promise<Uint8Array> {
  const nfe = typeof xmlOrData === 'string' ? readNfe(xmlOrData) : xmlOrData;
  const { doc, fonts } = await createDanfeDocument();
  const pages = layoutDanfeNfe(nfe, measureWith(fonts), options);
  doc.setTitle(`DANFE NF-e ${nfe.number} série ${nfe.series}`);
  doc.setSubject(`Chave de acesso ${nfe.accessKey}`);
  doc.setProducer('Bipaê');
  doc.setCreator('Bipaê');
  // Data fixa a partir da emissão: o mesmo XML gera sempre o mesmo PDF.
  const issued = new Date(nfe.issuedAt);
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  for (const page of pages) drawPage(doc, fonts, page);
  return doc.save();
}
