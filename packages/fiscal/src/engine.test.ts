import { describe, expect, it } from 'vitest';
import { applyRate, calculateTax, type RateEffect } from './engine';
import type { Rule, RuleContext } from './rules';

// Alíquotas de exemplo, só para exercitar a conta: NÃO são valores oficiais (isso é a F3-03).

describe('aplicação da alíquota', () => {
  it('calcula base × alíquota em centavos', () => {
    const r = applyRate(10_000, { rate: '18' });
    expect(r.baseCents).toBe(10_000);
    expect(r.amountCents).toBe(1800);
  });

  it('reduz a base antes de aplicar a alíquota e explica a conta', () => {
    const r = applyRate(10_000, { rate: '18', baseReduction: '33.33' });
    // 100,00 × (1 − 33,33%) = 66,67; 66,67 × 18% = 12,0006 → 12,00
    expect(r.baseCents).toBe(6667);
    expect(r.amountCents).toBe(1200);
    expect(r.trace).toEqual([
      { label: 'Base de cálculo', value: '100.00' },
      { label: 'Redução de 33.33% na base', formula: '100.00 × (1 − 33.33%)', value: '66.67' },
      { label: 'Alíquota de 18.00%', formula: '66.67 × 18.00%', value: '12.00' },
    ]);
  });

  it('respeita o arredondamento que vem da regra', () => {
    // 2,50 × 1% = 0,025: meio centavo exato.
    expect(applyRate(250, { rate: '1' }).amountCents).toBe(3);
    expect(applyRate(250, { rate: '1', rounding: 'half-up' }).amountCents).toBe(3);
    expect(applyRate(250, { rate: '1', rounding: 'half-even' }).amountCents).toBe(2);
    expect(applyRate(250, { rate: '1', rounding: 'truncate' }).amountCents).toBe(2);
  });

  it('aceita alíquota zero, redução total e base zero', () => {
    expect(applyRate(10_000, { rate: '0' }).amountCents).toBe(0);
    expect(applyRate(10_000, { rate: '18', baseReduction: '100' })).toMatchObject({
      baseCents: 0,
      amountCents: 0,
    });
    expect(applyRate(0, { rate: '18' }).amountCents).toBe(0);
  });

  it('não perde centavos em valores altos', () => {
    // R$ 9.999.999,99 × 17,5% = 1.749.999,99825
    expect(applyRate(999_999_999, { rate: '17.5' }).amountCents).toBe(175_000_000);
  });

  it('recusa entrada inválida', () => {
    expect(() => applyRate(-1, { rate: '18' })).toThrow('Base de cálculo inválida');
    expect(() => applyRate(10.5, { rate: '18' })).toThrow('Base de cálculo inválida');
    expect(() => applyRate(100, { rate: '-1' })).toThrow('Alíquota negativa');
    expect(() => applyRate(100, { rate: '18', baseReduction: '100.01' })).toThrow('fora de 0 a 100%');
    expect(() => applyRate(100, { rate: '18', baseReduction: '-5' })).toThrow('fora de 0 a 100%');
  });
});

describe('cálculo de um tributo pela tabela de regras', () => {
  const regras: Rule<RateEffect>[] = [
    {
      id: 'exemplo-geral',
      tax: 'ICMS',
      validity: { start: '2026-01-01' },
      scope: {},
      effect: { rate: '18', cst: '00' },
      source: 'Norma de exemplo, art. 1º',
    },
    {
      id: 'exemplo-teste-2026',
      tax: 'CBS',
      validity: { start: '2026-01-01', end: '2027-01-01' },
      scope: {},
      effect: { rate: '0.9', includedInTotal: false, requirement: 'informative' },
      source: 'Norma de exemplo, art. 2º',
    },
  ];
  const operacao: RuleContext = { date: '2026-06-15', crt: 3, ufOrigem: 'SP', ufDestino: 'SP' };

  it('devolve o valor, a regra usada e a fonte', () => {
    const r = calculateTax(regras, 'ICMS', operacao, 10_000);
    expect(r).toMatchObject({
      tax: 'ICMS',
      ruleId: 'exemplo-geral',
      source: 'Norma de exemplo, art. 1º',
      cst: '00',
      baseCents: 10_000,
      rate: '18.00',
      amountCents: 1800,
      includedInTotal: true,
      requirement: 'required',
    });
    expect(r!.trace[0]).toEqual({ label: 'Regra exemplo-geral', value: 'Norma de exemplo, art. 1º' });
    expect(r!.trace).toHaveLength(3);
  });

  it('leva da regra se o valor soma no total e se é só informativo', () => {
    const r = calculateTax(regras, 'CBS', operacao, 10_000);
    expect(r).toMatchObject({
      amountCents: 90,
      rate: '0.90',
      cst: null,
      includedInTotal: false,
      requirement: 'informative',
    });
  });

  it('a mesma operação em outra data usa outra regra, ou nenhuma', () => {
    expect(calculateTax(regras, 'CBS', { ...operacao, date: '2027-01-01' }, 10_000)).toBeNull();
    expect(calculateTax(regras, 'IS', operacao, 10_000)).toBeNull();
  });
});
