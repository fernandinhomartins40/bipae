/**
 * Pure register math only (no local database, no peripherals): cart, payments, cash
 * session, receipt and scan parsing. Used by the embeddable PDV kit (kits/pdv-embed).
 */
export * from './cart';
export * from './payments';
export * from './cash';
export * from './receipt';
export * from './scan';
export * from './labels';
export { receiptToText, type ReceiptBlock } from './escpos';
