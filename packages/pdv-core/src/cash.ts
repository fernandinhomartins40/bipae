import { PAYMENT_METHODS, type PaymentMethod, type SalePayment } from '@bipae/domain';

/**
 * Expected amounts per payment method for a cash session, and the blind close:
 * the operator declares what they counted without seeing the expected values first.
 */
export interface SessionActivity {
  openingCents: number;
  sales: { payments: SalePayment[]; status: 'completed' | 'cancelled' }[];
  returns: { refundCents: number; refundMethod: PaymentMethod }[];
  movements: { kind: 'withdrawal' | 'supply'; amountCents: number }[];
}

export type ByMethod = Record<PaymentMethod, number>;

export function zeroByMethod(): ByMethod {
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as ByMethod;
}

export function expectedBySession(activity: SessionActivity): ByMethod {
  const expected = zeroByMethod();
  expected.cash += activity.openingCents;
  for (const sale of activity.sales) {
    if (sale.status !== 'completed') continue;
    for (const p of sale.payments) expected[p.method] += p.amountCents;
  }
  for (const r of activity.returns) expected[r.refundMethod] -= r.refundCents;
  for (const m of activity.movements) {
    expected.cash += m.kind === 'supply' ? m.amountCents : -m.amountCents;
  }
  return expected;
}

export interface CloseResult {
  declared: ByMethod;
  expected: ByMethod;
  /** declared − expected, summed. Positive = sobra, negative = falta. */
  differenceCents: number;
  differences: ByMethod;
}

export function closeBlind(expected: ByMethod, declaredInput: Partial<ByMethod>): CloseResult {
  const declared = zeroByMethod();
  const differences = zeroByMethod();
  let differenceCents = 0;
  for (const m of PAYMENT_METHODS) {
    const value = declaredInput[m] ?? 0;
    if (!Number.isInteger(value) || value < 0) throw new Error('Valor contado inválido.');
    declared[m] = value;
    differences[m] = value - expected[m];
    differenceCents += differences[m];
  }
  return { declared, expected, differenceCents, differences };
}

/** Cash in the drawer right now (used to block a withdrawal larger than the drawer). */
export function cashInDrawer(activity: SessionActivity): number {
  return expectedBySession(activity).cash;
}
