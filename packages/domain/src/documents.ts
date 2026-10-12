/**
 * CPF and CNPJ validation and masking.
 *
 * CNPJ supports the alphanumeric format (IN RFB nº 2.229/2024, in force from July 2026):
 * 12 alphanumeric characters (A–Z, 0–9) followed by 2 numeric check digits. Each character
 * is valued as its ASCII code minus 48, which keeps the classic numeric CNPJ computation intact.
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Removes mask characters and upper-cases (CNPJ may contain letters). */
export function normalizeTaxId(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

function allSameChar(value: string): boolean {
  return /^(.)\1*$/.test(value);
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || allSameChar(cpf)) return false;
  const digits = cpf.split('').map(Number);
  for (const position of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += digits[i]! * (position + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== digits[position]) return false;
  }
  return true;
}

function cnpjCharValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

function cnpjCheckDigit(base: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += cnpjCharValue(base[i]!) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Computes the two check digits for a 12-character CNPJ base. */
export function cnpjCheckDigits(base12: string): string {
  const base = normalizeTaxId(base12);
  if (!/^[0-9A-Z]{12}$/.test(base)) throw new Error('Base de CNPJ deve ter 12 caracteres');
  const first = cnpjCheckDigit(base);
  const second = cnpjCheckDigit(base + String(first));
  return `${first}${second}`;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeTaxId(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || allSameChar(cnpj)) return false;
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
}

/** Computes the two check digits for a 9-digit CPF base. */
export function cpfCheckDigits(base9: string): string {
  const base = onlyDigits(base9);
  if (base.length !== 9) throw new Error('Base de CPF deve ter 9 dígitos');
  const digits = base.split('').map(Number);
  for (const position of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += digits[i]! * (position + 1 - i);
    digits.push(((sum * 10) % 11) % 10);
  }
  return digits.slice(9).join('');
}

export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function formatCnpj(value: string): string {
  const c = normalizeTaxId(value).slice(0, 14);
  return c
    .replace(/^(\w{2})(\w)/, '$1.$2')
    .replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3')
    .replace(/\.(\w{3})(\w)/, '.$1/$2')
    .replace(/(\w{4})(\d{1,2})$/, '$1-$2');
}

export type TaxIdKind = 'cpf' | 'cnpj';

/** Detects and validates a CPF or CNPJ. Returns null when invalid. */
export function parseTaxId(value: string): { kind: TaxIdKind; value: string } | null {
  const normalized = normalizeTaxId(value);
  if (normalized.length === 11 && isValidCpf(normalized)) return { kind: 'cpf', value: normalized };
  if (normalized.length === 14 && isValidCnpj(normalized))
    return { kind: 'cnpj', value: normalized };
  return null;
}

export function formatTaxId(value: string): string {
  const normalized = normalizeTaxId(value);
  return normalized.length <= 11 && /^\d*$/.test(normalized)
    ? formatCpf(normalized)
    : formatCnpj(normalized);
}
