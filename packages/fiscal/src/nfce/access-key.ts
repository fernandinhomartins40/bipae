/**
 * Chave de acesso da NF-e/NFC-e (44 dígitos): cUF, AAMM da emissão, CNPJ do emitente, modelo,
 * série, número, tipo de emissão, código numérico e o dígito verificador (módulo 11), conforme o
 * Manual de Orientação do Contribuinte.
 */
export interface AccessKeyParts {
  /** Código IBGE da UF do emitente (2 dígitos). */
  cUF: string;
  /** Ano e mês da emissão (AAMM). */
  yearMonth: string;
  /** CNPJ do emitente, só dígitos (ou alfanumérico, NT DFe Conjunta 2025). */
  cnpj: string;
  model: '55' | '65';
  series: number;
  number: number;
  /** Tipo de emissão: 1 normal, 9 contingência off-line da NFC-e. */
  emissionType: 1 | 9;
  /** Código numérico aleatório de 8 dígitos (cNF), que não pode repetir o número da nota. */
  numericCode: string;
}

/** Valor do caractere no cálculo do DV: dígitos valem eles mesmos; letras do CNPJ alfanumérico valem o código ASCII − 48. */
const charValue = (ch: string) => ch.charCodeAt(0) - 48;

export function accessKeyCheckDigit(key43: string): number {
  if (!/^[0-9A-Z]{43}$/.test(key43))
    throw new Error('A chave sem o dígito precisa ter 43 caracteres');
  let weight = 2;
  let sum = 0;
  for (let i = key43.length - 1; i >= 0; i--) {
    sum += charValue(key43[i]!) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function buildAccessKey(parts: AccessKeyParts): string {
  const pad = (value: number, size: number) => String(value).padStart(size, '0');
  if (!/^\d{2}$/.test(parts.cUF)) throw new Error('cUF inválido');
  if (!/^\d{4}$/.test(parts.yearMonth)) throw new Error('Ano e mês da emissão inválidos (AAMM)');
  if (!/^[0-9A-Z]{12}\d{2}$/.test(parts.cnpj)) throw new Error('CNPJ do emitente inválido');
  if (!Number.isInteger(parts.series) || parts.series < 0 || parts.series > 999)
    throw new Error('Série fora de 0 a 999');
  if (!Number.isInteger(parts.number) || parts.number < 1 || parts.number > 999_999_999)
    throw new Error('Número fora de 1 a 999.999.999');
  if (!/^\d{8}$/.test(parts.numericCode))
    throw new Error('Código numérico (cNF) precisa ter 8 dígitos');
  if (Number(parts.numericCode) === parts.number)
    throw new Error('O código numérico (cNF) não pode ser igual ao número da nota');
  const key43 =
    parts.cUF +
    parts.yearMonth +
    parts.cnpj +
    parts.model +
    pad(parts.series, 3) +
    pad(parts.number, 9) +
    parts.emissionType +
    parts.numericCode;
  return key43 + accessKeyCheckDigit(key43);
}
