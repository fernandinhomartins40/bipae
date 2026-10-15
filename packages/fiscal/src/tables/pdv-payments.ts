import data from './data/pdv-payment-tpag.json';
import { findPaymentMeans } from './payment-means';

/**
 * Forma de pagamento do caixa → código tPag da NFC-e (F3-14.a). Pix e vale têm mais de um código
 * possível na tabela oficial (dúvida D-029): o padrão vem daqui e a empresa pode escolher outro
 * entre as opções, sem inventar código fora da tabela.
 */
export interface PdvPaymentRule {
  code: string;
  options?: string[];
  doubt?: string;
}

export const PDV_PAYMENT_TPAG = data.methods as Record<string, PdvPaymentRule>;

export class PdvPaymentError extends Error {}

export function pdvPaymentCode(
  method: string,
  date: string,
  overrides: Partial<Record<string, string>> = {},
): string {
  const rule = PDV_PAYMENT_TPAG[method];
  if (!rule) throw new PdvPaymentError(`Forma de pagamento sem código na NFC-e: ${method}.`);
  const chosen = overrides[method];
  const code = chosen && (rule.options ?? [rule.code]).includes(chosen) ? chosen : rule.code;
  if (!findPaymentMeans(code, date)) {
    throw new PdvPaymentError(`O código ${code} de pagamento não vale em ${date}.`);
  }
  return code;
}
