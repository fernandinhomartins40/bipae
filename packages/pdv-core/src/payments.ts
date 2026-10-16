import type { PaymentMethod, SalePayment } from '@bipae/domain';

/**
 * Several payment methods on one sale. Only cash can exceed what is due (change).
 * `received` is what the customer handed over; `amountCents` is what the sale keeps.
 */
export interface TenderInput {
  method: PaymentMethod;
  receivedCents: number;
  nsu?: string | null;
  authorizationCode?: string | null;
  provider?: string | null;
}

export class PaymentError extends Error {}

export interface PaymentSummary {
  payments: SalePayment[];
  paidCents: number;
  remainingCents: number;
  changeCents: number;
}

export function summarizePayments(totalCents: number, tenders: TenderInput[]): PaymentSummary {
  let remaining = totalCents;
  const payments: SalePayment[] = [];
  let changeCents = 0;

  // Non-cash first: they can never exceed what is due.
  const ordered = [
    ...tenders.filter((t) => t.method !== 'cash'),
    ...tenders.filter((t) => t.method === 'cash'),
  ];
  for (const t of ordered) {
    if (!Number.isInteger(t.receivedCents) || t.receivedCents <= 0) {
      throw new PaymentError('Valor de pagamento inválido.');
    }
    if (t.method !== 'cash' && t.receivedCents > remaining) {
      throw new PaymentError(
        'Só pagamento em dinheiro pode ser maior que o valor que falta (para dar troco).',
      );
    }
    const kept = Math.min(t.receivedCents, remaining);
    const change = t.method === 'cash' ? t.receivedCents - kept : 0;
    changeCents += change;
    remaining -= kept;
    payments.push({
      method: t.method,
      amountCents: kept,
      changeCents: change,
      nsu: t.nsu ?? null,
      authorizationCode: t.authorizationCode ?? null,
      provider: t.provider ?? null,
    });
  }
  return {
    payments: payments.filter((p) => p.amountCents > 0 || p.changeCents > 0),
    paidCents: totalCents - remaining,
    remainingCents: remaining,
    changeCents,
  };
}

/** Quick cash suggestions for the payment screen: exact, then common notes. */
export function cashSuggestions(dueCents: number): number[] {
  const notes = [200, 500, 1000, 2000, 5000, 10000, 20000];
  const suggestions = new Set<number>([dueCents]);
  for (const n of notes) {
    const rounded = Math.ceil(dueCents / n) * n;
    if (rounded > dueCents) suggestions.add(rounded);
    if (suggestions.size >= 4) break;
  }
  return [...suggestions].sort((a, b) => a - b);
}
