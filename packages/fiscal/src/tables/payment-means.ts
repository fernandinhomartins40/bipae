import { isValidOn } from '../validity';
import data from './data/payment-means.json';

/** Tabela oficial de meios de pagamento (tPag) da NF-e/NFC-e (TABLE_SOURCES.paymentMeans). */
export interface PaymentMeans {
  code: string;
  description: string;
  start: string;
  end?: string;
}

export const PAYMENT_MEANS: readonly PaymentMeans[] = data;

/** O meio de pagamento em vigor na data; null se o código não existe ou não vale. */
export function findPaymentMeans(code: string, date: string): PaymentMeans | null {
  const item = PAYMENT_MEANS.find((means) => means.code === code);
  if (!item) return null;
  return isValidOn({ start: item.start, ...(item.end !== undefined && { end: item.end }) }, date) ? item : null;
}
