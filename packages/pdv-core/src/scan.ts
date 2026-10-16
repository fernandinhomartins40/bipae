import { isValidGtin } from '@bipae/domain';

/**
 * Interprets what the scanner (or the operator) typed in the register's input.
 *
 * In-store scale labels are EAN-13 starting with "2": a PLU and an embedded weight or price.
 * Layouts vary by scale and store, so the layout is configuration (defaults to the common
 * Brazilian "2 PPPPP VVVVVV D" with the total price in cents).
 */
export interface ScaleLabelLayout {
  prefix: string;
  pluStart: number;
  pluLength: number;
  valueStart: number;
  valueLength: number;
  /** 'price': value is the total in cents; 'weight': value is grams. */
  valueKind: 'price' | 'weight';
}

export const DEFAULT_SCALE_LABEL: ScaleLabelLayout = {
  prefix: '2',
  pluStart: 1,
  pluLength: 5,
  valueStart: 6,
  valueLength: 6,
  valueKind: 'price',
};

export type ScanResult =
  | { kind: 'barcode'; code: string; quantityMilli: number }
  | { kind: 'scale-label'; plu: string; quantityMilli?: number; totalCents?: number }
  | { kind: 'search'; text: string; quantityMilli: number };

/**
 * "3*7891000315507" or "3x arroz" multiplies quantity (the classic register shortcut).
 * Decimal quantities ("0,5*...") are allowed for weighed items.
 */
export function parseScan(
  input: string,
  layout: ScaleLabelLayout = DEFAULT_SCALE_LABEL,
): ScanResult | null {
  const text = input.trim();
  if (!text) return null;
  let quantityMilli = 1000;
  let rest = text;
  const multiplier = /^(\d+(?:[.,]\d{1,3})?)\s*[*xX]\s*(.+)$/.exec(text);
  if (multiplier) {
    quantityMilli = Math.round(Number(multiplier[1]!.replace(',', '.')) * 1000);
    rest = multiplier[2]!.trim();
    if (quantityMilli <= 0) return null;
  }

  if (/^\d{8,14}$/.test(rest)) {
    if (rest.length === 13 && rest.startsWith(layout.prefix) && isValidGtin(rest)) {
      const plu = String(Number(rest.slice(layout.pluStart, layout.pluStart + layout.pluLength)));
      const value = Number(rest.slice(layout.valueStart, layout.valueStart + layout.valueLength));
      return layout.valueKind === 'price'
        ? { kind: 'scale-label', plu, totalCents: value }
        : { kind: 'scale-label', plu, quantityMilli: value };
    }
    return { kind: 'barcode', code: rest, quantityMilli };
  }
  return { kind: 'search', text: rest, quantityMilli };
}

/** For a price label: quantity = total ÷ unit price, in thousandths (rounded). */
export function quantityFromLabelPrice(totalCents: number, unitPriceCents: number): number {
  if (unitPriceCents <= 0) throw new Error('Preço por quilo inválido');
  return Math.round((totalCents * 1000) / unitPriceCents);
}
