import { describe, expect, it } from 'vitest';
import { checkRules, type Rule, type RuleContext } from '../rules';
import { pisCofinsRate } from '../tables/rates';
import type { ContributionEffect } from './contributions';
import { calculateCurrentTaxes, type CurrentTaxRules } from './current';
import type { IcmsEffect } from './icms';
import type { IpiEffect } from './ipi';

/**
 * Casos por regime: Simples Nacional, Lucro Presumido e Lucro Real.
 *
 * PIS e COFINS usam as alíquotas gerais da tabela oficial do motor. O ICMS (18%) e a MVA (40%)
 * são de EXEMPLO: a alíquota de cada UF entra na tabela quando a UF de homologação for definida.
 */
const HOJE = '2026-06-15';
const ANO_2026 = { start: '2026-01-01', end: '2027-01-01' };

const geral = (tax: 'PIS' | 'COFINS', regime: 'cumulativo' | 'nao-cumulativo') => pisCofinsRate(tax, regime, HOJE)!;

const contribuicoes = (tax: 'PIS' | 'COFINS'): Rule<ContributionEffect>[] => {
  const cumulativo = geral(tax, 'cumulativo');
  const naoCumulativo = geral(tax, 'nao-cumulativo');
  return [
    {
      id: `${tax}-simples`,
      tax,
      validity: ANO_2026,
      scope: { crt: [1] },
      // No Simples o PIS e a COFINS vão no documento de arrecadação, não na nota.
      effect: { cst: '49' },
      source: 'Exemplo: recolhimento pelo Simples Nacional (LC 123/2006)',
    },
    {
      id: `${tax}-presumido`,
      tax,
      validity: cumulativo.validity,
      scope: { taxRegime: ['presumido'] },
      effect: { cst: '01', rate: cumulativo.rate },
      source: cumulativo.source,
    },
    {
      id: `${tax}-real`,
      tax,
      validity: naoCumulativo.validity,
      scope: { taxRegime: ['real'] },
      effect: { cst: '01', rate: naoCumulativo.rate, excludeIcms: true },
      source: naoCumulativo.source,
    },
  ];
};

const icms: Rule<IcmsEffect>[] = [
  {
    id: 'icms-simples',
    tax: 'ICMS',
    validity: { start: '2026-01-01' },
    scope: { crt: [1] },
    effect: { csosn: '102' },
    source: 'Exemplo',
  },
  {
    id: 'icms-normal',
    tax: 'ICMS',
    validity: { start: '2026-01-01' },
    scope: { crt: [3] },
    effect: { cst: '00', rate: '18' },
    source: 'Exemplo: alíquota interna',
  },
  {
    id: 'icms-normal-cerveja-st',
    tax: 'ICMS',
    validity: { start: '2026-01-01' },
    scope: { crt: [3], ncm: ['2203'] },
    effect: { cst: '10', rate: '18', st: { mva: '40', rate: '18' } },
    source: 'Exemplo: substituição tributária de bebidas',
  },
];

const regras: CurrentTaxRules = { icms, pis: contribuicoes('PIS'), cofins: contribuicoes('COFINS'), ipi: [] };

const operacao = (parcial: Partial<RuleContext>): RuleContext => ({
  date: HOJE,
  crt: 3,
  ufOrigem: 'SP',
  ufDestino: 'SP',
  ncm: '10063021',
  ...parcial,
});

const CEM_REAIS = { baseCents: 10_000 };

describe('tributos atuais por regime', () => {
  it('as tabelas de exemplo passam na conferência de regras', () => {
    expect(checkRules([...regras.icms, ...regras.pis, ...regras.cofins])).toEqual([]);
  });

  it('Simples Nacional: nada destacado na nota', () => {
    const r = calculateCurrentTaxes(regras, operacao({ crt: 1, taxRegime: 'simples' }), CEM_REAIS);
    expect(r.icms).toMatchObject({ csosn: '102', group: 'ICMSSN102', amountCents: 0, ruleId: 'icms-simples' });
    expect(r.pis).toMatchObject({ cst: '49', amountCents: 0 });
    expect(r.cofins).toMatchObject({ cst: '49', amountCents: 0 });
    expect(r.ipi).toBeNull();
  });

  it('Lucro Presumido: PIS e COFINS cumulativos sobre o valor cheio', () => {
    const r = calculateCurrentTaxes(regras, operacao({ taxRegime: 'presumido' }), CEM_REAIS);
    expect(r.icms).toMatchObject({ cst: '00', amountCents: 1800 });
    expect(r.pis).toMatchObject({ rate: '0.65', baseCents: 10_000, amountCents: 65 });
    expect(r.cofins).toMatchObject({ rate: '3.00', baseCents: 10_000, amountCents: 300 });
    expect(r.pis!.source).toContain('Lei 9.715/1998');
  });

  it('Lucro Real: PIS e COFINS não cumulativos, sem o ICMS na base', () => {
    const r = calculateCurrentTaxes(regras, operacao({ taxRegime: 'real' }), CEM_REAIS);
    expect(r.icms).toMatchObject({ cst: '00', amountCents: 1800 });
    // Base: 100,00 − 18,00 = 82,00. PIS 1,65% = 1,35. COFINS 7,6% = 6,23.
    expect(r.pis).toMatchObject({ rate: '1.65', baseCents: 8200, amountCents: 135 });
    expect(r.cofins).toMatchObject({ rate: '7.60', baseCents: 8200, amountCents: 623 });
    expect(r.cofins!.source).toContain('Lei 10.833/2003');
  });

  it('a regra mais específica do produto vence a geral (ST da cerveja)', () => {
    const r = calculateCurrentTaxes(regras, operacao({ taxRegime: 'real', ncm: '22030000' }), CEM_REAIS);
    expect(r.icms).toMatchObject({ cst: '10', ruleId: 'icms-normal-cerveja-st', amountCents: 1800 });
    expect(r.icms!.st).toMatchObject({ baseCents: 14_000, amountCents: 720 });
    // Só o ICMS próprio sai da base do PIS e da COFINS; o ICMS-ST não.
    expect(r.pis!.baseCents).toBe(8200);
  });

  it('cada resultado explica a conta, começando pela regra e sua fonte', () => {
    const r = calculateCurrentTaxes(regras, operacao({ taxRegime: 'presumido' }), CEM_REAIS);
    expect(r.icms!.trace[0]).toEqual({ label: 'Regra icms-normal', value: 'Exemplo: alíquota interna' });
    expect(r.icms!.trace.at(-1)).toMatchObject({ label: 'ICMS a 18.00%', value: '18.00' });
    expect(r.pis!.trace[0]!.label).toBe('Regra PIS-presumido');
    expect(r.pis!.trace.at(-1)).toMatchObject({ formula: '100.00 × 0.65%', value: '0.65' });
  });

  it('em 2027 o PIS e a COFINS deixam de existir; o ICMS continua', () => {
    const r = calculateCurrentTaxes(regras, operacao({ taxRegime: 'real', date: '2027-01-10' }), CEM_REAIS);
    expect(r.pis).toBeNull();
    expect(r.cofins).toBeNull();
    expect(r.icms).toMatchObject({ amountCents: 1800 });
  });

  it('sem o regime de apuração informado, nenhuma regra de PIS/COFINS é escolhida por suposição', () => {
    const r = calculateCurrentTaxes(regras, operacao({}), CEM_REAIS);
    expect(r.pis).toBeNull();
    expect(r.cofins).toBeNull();
  });

  it('o IPI é calculado antes e entra na base da ST', () => {
    const ipi: Rule<IpiEffect>[] = [
      {
        id: 'ipi-exemplo',
        tax: 'IPI',
        validity: { start: '2026-01-01' },
        scope: { ncm: ['2203'] },
        effect: { cst: '50', rate: '5' },
        source: 'Exemplo',
      },
    ];
    const r = calculateCurrentTaxes({ ...regras, ipi }, operacao({ taxRegime: 'real', ncm: '22030000' }), CEM_REAIS);
    expect(r.ipi).toMatchObject({ amountCents: 500, ruleId: 'ipi-exemplo' });
    // (100,00 + 5,00) × 1,40 = 147,00; 26,46 − 18,00 = 8,46
    expect(r.icms!.st).toMatchObject({ baseCents: 14_700, amountCents: 846 });
  });

  it('tributo por unidade recebe a quantidade do item', () => {
    const pis: Rule<ContributionEffect>[] = [
      {
        id: 'pis-por-unidade',
        tax: 'PIS',
        validity: ANO_2026,
        scope: {},
        effect: { cst: '03', amountPerUnit: '0.0350' },
        source: 'Exemplo',
      },
    ];
    const r = calculateCurrentTaxes({ icms: [], pis, cofins: [], ipi: [] }, operacao({}), {
      baseCents: 5000,
      quantity: '10',
    });
    expect(r.pis).toMatchObject({ amountCents: 35, quantity: '10.0000' });
    expect(r.icms).toBeNull();
  });
});
