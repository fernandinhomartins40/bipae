import { describe, expect, it } from 'vitest';
import { markupPrice, percentToBasisPoints, PricingError } from './pricing';

/** F4-03: formação de preço pelo divisor de markup. */
describe('formação de preço', () => {
  it('custo de R$ 21,00 com 30% de margem e 18% de impostos', () => {
    // 21 ÷ (1 − 0,48) = 40,3846... → R$ 40,38
    const r = markupPrice({ costCents: 2100, marginBp: 3000, taxesBp: 1800 });
    expect(r.priceCents).toBe(4038);
    expect(r.taxesCents).toBe(727); // 18% de 40,38 = 7,2684
    expect(r.costCents + r.taxesCents + r.expensesCents + r.marginCents).toBe(r.priceCents);
  });

  it('arredonda meio para cima e soma as despesas', () => {
    // 1,00 ÷ (1 − 0,20) = 1,25 exato
    expect(
      markupPrice({ costCents: 100, marginBp: 1000, taxesBp: 500, expensesBp: 500 }).priceCents,
    ).toBe(125);
    // 1,00 ÷ (1 − 0,30) = 1,42857 → 1,43
    expect(markupPrice({ costCents: 100, marginBp: 3000, taxesBp: 0 }).priceCents).toBe(143);
  });

  it('recusa soma de 100% ou mais e valores inválidos', () => {
    expect(() => markupPrice({ costCents: 100, marginBp: 6000, taxesBp: 4000 })).toThrow(
      PricingError,
    );
    expect(() => markupPrice({ costCents: -1, marginBp: 1, taxesBp: 1 })).toThrow(
      'Valores inválidos',
    );
  });

  it('lê percentuais em reais e centavos de ponto', () => {
    expect(percentToBasisPoints('12,5')).toBe(1250);
    expect(percentToBasisPoints('7.25')).toBe(725);
    expect(percentToBasisPoints('30')).toBe(3000);
    expect(percentToBasisPoints('100,01')).toBeNull();
    expect(percentToBasisPoints('abc')).toBeNull();
  });
});
