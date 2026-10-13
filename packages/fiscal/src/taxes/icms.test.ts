import { describe, expect, it } from 'vitest';
import { calculateIcms } from './icms';
import { TaxRuleDataError, UnsupportedTaxSituationError } from './shared';

// Alíquotas, reduções e MVA de exemplo, só para conferir a conta: NÃO são valores oficiais.
const CEM_REAIS = { baseCents: 10_000 };

describe('ICMS no regime normal (CST)', () => {
  it('00: tributada integralmente', () => {
    const r = calculateIcms({ cst: '00', rate: '18' }, CEM_REAIS);
    expect(r).toMatchObject({
      cst: '00',
      csosn: null,
      group: 'ICMS00',
      baseCents: 10_000,
      rate: '18.00',
      amountCents: 1800,
      st: null,
      fcp: null,
      credit: null,
      deferral: null,
      baseReduction: null,
    });
    expect(r.trace.map((s) => s.label)).toEqual(['CST 00', 'Valor da operação', 'ICMS a 18.00%']);
    expect(r.trace.at(-1)).toMatchObject({ formula: '100.00 × 18.00%', value: '18.00' });
  });

  it('00 com Fundo de Combate à Pobreza', () => {
    const r = calculateIcms({ cst: '00', rate: '18', fcpRate: '2' }, CEM_REAIS);
    expect(r.amountCents).toBe(1800);
    expect(r.fcp).toEqual({ rate: '2.00', amountCents: 200 });
  });

  it('20: com redução da base de cálculo', () => {
    const r = calculateIcms({ cst: '20', rate: '18', baseReduction: '33.33' }, CEM_REAIS);
    // 100,00 × (1 − 33,33%) = 66,67; 66,67 × 18% = 12,0006
    expect(r).toMatchObject({ group: 'ICMS20', baseCents: 6667, amountCents: 1200, baseReduction: '33.33' });
  });

  it('40, 41, 50 e 60: nada a destacar', () => {
    for (const cst of ['40', '41', '50', '60']) {
      const r = calculateIcms({ cst }, CEM_REAIS);
      expect(r, cst).toMatchObject({ baseCents: 0, rate: null, amountCents: 0, st: null });
      expect(r.trace.at(-1)!.label, cst).toBe('Sem ICMS a destacar nesta situação');
    }
    expect(calculateIcms({ cst: '41' }, CEM_REAIS).group).toBe('ICMS40');
    expect(calculateIcms({ cst: '60' }, CEM_REAIS).group).toBe('ICMS60');
  });

  it('51: diferimento parcial e total', () => {
    const parcial = calculateIcms({ cst: '51', rate: '18', deferral: '33.33' }, CEM_REAIS);
    // 18,00 × 33,33% = 5,9994 → 6,00 diferido; 12,00 devido
    expect(parcial.deferral).toEqual({ rate: '33.33', operationAmountCents: 1800, deferredAmountCents: 600 });
    expect(parcial.amountCents).toBe(1200);
    const total = calculateIcms({ cst: '51', rate: '18', deferral: '100' }, CEM_REAIS);
    expect(total.amountCents).toBe(0);
    expect(total.deferral!.deferredAmountCents).toBe(1800);
  });

  it('10: com substituição tributária por MVA', () => {
    const r = calculateIcms({ cst: '10', rate: '18', st: { mva: '40', rate: '18' } }, CEM_REAIS);
    // Base da ST: 100,00 × 1,40 = 140,00; 140,00 × 18% = 25,20; menos 18,00 de ICMS próprio = 7,20
    expect(r.amountCents).toBe(1800);
    expect(r.st).toEqual({ mva: '40.00', baseReduction: null, baseCents: 14_000, rate: '18.00', amountCents: 720 });
    expect(r.trace.at(-1)).toMatchObject({
      label: 'ICMS-ST a 18.00%',
      formula: '140.00 × 18.00% − 18.00 de ICMS próprio',
      value: '7.20',
    });
  });

  it('10: o IPI entra na base da ST e, se a regra mandar, na do ICMS próprio', () => {
    const semIpiNaBase = calculateIcms(
      { cst: '10', rate: '18', st: { mva: '40', rate: '18' } },
      { baseCents: 10_000, ipiCents: 500 },
    );
    // (100,00 + 5,00) × 1,40 = 147,00; 26,46 − 18,00 = 8,46
    expect(semIpiNaBase).toMatchObject({ baseCents: 10_000, amountCents: 1800 });
    expect(semIpiNaBase.st).toMatchObject({ baseCents: 14_700, amountCents: 846 });

    const comIpiNaBase = calculateIcms(
      { cst: '10', rate: '18', includeIpiInBase: true, st: { mva: '40', rate: '18' } },
      { baseCents: 10_000, ipiCents: 500 },
    );
    // Próprio: 105,00 × 18% = 18,90; ST: 26,46 − 18,90 = 7,56
    expect(comIpiNaBase).toMatchObject({ baseCents: 10_500, amountCents: 1890 });
    expect(comIpiNaBase.st).toMatchObject({ baseCents: 14_700, amountCents: 756 });
  });

  it('70: redução da base própria e da base da ST', () => {
    const r = calculateIcms(
      { cst: '70', rate: '18', baseReduction: '10', st: { mva: '40', rate: '18', baseReduction: '10' } },
      CEM_REAIS,
    );
    // Próprio: 90,00 × 18% = 16,20. ST: 140,00 × 0,90 = 126,00; 22,68 − 16,20 = 6,48
    expect(r).toMatchObject({ group: 'ICMS70', baseCents: 9000, amountCents: 1620 });
    expect(r.st).toMatchObject({ baseReduction: '10.00', baseCents: 12_600, amountCents: 648 });
  });

  it('o ICMS-ST nunca fica negativo', () => {
    const r = calculateIcms({ cst: '10', rate: '18', st: { mva: '0', rate: '12' } }, CEM_REAIS);
    expect(r.st!.amountCents).toBe(0);
  });

  it('respeita o arredondamento da regra', () => {
    // 2,50 × 1% = 0,025: meio centavo exato.
    expect(calculateIcms({ cst: '00', rate: '1' }, { baseCents: 250 }).amountCents).toBe(3);
    expect(calculateIcms({ cst: '00', rate: '1', rounding: 'truncate' }, { baseCents: 250 }).amountCents).toBe(2);
  });
});

describe('ICMS no Simples Nacional (CSOSN)', () => {
  it('101: sem destaque, com crédito para o comprador', () => {
    const r = calculateIcms({ csosn: '101', creditRate: '2.5' }, CEM_REAIS);
    expect(r).toMatchObject({ cst: null, csosn: '101', group: 'ICMSSN101', baseCents: 0, amountCents: 0 });
    expect(r.credit).toEqual({ rate: '2.50', amountCents: 250 });
  });

  it('102, 103, 300, 400 e 500: nada a destacar', () => {
    for (const csosn of ['102', '103', '300', '400', '500']) {
      const r = calculateIcms({ csosn }, CEM_REAIS);
      expect(r, csosn).toMatchObject({ amountCents: 0, credit: null, st: null });
    }
    expect(calculateIcms({ csosn: '300' }, CEM_REAIS).group).toBe('ICMSSN102');
    expect(calculateIcms({ csosn: '500' }, CEM_REAIS).group).toBe('ICMSSN500');
  });

  it('202: ST com o ICMS próprio só abatido, sem destaque', () => {
    const r = calculateIcms({ csosn: '202', rate: '18', st: { mva: '40', rate: '18' } }, CEM_REAIS);
    expect(r).toMatchObject({ group: 'ICMSSN202', baseCents: 0, amountCents: 0, rate: '18.00', credit: null });
    expect(r.st).toEqual({ mva: '40.00', baseReduction: null, baseCents: 14_000, rate: '18.00', amountCents: 720 });
    expect(r.trace.map((s) => s.label)).toContain('ICMS próprio a abater (18.00%, não destacado)');
  });

  it('201: ST e crédito para o comprador', () => {
    const r = calculateIcms(
      { csosn: '201', rate: '18', creditRate: '1.25', st: { mva: '40', rate: '18' } },
      CEM_REAIS,
    );
    expect(r.st!.amountCents).toBe(720);
    expect(r.credit).toEqual({ rate: '1.25', amountCents: 125 });
    expect(r.amountCents).toBe(0);
  });
});

describe('ICMS: o que o motor recusa', () => {
  it('situação ainda não calculada vira aviso claro, nunca conta aproximada', () => {
    for (const cst of ['30', '90', '02', '61']) {
      expect(() => calculateIcms({ cst, rate: '18' }, CEM_REAIS), cst).toThrow(UnsupportedTaxSituationError);
    }
    expect(() => calculateIcms({ csosn: '900' }, CEM_REAIS)).toThrow('ainda não está disponível no Bipaê');
  });

  it('regra com dado faltando ou incoerente', () => {
    const casos: [Parameters<typeof calculateIcms>[0], string][] = [
      [{ cst: '00', csosn: '102' }, 'só um dos dois'],
      [{}, 'informe CST ou CSOSN'],
      [{ cst: '99' }, 'não existe na tabela oficial'],
      [{ csosn: '00' }, 'não existe na tabela oficial'],
      [{ cst: '00' }, 'falta a alíquota'],
      [{ cst: '20', rate: '18' }, 'falta a redução da base'],
      [{ cst: '51', rate: '18' }, 'falta o percentual do diferimento'],
      [{ cst: '10', rate: '18' }, 'faltam os dados da substituição tributária'],
      [{ csosn: '101' }, 'falta a alíquota de crédito'],
      [{ csosn: '202', st: { mva: '40', rate: '18' } }, 'falta a alíquota para abater'],
      [{ cst: '00', rate: '101' }, 'fora de 0 a 100%'],
      [{ cst: '00', rate: '-1' }, 'fora de 0 a 100%'],
      [{ cst: '10', rate: '18', st: { mva: '-5', rate: '18' } }, 'MVA fora de 0 a 1000%'],
    ];
    for (const [efeito, mensagem] of casos) {
      expect(() => calculateIcms(efeito, CEM_REAIS), mensagem).toThrow(TaxRuleDataError);
      expect(() => calculateIcms(efeito, CEM_REAIS), mensagem).toThrow(mensagem);
    }
  });

  it('valores de entrada inválidos', () => {
    expect(() => calculateIcms({ cst: '00', rate: '18' }, { baseCents: -1 })).toThrow('Base de cálculo inválida');
    expect(() => calculateIcms({ cst: '00', rate: '18' }, { baseCents: 10.5 })).toThrow('Base de cálculo inválida');
    expect(() => calculateIcms({ cst: '00', rate: '18' }, { baseCents: 100, ipiCents: -1 })).toThrow(
      'Valor do IPI inválida',
    );
  });
});
