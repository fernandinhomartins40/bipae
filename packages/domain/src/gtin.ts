/** GTIN-8/12/13/14 check digit (GS1 mod 10). */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error('GTIN deve conter apenas dígitos');
  let sum = 0;
  // Weights alternate 3,1 starting from the rightmost digit of the body.
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(value: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  return gtinCheckDigit(value.slice(0, -1)) === Number(value.at(-1));
}

/** Builds a full GTIN by appending the check digit. */
export function completeGtin(body: string): string {
  return body + String(gtinCheckDigit(body));
}

/**
 * Internal (in-store) codes such as weighable labels start with "2" and are valid
 * barcodes but not registered GTINs. The fiscal layout requires "SEM GTIN" for them.
 */
export function isInStoreCode(value: string): boolean {
  return value.length === 13 && value.startsWith('2');
}
