import {
  formatBRL,
  formatTaxId,
  PAYMENT_LABELS,
  type Cents,
  type PaymentMethod,
} from '@bipae/domain';
import { buildReceipt, receiptToText } from '@bipae/pdv-core/pure';
import type { Me, Sale } from './api';

export const brl = (cents: number) => formatBRL(cents as Cents);
export const methodLabel = (m: PaymentMethod) => PAYMENT_LABELS[m];
export { formatTaxId };

/** "2" for units, "1,255" for weighed items. */
export function quantity(milli: number, unit: string, weighable = unit !== 'UN') {
  const value = milli / 1000;
  if (!weighable || Number.isInteger(value)) return `${value.toLocaleString('pt-BR')} ${unit}`;
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${unit}`;
}

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const COLUMNS = 40;

/** Receipt as plain text (the same layout the Bipaê register prints). */
export function receiptLines(sale: Sale, me: Me): string[] {
  const blocks = buildReceipt(
    {
      terminalSeq: sale.number,
      createdAt: sale.createdAt,
      items: sale.items.map((item, i) => ({
        line: i + 1,
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        quantityMilli: item.quantityMilli,
        unitPriceCents: item.unitPriceCents,
        grossCents: item.totalCents + item.discountCents,
        discountCents: item.discountCents,
        totalCents: item.totalCents,
      })),
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      totalCents: sale.totalCents,
      payments: sale.payments.map((p) => ({
        ...p,
        nsu: null,
        authorizationCode: null,
        provider: null,
      })),
      customerTaxId: sale.customerDocument ?? null,
    },
    {
      businessName: me.store.name,
      taxId: me.store.document ?? null,
      terminalName: 'PDV',
      operatorName: me.operator.name,
    },
    COLUMNS,
  );
  const lines = receiptToText(blocks, COLUMNS);
  if (sale.status === 'cancelled') lines.unshift('*** VENDA CANCELADA ***'.padStart(31), '');
  return lines;
}

/** Prints on the browser's printer (thermal printers installed in the OS work too). */
export function printReceipt(sale: Sale, me: Me) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const pre = doc.createElement('pre');
  pre.textContent = receiptLines(sale, me).join('\n');
  const style = doc.createElement('style');
  style.textContent =
    '@page{size:80mm auto;margin:4mm}body{margin:0}pre{font:12px/1.35 ui-monospace,Consolas,monospace;white-space:pre;margin:0}';
  doc.head.appendChild(style);
  doc.body.appendChild(pre);
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}
