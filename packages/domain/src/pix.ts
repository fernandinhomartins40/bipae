import { isValidCnpj, isValidCpf } from './documents';

/**
 * Pix com QR Code estático (F8-08, ADR-0018): o "copia e cola" do BR Code montado aqui mesmo,
 * a partir da chave Pix da loja e do valor da venda, pelo Manual de Padrões para Iniciação do
 * Pix do Banco Central (EMV QRCPS-MPM). Não fala com banco nenhum: o cliente paga em qualquer
 * banco e o operador confirma o recebimento. A confirmação automática vem pela API Pix (F8-09).
 */

export type PixKeyKind = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

/** Normaliza a chave como o Pix espera; nulo quando não é uma chave válida. */
export function normalizePixKey(input: string): { kind: PixKeyKind; key: string } | null {
  const text = input.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    return { kind: 'random', key: text.toLowerCase() };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length <= 77) {
    return { kind: 'email', key: text.toLowerCase() };
  }
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    return /^55\d{10,11}$/.test(digits) ? { kind: 'phone', key: `+${digits}` } : null;
  }
  if (/^\d{11}$/.test(digits) && /[.-]/.test(text) === false && /^\d+$/.test(text)) {
    // Só números com 11 dígitos: CPF se o dígito confere, senão celular sem o +55.
    if (isValidCpf(digits)) return { kind: 'cpf', key: digits };
    return { kind: 'phone', key: `+55${digits}` };
  }
  if (/^\d{11}$/.test(digits) && isValidCpf(digits)) return { kind: 'cpf', key: digits };
  if (/^\d{14}$/.test(digits) && isValidCnpj(digits)) return { kind: 'cnpj', key: digits };
  if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(text)) return { kind: 'phone', key: `+55${digits}` };
  return null;
}

/** Campo EMV: ID, tamanho com dois dígitos e o valor. */
const field = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

/** Sem acento e só caracteres que todo app de banco lê. */
const plain = (text: string, max: number) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9 .,\-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como pede o BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface StaticPixInput {
  key: string;
  merchantName: string;
  city: string;
  /** Sem valor, o cliente digita (QR da loja); com valor, já vem preenchido. */
  amountCents?: number | null;
  /** Identificador da cobrança (até 25 letras e números); sem ele vale "***". */
  txid?: string | null;
}

/** O "copia e cola" do Pix (BR Code estático). Quem vira imagem é o QR da tela. */
export function staticPixPayload(input: StaticPixInput): string {
  const key = normalizePixKey(input.key);
  if (!key) throw new Error('Chave Pix inválida. Confira em Meios de pagamento.');
  const name = plain(input.merchantName, 25);
  const city = plain(input.city, 15);
  if (!name || !city) throw new Error('Informe o nome e a cidade que aparecem no Pix.');
  const txid = (input.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const account = field('00', 'br.gov.bcb.pix') + field('01', key.key);
  const amount =
    input.amountCents && input.amountCents > 0
      ? field('54', (input.amountCents / 100).toFixed(2))
      : '';
  const body =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    amount +
    field('58', 'BR') +
    field('59', name) +
    field('60', city) +
    field('62', field('05', txid)) +
    '6304';
  return body + crc16(body);
}
