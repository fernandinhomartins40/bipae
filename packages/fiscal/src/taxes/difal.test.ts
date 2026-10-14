import { describe, expect, it } from 'vitest';
import { calculateDifal } from './difal';
import { TaxRuleDataError } from './shared';

/** F3-32: partilha do ICMS (EC 87/2015) na venda a consumidor final não contribuinte de outra UF. */

describe('partilha do ICMS (DIFAL)', () => {
  it('base única: de SP (7% para o Nordeste) para a BA (20,5%)', () => {
    const r = calculateDifal({ ufOrigem: 'SP', ufDestino: 'BA', baseCents: 100_000 });
    expect(r).toMatchObject({
      baseCents: 100_000,
      interstateRate: '7.00',
      destinationRate: '20.50',
      sharePercent: '100.00',
      destinationCents: 13_500,
      originCents: 0,
      fcpCents: 0,
      baseMode: 'unica',
    });
    // A BA tem FCP, mas só para produtos listados: sem regra não soma e avisa.
    expect(r.assumption).toContain('Sem FCP de BA');
  });

  it('mercadoria importada usa 4% e a UF sem FCP não gera aviso', () => {
    const r = calculateDifal({
      ufOrigem: 'PR',
      ufDestino: 'SC',
      baseCents: 10_000,
      imported: true,
    });
    expect(r.interstateRate).toBe('4.00');
    expect(r.destinationCents).toBe(1300);
    expect(r.assumption).toBeNull();
  });

  it('com FCP do produto e alíquota própria do destino', () => {
    const r = calculateDifal({
      ufOrigem: 'MG',
      ufDestino: 'RJ',
      baseCents: 10_000,
      destinationRate: '20',
      fcpRate: '2',
    });
    expect(r.destinationCents).toBe(800);
    expect(r).toMatchObject({
      fcpBaseCents: 10_000,
      fcpCents: 200,
      fcpRate: '2.00',
      assumption: null,
    });
  });

  it('base dupla: refaz a base com a alíquota do destino ("por dentro")', () => {
    // (100,00 − 12,00) ÷ (1 − 0,18) = 107,32; 107,32 × 18% − 12,00 = 7,32
    const r = calculateDifal({
      ufOrigem: 'SP',
      ufDestino: 'MG',
      baseCents: 10_000,
      baseMode: 'dupla',
    });
    expect(r.baseCents).toBe(10_732);
    expect(r.destinationCents).toBe(732);
  });

  it('destino com alíquota interna maior que zero mas menor que a interestadual não gera DIFAL negativo', () => {
    const r = calculateDifal({
      ufOrigem: 'SP',
      ufDestino: 'RJ',
      baseCents: 10_000,
      destinationRate: '10',
    });
    expect(r.destinationCents).toBe(0);
  });

  it('UF de destino sem alíquota confirmada pede a do produto', () => {
    expect(() => calculateDifal({ ufOrigem: 'SP', ufDestino: 'AP', baseCents: 10_000 })).toThrow(
      TaxRuleDataError,
    );
    expect(
      calculateDifal({ ufOrigem: 'SP', ufDestino: 'AP', baseCents: 10_000, destinationRate: '18' })
        .destinationCents,
    ).toBe(1100); // 18% − 7% (de SP para o Norte)
  });
});
