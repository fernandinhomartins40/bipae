import { describe, expect, it } from 'vitest';
import { settleIbsCbs, type IbsCbsTotals } from './ibs-cbs-settlement';

const totals: IbsCbsTotals = {
  salesIbsCents: 1000,
  salesCbsCents: 9000,
  returnsIbsCents: 100,
  returnsCbsCents: 900,
  purchasesIbsCents: 1200,
  purchasesCbsCents: 5000,
};

describe('apuração do IBS e da CBS (F4-13)', () => {
  it('regime regular: débito das vendas menos devoluções, contra o crédito das compras, separados', () => {
    const r = settleIbsCbs({ regime: 'real', regularOption: false, date: '2027-03-01', totals });
    if (r.mode !== 'regular') throw new Error('esperava regime regular');
    // IBS: 900 de débito contra 1200 de crédito → sobra 300; não abate a CBS.
    expect(r.ibs).toEqual({
      debitCents: 900,
      creditCents: 1200,
      balanceCents: -300,
      payableCents: 0,
      creditLeftCents: 300,
    });
    expect(r.cbs).toMatchObject({ debitCents: 8100, creditCents: 5000, payableCents: 3100 });
    expect(r.credit.segregated).toBe(true);
    expect(r.regime.source).toContain('art. 41');
    expect(r.period).toBeNull();
  });

  it('2026 é o ano de teste: dispensa de recolhimento com a fonte', () => {
    const r = settleIbsCbs({
      regime: 'presumido',
      regularOption: false,
      date: '2026-10-01',
      totals,
    });
    if (r.mode !== 'regular') throw new Error('esperava regime regular');
    expect(r.period).toMatchObject({
      paymentWaived: true,
      source: 'LC 214/2025, art. 348, I e § 1º',
    });
  });

  it('Simples recolhe no DAS, a menos que tenha optado pelo regime regular', () => {
    expect(
      settleIbsCbs({ regime: 'simples', regularOption: false, date: '2027-01-01', totals }).mode,
    ).toBe('simples');
    expect(
      settleIbsCbs({ regime: 'mei', regularOption: false, date: '2027-01-01', totals }).mode,
    ).toBe('simples');
    expect(
      settleIbsCbs({ regime: 'simples-excesso', regularOption: true, date: '2027-01-01', totals })
        .mode,
    ).toBe('regular');
  });

  it('sem regime informado, pede a configuração', () => {
    expect(
      settleIbsCbs({ regime: null, regularOption: false, date: '2027-01-01', totals }),
    ).toEqual({
      mode: 'falta-configurar',
      message: 'Informe o regime tributário da empresa para apurar o IBS e a CBS.',
    });
    expect(
      settleIbsCbs({ regime: 'outro' as never, regularOption: false, date: '2027-01-01', totals })
        .mode,
    ).toBe('falta-configurar');
  });
});
