import { formatBRL, formatTaxId, PAYMENT_LABELS, type Cents, type SaleItem, type SalePayment } from '@bipae/domain';
import type { ReceiptBlock } from './escpos';

export interface ReceiptSale {
  terminalSeq: number;
  createdAt: string;
  items: SaleItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: SalePayment[];
  customerTaxId: string | null;
}

export interface ReceiptHeader {
  businessName: string;
  taxId?: string | null;
  terminalName: string;
  operatorName: string;
}

const money = (c: number) => formatBRL(c as Cents).replace('R$ ', '');
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function qty(quantityMilli: number, unit: string) {
  const value = quantityMilli / 1000;
  const text = Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `${text} ${unit}`;
}

function twoColumns(left: string, right: string, columns: number) {
  const space = Math.max(1, columns - left.length - right.length);
  return (left + ' '.repeat(space) + right).slice(0, columns);
}

/**
 * Sale receipt. Until NFC-e arrives (Phase 3) this is explicitly NOT a fiscal document,
 * and says so, as required.
 */
export function buildReceipt(sale: ReceiptSale, header: ReceiptHeader, columns: number): ReceiptBlock[] {
  const blocks: ReceiptBlock[] = [
    { kind: 'text', text: header.businessName, align: 'center', bold: true },
  ];
  if (header.taxId) blocks.push({ kind: 'text', text: `CNPJ ${formatTaxId(header.taxId)}`, align: 'center' });
  blocks.push(
    { kind: 'text', text: '-'.repeat(columns) },
    { kind: 'text', text: 'COMPROVANTE DE VENDA', align: 'center', bold: true },
    { kind: 'text', text: 'NÃO É DOCUMENTO FISCAL', align: 'center' },
    { kind: 'text', text: '-'.repeat(columns) },
  );
  for (const item of sale.items) {
    blocks.push({ kind: 'text', text: `${String(item.line).padStart(3, '0')} ${item.name}`.slice(0, columns) });
    const detail = `    ${qty(item.quantityMilli, item.unit)} x ${money(item.unitPriceCents)}`;
    blocks.push({ kind: 'text', text: twoColumns(detail, money(item.grossCents), columns) });
    if (item.discountCents > 0) {
      blocks.push({ kind: 'text', text: twoColumns('    desconto', `-${money(item.discountCents)}`, columns) });
    }
  }
  blocks.push({ kind: 'text', text: '-'.repeat(columns) });
  if (sale.discountCents > 0) {
    blocks.push(
      { kind: 'text', text: twoColumns('Subtotal', money(sale.subtotalCents), columns) },
      { kind: 'text', text: twoColumns('Descontos', `-${money(sale.discountCents)}`, columns) },
    );
  }
  blocks.push({ kind: 'text', text: twoColumns('TOTAL R$', money(sale.totalCents), columns), bold: true });
  for (const p of sale.payments) {
    blocks.push({ kind: 'text', text: twoColumns(PAYMENT_LABELS[p.method], money(p.amountCents + p.changeCents), columns) });
  }
  const change = sale.payments.reduce((a, p) => a + p.changeCents, 0);
  if (change > 0) blocks.push({ kind: 'text', text: twoColumns('Troco', money(change), columns), bold: true });
  blocks.push({ kind: 'text', text: '-'.repeat(columns) });
  if (sale.customerTaxId) {
    blocks.push({ kind: 'text', text: `Consumidor: ${formatTaxId(sale.customerTaxId)}` });
  }
  blocks.push(
    { kind: 'text', text: `Venda nº ${sale.terminalSeq} · ${header.terminalName}` },
    { kind: 'text', text: `${dateTime.format(new Date(sale.createdAt))} · ${header.operatorName}` },
    { kind: 'feed', lines: 1 },
    { kind: 'text', text: 'Obrigado pela preferência!', align: 'center' },
    { kind: 'text', text: 'Bipou? Bipaê!', align: 'center' },
  );
  return blocks;
}
