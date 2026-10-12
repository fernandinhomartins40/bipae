/**
 * Monetary values are integer cents (ADR-0008). Never use floating point for money.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Valor monetário inválido (esperado inteiro em centavos): ${value}`);
  }
  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce<number>((sum, v) => sum + v, 0));
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formats cents as BRL, e.g. 123456 -> "R$ 1.234,56". UI boundary only. */
export function formatBRL(value: Cents): string {
  // Integer division keeps formatting exact for any safe integer.
  return brl.format(value / 100).replace(/ /g, ' ');
}

/**
 * Parses user input in Brazilian notation into cents.
 * Accepts "1.234,56", "1234,5", "R$ 10", "10.5" (dot as decimal when it is the only separator
 * followed by 1–2 digits). Returns null for anything ambiguous or invalid.
 */
export function parseBRL(input: string): Cents | null {
  const raw = input.replace(/R\$|\s/g, '');
  if (raw === '') return null;
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;

  let integerPart: string;
  let fractionPart = '';
  if (body.includes(',')) {
    const [int, frac, ...rest] = body.split(',');
    if (rest.length > 0 || int === undefined) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(int)) return null;
    integerPart = int.replace(/\./g, '');
    fractionPart = frac ?? '';
  } else if (/^\d+\.\d{1,2}$/.test(body)) {
    [integerPart = '', fractionPart = ''] = body.split('.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    integerPart = body.replace(/\./g, '');
  } else if (/^\d+$/.test(body)) {
    integerPart = body;
  } else {
    return null;
  }

  if (!/^\d{0,2}$/.test(fractionPart)) return null;
  const value = Number(integerPart) * 100 + Number(fractionPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return cents(negative ? -value : value);
}
