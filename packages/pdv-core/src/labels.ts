import { completeGtin, isValidGtin } from '@bipae/domain';
import { DEFAULT_SCALE_LABEL, type ScaleLabelLayout } from './scan';

/**
 * Etiquetas de gôndola e de balança (F5-01): o código da etiqueta de balança (o inverso de
 * `parseScan`) e as barras EAN-13 e EAN-8 pela especificação pública da GS1.
 */

/** Códigos dos dígitos: L (ímpar), G (par) e R, em módulos (1 = barra, 0 = espaço). */
// prettier-ignore
export const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
// prettier-ignore
export const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
// prettier-ignore
export const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** O primeiro dígito do EAN-13 não vira barra: ele escolhe L ou G para os seis seguintes. */
// prettier-ignore
export const EAN13_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

const GUARD = '101';
const CENTER = '01010';

/**
 * Módulos do código (95 no EAN-13, 67 no EAN-8). UPC-A (12 dígitos) sai como EAN-13 com zero
 * na frente. Devolve null quando o código não é um GTIN válido que dê para imprimir em barras.
 */
export function eanModules(code: string): string | null {
  const digits = code.length === 12 ? `0${code}` : code;
  if (!isValidGtin(digits)) return null;
  const d = [...digits].map(Number);
  if (d.length === 13) {
    const parity = EAN13_PARITY[d[0]!]!;
    const left = d
      .slice(1, 7)
      .map((n, i) => (parity[i] === 'L' ? EAN_L : EAN_G)[n])
      .join('');
    const right = d
      .slice(7)
      .map((n) => EAN_R[n])
      .join('');
    return GUARD + left + CENTER + right + GUARD;
  }
  if (d.length === 8) {
    const left = d
      .slice(0, 4)
      .map((n) => EAN_L[n])
      .join('');
    const right = d
      .slice(4)
      .map((n) => EAN_R[n])
      .join('');
    return GUARD + left + CENTER + right + GUARD;
  }
  return null;
}

/**
 * Código EAN-13 da etiqueta de balança: prefixo, PLU (o código interno do produto) e o valor
 * (total em centavos ou peso em gramas, conforme o layout), mais o dígito verificador.
 */
export function buildScaleLabelCode(
  input: { plu: string; totalCents?: number; grams?: number },
  layout: ScaleLabelLayout = DEFAULT_SCALE_LABEL,
): string {
  const plu = input.plu.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(plu) || plu.length > layout.pluLength) {
    throw new Error(
      `O código interno precisa ter só números, até ${layout.pluLength} dígitos, para ir na etiqueta da balança.`,
    );
  }
  const value = layout.valueKind === 'price' ? input.totalCents : input.grams;
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error('Valor da etiqueta inválido.');
  }
  const text = String(value);
  if (text.length > layout.valueLength) {
    throw new Error(
      layout.valueKind === 'price'
        ? 'O total passa do que cabe na etiqueta da balança.'
        : 'O peso passa do que cabe na etiqueta da balança.',
    );
  }
  const body = Array.from({ length: 12 }, () => '0');
  const put = (start: number, s: string) => [...s].forEach((c, i) => (body[start + i] = c));
  put(0, layout.prefix);
  put(layout.pluStart, plu.padStart(layout.pluLength, '0'));
  put(layout.valueStart, text.padStart(layout.valueLength, '0'));
  return completeGtin(body.join(''));
}

/** Total do item pesado: peso (g) × preço do quilo, meio para cima, em inteiros. */
export function weighedTotalCents(grams: number, pricePerKgCents: number): number {
  return Math.floor((grams * pricePerKgCents + 500) / 1000);
}
