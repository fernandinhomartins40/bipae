import { describe, expect, it } from 'vitest';
import {
  addMonths,
  billingReasonInput,
  billingState,
  INVOICE_METHOD_LABELS,
  payMethodInput,
  prorateUpgradeCents,
  saveCardInput,
} from './billing';

const d = (s: string) => new Date(s);

describe('ciclo de cobrança dos planos (F6-04)', () => {
  it('soma meses sem estourar o fim do mês', () => {
    expect(addMonths(d('2026-01-31T12:00:00Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(addMonths(d('2026-10-27T12:00:00Z'), 1).toISOString()).toBe('2026-11-27T12:00:00.000Z');
    expect(addMonths(d('2026-12-15T00:00:00Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('calcula a troca para cima proporcional ao que falta do período, em centavos inteiros', () => {
    const base = {
      currentPriceCents: 10000,
      newPriceCents: 20000,
      periodStart: d('2026-10-01T00:00:00Z'),
      periodEnd: d('2026-11-01T00:00:00Z'),
    };
    // Metade do período: metade da diferença.
    expect(prorateUpgradeCents({ ...base, now: d('2026-10-16T12:00:00Z') })).toBe(5000);
    // No primeiro dia, a diferença inteira; depois do fim, nada.
    expect(prorateUpgradeCents({ ...base, now: d('2026-10-01T00:00:00Z') })).toBe(10000);
    expect(prorateUpgradeCents({ ...base, now: d('2026-11-02T00:00:00Z') })).toBe(0);
    // Plano mais barato nunca gera cobrança.
    expect(
      prorateUpgradeCents({ ...base, newPriceCents: 5000, now: d('2026-10-10T00:00:00Z') }),
    ).toBe(0);
    // Arredonda metade para cima: 1/3 de 1001 = 333,67 -> 334.
    expect(
      prorateUpgradeCents({
        currentPriceCents: 0,
        newPriceCents: 1001,
        periodStart: d('2026-10-01T00:00:00Z'),
        periodEnd: d('2026-10-04T00:00:00Z'),
        now: d('2026-10-03T00:00:00Z'),
      }),
    ).toBe(334);
  });

  it('classifica a situação: em dia, a pagar, tolerância e bloqueio gentil', () => {
    const now = d('2026-10-10T00:00:00Z');
    const base = { hasPaidPlan: true, now, graceDays: 5 };
    expect(billingState({ ...base, openInvoiceDueAt: null })).toBe('ok');
    expect(billingState({ hasPaidPlan: false, openInvoiceDueAt: null, now, graceDays: 5 })).toBe(
      'none',
    );
    expect(billingState({ ...base, openInvoiceDueAt: d('2026-10-15T00:00:00Z') })).toBe('due_soon');
    expect(billingState({ ...base, openInvoiceDueAt: d('2026-10-08T00:00:00Z') })).toBe('grace');
    expect(billingState({ ...base, openInvoiceDueAt: d('2026-10-04T00:00:00Z') })).toBe('blocked');
  });
});

describe('forma de pagamento da fatura e motivos do painel (F6-04.c e F6-04.d)', () => {
  it('aceita só pix, boleto e cartão', () => {
    expect(payMethodInput.parse({ method: 'boleto' }).method).toBe('boleto');
    expect(() => payMethodInput.parse({ method: 'cheque' })).toThrow();
    expect(INVOICE_METHOD_LABELS.card).toBe('Cartão de crédito');
  });

  it('cartão salvo exige o código do parceiro e o motivo precisa ser explicado', () => {
    expect(() => saveCardInput.parse({ token: 'ab' })).toThrow('tela do parceiro');
    expect(saveCardInput.parse({ token: '  tok_abc ' }).token).toBe('tok_abc');
    expect(() => billingReasonInput.parse({ reason: ' ' })).toThrow('motivo');
    expect(billingReasonInput.parse({ reason: 'Acordo fechado' }).reason).toBe('Acordo fechado');
  });
});
