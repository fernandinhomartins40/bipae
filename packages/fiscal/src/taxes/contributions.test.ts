import { describe, expect, it } from 'vitest';
import { calculateContribution } from './contributions';
import { calculateIpi } from './ipi';
import { TaxRuleDataError } from './shared';

const CEM_REAIS = { baseCents: 10_000 };

describe('PIS e COFINS', () => {
  it('01: alíquota sobre o valor da operação', () => {
    const pis = calculateContribution('PIS', { cst: '01', rate: '0.65' }, CEM_REAIS);
    expect(pis).toMatchObject({ tax: 'PIS', cst: '01', group: 'PISAliq', baseCents: 10_000, rate: '0.65', amountCents: 65 });
    const cofins = calculateContribution('COFINS', { cst: '01', rate: '3' }, CEM_REAIS);
    expect(cofins).toMatchObject({ group: 'COFINSAliq', rate: '3.00', amountCents: 300 });
    expect(cofins.trace.at(-1)).toMatchObject({ label: 'COFINS a 3.00%', formula: '100.00 × 3.00%', value: '3.00' });
  });

  it('tira o ICMS da base quando a regra manda', () => {
    const entrada = { baseCents: 10_000, icmsCents: 1800 };
    // Base: 100,00 − 18,00 = 82,00. PIS: 1,353 → 1,35. COFINS: 6,232 → 6,23.
    expect(calculateContribution('PIS', { cst: '01', rate: '1.65', excludeIcms: true }, entrada)).toMatchObject({
      baseCents: 8200,
      amountCents: 135,
    });
    expect(calculateContribution('COFINS', { cst: '01', rate: '7.6', excludeIcms: true }, entrada)).toMatchObject({
      baseCents: 8200,
      amountCents: 623,
    });
    // Sem a ordem da regra, o ICMS continua na base.
    expect(calculateContribution('PIS', { cst: '01', rate: '1.65' }, entrada).baseCents).toBe(10_000);
    // Sem ICMS no item, não há o que tirar.
    expect(calculateContribution('PIS', { cst: '01', rate: '1.65', excludeIcms: true }, CEM_REAIS).baseCents).toBe(10_000);
  });

  it('03: valor por unidade de produto', () => {
    const r = calculateContribution('PIS', { cst: '03', amountPerUnit: '0.0350' }, { baseCents: 5000, quantity: '10' });
    expect(r).toMatchObject({ group: 'PISQtde', quantity: '10.0000', amountPerUnit: '0.0350', amountCents: 35, rate: null });
    expect(r.trace.at(-1)!.formula).toBe('10.0000 × R$ 0.0350');
  });

  it('04 a 09: nada a destacar', () => {
    for (const cst of ['04', '05', '06', '07', '08', '09']) {
      const r = calculateContribution('COFINS', { cst }, CEM_REAIS);
      expect(r, cst).toMatchObject({ group: 'COFINSNT', amountCents: 0, baseCents: 0, rate: null });
    }
  });

  it('outras operações: calcula só se a regra trouxer alíquota', () => {
    expect(calculateContribution('PIS', { cst: '49' }, CEM_REAIS)).toMatchObject({ group: 'PISOutr', amountCents: 0 });
    expect(calculateContribution('PIS', { cst: '99', rate: '1' }, CEM_REAIS)).toMatchObject({
      group: 'PISOutr',
      amountCents: 100,
    });
  });

  it('respeita o arredondamento da regra', () => {
    expect(calculateContribution('PIS', { cst: '01', rate: '1' }, { baseCents: 250 }).amountCents).toBe(3);
    expect(calculateContribution('PIS', { cst: '01', rate: '1', rounding: 'half-even' }, { baseCents: 250 }).amountCents).toBe(2);
  });

  it('recusa regra incompleta e entrada inválida', () => {
    expect(() => calculateContribution('PIS', { cst: '10' }, CEM_REAIS)).toThrow(TaxRuleDataError);
    expect(() => calculateContribution('PIS', { cst: '01' }, CEM_REAIS)).toThrow('falta a alíquota');
    expect(() => calculateContribution('PIS', { cst: '01', rate: '101' }, CEM_REAIS)).toThrow('fora de 0 a 100%');
    expect(() => calculateContribution('PIS', { cst: '01', rate: '-1' }, CEM_REAIS)).toThrow('fora de 0 a 100%');
    expect(() => calculateContribution('PIS', { cst: '03' }, { baseCents: 100, quantity: '1' })).toThrow(
      'falta o valor por unidade',
    );
    expect(() => calculateContribution('PIS', { cst: '03', amountPerUnit: '0.01' }, CEM_REAIS)).toThrow(
      'informe a quantidade vendida',
    );
    expect(() =>
      calculateContribution('PIS', { cst: '03', amountPerUnit: '0.01' }, { baseCents: 100, quantity: '-1' }),
    ).toThrow('não podem ser negativos');
    expect(() =>
      calculateContribution('PIS', { cst: '01', rate: '1', excludeIcms: true }, { baseCents: 100, icmsCents: 200 }),
    ).toThrow('não pode ser maior que o valor da operação');
    expect(() => calculateContribution('PIS', { cst: '01', rate: '1' }, { baseCents: -1 })).toThrow('Base de cálculo inválida');
    expect(() => calculateContribution('PIS', { cst: '01', rate: '1' }, { baseCents: 1, icmsCents: -1 })).toThrow(
      'Valor do ICMS inválida',
    );
  });
});

describe('IPI', () => {
  it('50: saída tributada', () => {
    const r = calculateIpi({ cst: '50', rate: '5' }, CEM_REAIS);
    expect(r).toMatchObject({ cst: '50', group: 'IPITrib', baseCents: 10_000, rate: '5.00', amountCents: 500 });
    expect(r.trace.at(-1)).toMatchObject({ formula: '100.00 × 5.00%', value: '5.00' });
  });

  it('saídas sem imposto ficam no grupo IPINT, com valor zero', () => {
    for (const cst of ['51', '52', '53', '54', '55']) {
      expect(calculateIpi({ cst }, CEM_REAIS), cst).toMatchObject({ group: 'IPINT', amountCents: 0, rate: null });
    }
  });

  it('recusa regra incompleta e entrada inválida', () => {
    expect(() => calculateIpi({ cst: '77' }, CEM_REAIS)).toThrow('não existe na tabela oficial');
    expect(() => calculateIpi({ cst: '50' }, CEM_REAIS)).toThrow('falta a alíquota');
    expect(() => calculateIpi({ cst: '50', rate: '-1' }, CEM_REAIS)).toThrow('alíquota negativa');
    expect(() => calculateIpi({ cst: '50', rate: '5' }, { baseCents: -1 })).toThrow('Base de cálculo inválida');
    expect(calculateIpi({ cst: '50', rate: '1', rounding: 'truncate' }, { baseCents: 250 }).amountCents).toBe(2);
  });
});
