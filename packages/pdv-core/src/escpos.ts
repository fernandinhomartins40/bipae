/**
 * ESC/POS encoding for thermal printers. Pure: produces bytes; the platform sends them
 * (desktop: serial/TCP; web: Bipaê Conector). Portuguese accents use code page PC860.
 */

const ESC = 0x1b;
const GS = 0x1d;

// PC860 (Portuguese) for the characters used in pt-BR receipts.
const PC860: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ã: 0x84,
  à: 0x85,
  Á: 0x86,
  ç: 0x87,
  ê: 0x88,
  Ê: 0x89,
  è: 0x8a,
  Í: 0x8b,
  Ô: 0x8c,
  ì: 0x8d,
  Ã: 0x8e,
  Â: 0x8f,
  É: 0x90,
  À: 0x91,
  È: 0x92,
  ô: 0x93,
  õ: 0x94,
  ò: 0x95,
  Ú: 0x96,
  ù: 0x97,
  Ì: 0x98,
  Õ: 0x99,
  Ü: 0x9a,
  Ó: 0x9f,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  ª: 0xa6,
  º: 0xa7,
};

export interface PrinterProfile {
  /** Characters per line: 48 for 80 mm paper, 32 for 58 mm. */
  columns: 32 | 42 | 48;
  /** Value for ESC t n selecting PC860 (3 on Epson-compatible printers; varies by brand). */
  codePage: number;
  cut: boolean;
}

export const DEFAULT_PRINTER: PrinterProfile = { columns: 48, codePage: 3, cut: true };

export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else if (char === '\n') bytes.push(0x0a);
    else if (PC860[char] !== undefined) bytes.push(PC860[char]!);
    else {
      // Fallback: strip the accent; anything else prints as "?".
      const plain = char.normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const p = plain.codePointAt(0) ?? 0x3f;
      bytes.push(p >= 0x20 && p < 0x7f ? p : 0x3f);
    }
  }
  return bytes;
}

export type ReceiptBlock =
  | {
      kind: 'text';
      text: string;
      align?: 'left' | 'center' | 'right';
      bold?: boolean;
      large?: boolean;
    }
  | { kind: 'feed'; lines: number }
  /**
   * QR Code impresso pela própria impressora (padrão residente, como pede o manual do DANFE
   * NFC-e). `moduleDots` é o lado de cada quadradinho em pontos (1 a 16).
   */
  | { kind: 'qrcode'; data: string; moduleDots: number };

export function encodeReceipt(
  blocks: ReceiptBlock[],
  profile: PrinterProfile = DEFAULT_PRINTER,
): Uint8Array {
  const out: number[] = [ESC, 0x40, ESC, 0x74, profile.codePage];
  for (const block of blocks) {
    if (block.kind === 'feed') {
      out.push(ESC, 0x64, block.lines);
      continue;
    }
    if (block.kind === 'qrcode') {
      out.push(ESC, 0x61, 1, ...encodeQrCode(block.data, block.moduleDots));
      continue;
    }
    out.push(ESC, 0x61, block.align === 'center' ? 1 : block.align === 'right' ? 2 : 0);
    out.push(ESC, 0x45, block.bold ? 1 : 0);
    out.push(GS, 0x21, block.large ? 0x11 : 0x00);
    out.push(...encodeText(block.text), 0x0a);
  }
  out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  if (profile.cut) out.push(ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}

/**
 * Comandos GS ( k do QR Code (modelo 2, correção de erro nível M): define o tamanho do
 * quadradinho, guarda os dados e imprime. Os dados vão em ASCII, que é o que a URL do QR Code
 * da NFC-e contém.
 */
export function encodeQrCode(data: string, moduleDots: number): number[] {
  if (!Number.isInteger(moduleDots) || moduleDots < 1 || moduleDots > 16) {
    throw new Error('Tamanho do QR Code inválido: use de 1 a 16 pontos por quadradinho.');
  }
  const bytes = [...data].map((char) => {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e) {
      throw new Error('O QR Code da impressora aceita só texto ASCII.');
    }
    return code;
  });
  const length = bytes.length + 3;
  if (length > 0xffff) throw new Error('Conteúdo grande demais para o QR Code.');
  const qr = (...fn: number[]) => [GS, 0x28, 0x6b, ...fn];
  return [
    ...qr(4, 0, 0x31, 0x41, 0x32, 0x00), // modelo 2
    ...qr(3, 0, 0x31, 0x43, moduleDots), // tamanho do quadradinho
    ...qr(3, 0, 0x31, 0x45, 0x31), // correção de erro nível M
    ...qr(length & 0xff, length >> 8, 0x31, 0x50, 0x30, ...bytes), // guarda os dados
    ...qr(3, 0, 0x31, 0x51, 0x30), // imprime
    0x0a,
  ];
}

/** Cash drawer kick through the printer (pin 2, ~50 ms on / 500 ms off). */
export const DRAWER_PULSE = Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xfa]);

/** Plain text rendering of the same blocks (browser printing and previews). */
export function receiptToText(blocks: ReceiptBlock[], columns: number): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'feed') {
      for (let i = 0; i < block.lines; i++) lines.push('');
      continue;
    }
    if (block.kind === 'qrcode') {
      // Texto puro não desenha o QR Code: a tela e o navegador usam receiptToHtml.
      const label = '[QR Code]';
      lines.push(' '.repeat(Math.max(0, Math.floor((columns - label.length) / 2))) + label);
      continue;
    }
    for (const raw of block.text.split('\n')) {
      const text = raw.slice(0, columns);
      const pad = columns - text.length;
      lines.push(
        block.align === 'center'
          ? ' '.repeat(Math.floor(pad / 2)) + text
          : block.align === 'right'
            ? ' '.repeat(pad) + text
            : text,
      );
    }
  }
  return lines;
}
