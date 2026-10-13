/** Payment methods (no zod here: the embeddable PDV kit imports this without the schemas). */
export const PAYMENT_METHODS = [
  'cash',
  'pix',
  'credit',
  'debit',
  'voucher',
  'store_credit',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
  voucher: 'Vale-refeição/alimentação',
  store_credit: 'Crediário',
};
