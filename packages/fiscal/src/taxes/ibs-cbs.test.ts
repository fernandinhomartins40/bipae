import { describe, expect, it } from 'vitest';
import { CLASS_TRIBS } from '../tables/class-trib';
import { REFERENCE_RATES, type ReferenceRate } from '../tables/rates';
import { ICMS_ISS_END, ibsCbsBaseRules, icmsIssProportion } from '../tables/transition';
import { calculateIbsCbs, MissingRateError } from './ibs-cbs';
import { calculateIs } from './is';
import { TaxRuleDataError, UnsupportedTaxSituationError } from './shared';

const INTEGRAL = '000001';
const CESTA_BASICA = '200003';

/**
 * Para os anos sem alíquota publicada, os casos usam números de EXEMPLO (marcados no nome), só
 * para provar que o motor troca de regra na data certa. Não são previsão de alíquota.
 */
const exemplo = (
  inicio: string,
  fim: string | undefined,
  cbs: string,
  estadual: string,
  municipal: string,
): ReferenceRate[] =>
  (
    [
      ['CBS', 'federal', cbs],
      ['IBS', 'estadual', estadual],
      ['IBS', 'municipal', municipal],
    ] as const
  ).map(([tax, sphere, rate]) => ({
    id: `exemplo-${tax}-${sphere}-${inicio}`,
    tax,
    sphere,
    rate,
    validity: { start: inicio, ...(fim !== undefined && { end: fim }) },
    source: 'EXEMPLO, sem valor legal',
    url: '',
  }));

const TABELA_DE_EXEMPLO: ReferenceRate[] = [
  ...REFERENCE_RATES,
  // 2027–2028: o IBS é o da lei (já está na tabela oficial); só a CBS é exemplo.
  ...exemplo('2027-01-01', '2029-01-01', '8.7', '0', '0').filter((r) => r.tax === 'CBS'),
  ...exemplo('2029-01-01', '2030-01-01', '8.8', '1.4', '0.4'),
  ...exemplo('2030-01-01', '2031-01-01', '8.8', '2.8', '0.8'),
  ...exemplo('2031-01-01', '2032-01-01', '8.8', '4.2', '1.2'),
  ...exemplo('2032-01-01', '2033-01-01', '8.8', '5.6', '1.6'),
  ...exemplo('2033-01-01', undefined, '8.8', '14', '4'),
];

describe('IBS e CBS em 2026 (ano de teste, alíquotas da lei)', () => {
  it('tributação integral: CBS de 0,9% e IBS de 0,1%', () => {
    const r = calculateIbsCbs({ cClassTrib: INTEGRAL, date: '2026-06-15', operationCents: 10_000 });
    expect(r).toMatchObject({ cst: '000', cClassTrib: INTEGRAL, taxed: true, baseCents: 10_000 });
    expect(r.cbs).toMatchObject({
      rate: '0.9000',
      reduction: '0.00',
      effectiveRate: '0.9000',
      amountCents: 90,
    });
    expect(r.ibsState).toMatchObject({ rate: '0.1000', amountCents: 10 });
    expect(r.ibsMunicipal).toMatchObject({ rate: '0.0000', amountCents: 0 });
    expect(r.ibsAmountCents).toBe(10);
    expect(r.cbsAmountCents).toBe(90);
    expect(r.cbs!.source).toContain('LC 214/2025, art. 346');
  });

  it('ICMS, PIS e COFINS saem da base; o IPI nunca entra', () => {
    const r = calculateIbsCbs({
      cClassTrib: INTEGRAL,
      date: '2026-06-15',
      operationCents: 10_000,
      taxes: { ICMS: 1800, PIS: 65, COFINS: 300 },
    });
    // 100,00 − 18,00 − 0,65 − 3,00 = 78,35. CBS: 0,70515 → 0,71. IBS: 0,07835 → 0,08.
    expect(r.baseCents).toBe(7835);
    expect(r.cbsAmountCents).toBe(71);
    expect(r.ibsAmountCents).toBe(8);
    const passos = r.trace.map((s) => s.label);
    expect(passos).toContain('ICMS fora da base (LC 214/2025, art. 12, § 2º, V)');
    expect(r.trace.find((s) => s.label.startsWith('COFINS fora'))).toMatchObject({
      formula: '81.35 − 3.00',
      value: '78.35',
    });
  });

  it('alíquota reduzida a zero (cesta básica): há grupo de valores, mas o tributo é zero', () => {
    const r = calculateIbsCbs({
      cClassTrib: CESTA_BASICA,
      date: '2026-06-15',
      operationCents: 10_000,
    });
    expect(r).toMatchObject({
      cst: '200',
      taxed: true,
      baseCents: 10_000,
      ibsAmountCents: 0,
      cbsAmountCents: 0,
    });
    expect(r.cbs).toMatchObject({ rate: '0.9000', reduction: '100.00', effectiveRate: '0.0000' });
  });

  it('redução de 60% da tabela oficial', () => {
    const reduzida = CLASS_TRIBS.find(
      (c) => c.cst === '200' && c.pRedIBS === '60' && c.pRedCBS === '60',
    )!;
    const r = calculateIbsCbs({
      cClassTrib: reduzida.cClassTrib,
      date: '2026-06-15',
      operationCents: 100_000,
    });
    // CBS: 0,9% × 0,4 = 0,36% de 1.000,00 = 3,60. IBS: 0,1% × 0,4 = 0,04% = 0,40.
    expect(r.cbs).toMatchObject({ effectiveRate: '0.3600', amountCents: 360 });
    expect(r.ibsState).toMatchObject({ effectiveRate: '0.0400', amountCents: 40 });
    expect(r.trace.at(-1)!.formula).toBe('1000.00 × 0.9000% × (1 − 60.00%)');
  });

  it('imunidade e isenção: nada a calcular', () => {
    const imune = CLASS_TRIBS.find((c) => c.cst === '410')!;
    const r = calculateIbsCbs({
      cClassTrib: imune.cClassTrib,
      date: '2026-06-15',
      operationCents: 10_000,
    });
    expect(r).toMatchObject({
      cst: '410',
      taxed: false,
      baseCents: 0,
      cbs: null,
      ibsState: null,
      ibsAmountCents: 0,
    });
    expect(r.trace.at(-1)!.label).toBe('Sem IBS e CBS a calcular nesta situação');
  });

  it('respeita o arredondamento da configuração', () => {
    // CBS: 5,00 × 0,9% = 0,045: meio centavo exato.
    const entrada = { cClassTrib: INTEGRAL, date: '2026-06-15', operationCents: 500 };
    expect(calculateIbsCbs(entrada).cbsAmountCents).toBe(5);
    expect(calculateIbsCbs({ ...entrada, rounding: 'half-even' }).cbsAmountCents).toBe(4);
    expect(calculateIbsCbs({ ...entrada, rounding: 'truncate' }).cbsAmountCents).toBe(4);
  });
});

describe('IBS e CBS de 2027 em diante', () => {
  it('2027 sem alíquota publicada da CBS: o cálculo fica bloqueado, com explicação', () => {
    const entrada = { cClassTrib: INTEGRAL, date: '2027-03-01', operationCents: 10_000 };
    expect(() => calculateIbsCbs(entrada)).toThrow(MissingRateError);
    expect(() => calculateIbsCbs(entrada)).toThrow(
      'A alíquota da CBS para 2027 ainda não está na tabela',
    );
  });

  it('2029 sem alíquota do IBS: também bloqueia, dizendo qual falta', () => {
    const soCbs = TABELA_DE_EXEMPLO.filter((r) => r.tax === 'CBS');
    expect(() =>
      calculateIbsCbs({
        cClassTrib: INTEGRAL,
        date: '2029-03-01',
        operationCents: 10_000,
        rates: soCbs,
      }),
    ).toThrow('A alíquota estadual do IBS para 2029 ainda não está na tabela');
  });

  it('2027–2028: IBS de 0,05% estadual + 0,05% municipal (lei); CBS de exemplo', () => {
    const r = calculateIbsCbs({
      cClassTrib: INTEGRAL,
      date: '2027-03-01',
      operationCents: 10_000,
      taxes: { ICMS: 1800 },
      rates: TABELA_DE_EXEMPLO,
    });
    expect(r.baseCents).toBe(8200);
    expect(r.ibsState).toMatchObject({
      rate: '0.0500',
      amountCents: 4,
      source: 'LC 214/2025, art. 344',
    });
    expect(r.ibsMunicipal).toMatchObject({ rate: '0.0500', amountCents: 4 });
    expect(r.ibsAmountCents).toBe(8);
    // 82,00 × 8,7% = 7,134
    expect(r.cbsAmountCents).toBe(713);
  });

  it('o Imposto Seletivo entra na base a partir de 2027, não antes', () => {
    const entrada = {
      cClassTrib: INTEGRAL,
      operationCents: 10_000,
      taxes: { IS: 500 },
      rates: TABELA_DE_EXEMPLO,
    };
    expect(calculateIbsCbs({ ...entrada, date: '2026-12-31' }).baseCents).toBe(10_000);
    const em2027 = calculateIbsCbs({ ...entrada, date: '2027-01-01' });
    expect(em2027.baseCents).toBe(10_500);
    expect(em2027.trace.some((s) => s.label.startsWith('IS somado à base'))).toBe(true);
  });

  it('transição 2029–2032: o ICMS encolhe e segue fora da base; o IBS cresce', () => {
    const casos: [string, string, number][] = [
      ['2029-06-01', '0.9', 148],
      ['2030-06-01', '0.8', 296],
      ['2031-06-01', '0.7', 442],
      ['2032-06-01', '0.6', 590],
    ];
    for (const [data, fator, ibs] of casos) {
      expect(icmsIssProportion(data)?.factor, data).toBe(fator);
      const r = calculateIbsCbs({
        cClassTrib: INTEGRAL,
        date: data,
        operationCents: 10_000,
        taxes: { ICMS: 1800 },
        rates: TABELA_DE_EXEMPLO,
      });
      expect(r.baseCents, data).toBe(8200);
      expect(r.ibsAmountCents, data).toBe(ibs);
      expect(r.cbsAmountCents, data).toBe(722);
    }
  });

  it('2033: sem ICMS; a base é o valor cheio da operação', () => {
    expect(icmsIssProportion('2033-01-01')).toBeNull();
    expect(ICMS_ISS_END).toMatchObject({ date: '2033-01-01' });
    expect(ibsCbsBaseRules('2033-01-01').map((r) => r.tax)).toEqual(['IS']);
    const r = calculateIbsCbs({
      cClassTrib: INTEGRAL,
      date: '2033-06-01',
      operationCents: 10_000,
      // Mesmo que alguém informe ICMS, ele não existe mais e não mexe na base.
      taxes: { ICMS: 1800 },
      rates: TABELA_DE_EXEMPLO,
    });
    expect(r.baseCents).toBe(10_000);
    expect(r.ibsAmountCents).toBe(1800);
    expect(r.cbsAmountCents).toBe(880);
  });

  it('antes de 2029 o ICMS vale por inteiro', () => {
    expect(icmsIssProportion('2026-06-01')).toEqual({ factor: '1', source: null });
    expect(icmsIssProportion('2028-12-31')?.factor).toBe('1');
    expect(icmsIssProportion('2029-01-01')?.source).toBe('ADCT, art. 128, I (EC 132/2023)');
  });
});

describe('IBS e CBS: arredondamento conferido pela SEFAZ (D-008)', () => {
  it('o valor de cada item bate com vBC × pAliqEfet, dentro da tolerância de 0,01 da NT 2025.002', () => {
    const comReducao = CLASS_TRIBS.filter(
      (c) => Number(c.pRedIBS) > 0 && Number(c.pRedIBS) < 100 && c.end === undefined,
    );
    expect(comReducao.length).toBeGreaterThan(0);
    let conferidos = 0;
    for (const c of comReducao) {
      for (const operationCents of [1, 333, 98_765, 123_456_789]) {
        let r;
        try {
          r = calculateIbsCbs({ cClassTrib: c.cClassTrib, date: '2026-06-15', operationCents });
        } catch {
          continue; // situação que o motor ainda recusa, com mensagem própria
        }
        for (const p of [r.cbs, r.ibsState, r.ibsMunicipal]) {
          if (!p) continue;
          // A alíquota efetiva vai ao XML com 4 casas; a SEFAZ refaz a conta com ela.
          expect(p.effectiveRate).toMatch(/^\d+\.\d{4}$/);
          const esperado = (r.baseCents * Number(p.effectiveRate)) / 100;
          expect(Math.abs(p.amountCents - esperado), c.cClassTrib).toBeLessThanOrEqual(1);
          conferidos++;
        }
      }
    }
    expect(conferidos).toBeGreaterThan(0);
  });
});

describe('IBS e CBS: o que o motor recusa', () => {
  const base = { date: '2026-06-15', operationCents: 10_000 };

  it('classificação inexistente, fora da vigência ou excluída', () => {
    expect(() => calculateIbsCbs({ ...base, cClassTrib: '999999' })).toThrow(
      'não existe na tabela oficial',
    );
    expect(() => calculateIbsCbs({ ...base, cClassTrib: INTEGRAL, date: '2025-12-31' })).toThrow(
      'fora da vigência',
    );
    // Códigos com início e fim em 01/01/2026 foram excluídos (D-016): nem nesse dia valem.
    expect(() => calculateIbsCbs({ ...base, cClassTrib: '220001', date: '2026-01-01' })).toThrow(
      'fora da vigência',
    );
    expect(() => calculateIbsCbs({ ...base, cClassTrib: '220001' })).toThrow(TaxRuleDataError);
  });

  it('situações ainda não calculadas viram aviso claro', () => {
    for (const cst of [
      '010',
      '011',
      '221',
      '222',
      '510',
      '515',
      '550',
      '620',
      '800',
      '810',
      '811',
      '830',
    ]) {
      const item = CLASS_TRIBS.find((c) => c.cst === cst && c.end === undefined)!;
      expect(() => calculateIbsCbs({ ...base, cClassTrib: item.cClassTrib }), cst).toThrow(
        UnsupportedTaxSituationError,
      );
    }
  });

  it('entrada inválida e tabela de alíquotas incoerente', () => {
    expect(() => calculateIbsCbs({ ...base, cClassTrib: INTEGRAL, operationCents: -1 })).toThrow(
      'Valor da operação inválida',
    );
    expect(() => calculateIbsCbs({ ...base, cClassTrib: INTEGRAL, taxes: { ICMS: -1 } })).toThrow(
      'Valor de ICMS inválida',
    );
    expect(() =>
      calculateIbsCbs({ ...base, cClassTrib: INTEGRAL, taxes: { ICMS: 20_000 } }),
    ).toThrow('somam mais que o valor da operação');
    const duplicada = [
      ...REFERENCE_RATES,
      { ...REFERENCE_RATES.find((r) => r.tax === 'CBS')!, id: 'cbs-repetida' },
    ];
    expect(() => calculateIbsCbs({ ...base, cClassTrib: INTEGRAL, rates: duplicada })).toThrow(
      'mais de uma alíquota em vigor para o mesmo ente',
    );
  });
});

describe('Imposto Seletivo', () => {
  it('alíquota percentual', () => {
    const r = calculateIs({ rate: '10' }, { baseCents: 10_000 });
    expect(r).toMatchObject({
      baseCents: 10_000,
      rate: '10.00',
      amountCents: 1000,
      quantity: null,
    });
    expect(r.trace.at(-1)).toMatchObject({
      label: 'IS a 10.00%',
      formula: '100.00 × 10.00%',
      value: '10.00',
    });
  });

  it('valor por unidade, sozinho ou somado ao percentual', () => {
    const porUnidade = calculateIs(
      { amountPerUnit: '0.2500' },
      { baseCents: 10_000, quantity: '12' },
    );
    expect(porUnidade).toMatchObject({
      rate: null,
      quantity: '12.0000',
      amountPerUnit: '0.2500',
      amountCents: 300,
    });
    const misto = calculateIs(
      { rate: '10', amountPerUnit: '0.25' },
      { baseCents: 10_000, quantity: '12' },
    );
    expect(misto.amountCents).toBe(1300);
    expect(calculateIs({ rate: '1', rounding: 'truncate' }, { baseCents: 250 }).amountCents).toBe(
      2,
    );
  });

  it('recusa regra sem alíquota e entrada inválida', () => {
    expect(() => calculateIs({}, { baseCents: 100 })).toThrow('informe a alíquota percentual');
    expect(() => calculateIs({ rate: '-1' }, { baseCents: 100 })).toThrow('alíquota negativa');
    expect(() => calculateIs({ amountPerUnit: '1' }, { baseCents: 100 })).toThrow(
      'informe a quantidade',
    );
    expect(() => calculateIs({ amountPerUnit: '1' }, { baseCents: 100, quantity: '-1' })).toThrow(
      'não podem ser negativos',
    );
    expect(() => calculateIs({ rate: '1' }, { baseCents: -1 })).toThrow('Base de cálculo inválida');
  });
});
