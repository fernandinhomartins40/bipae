import { describe, expect, it } from 'vitest';
import { SIMPLES_ANNEXES, simplesEffectiveRate } from './simples-annexes';

describe('Anexos do Simples Nacional (LC 123/2006, redação da LC 155/2016)', () => {
  it('os cinco anexos têm seis faixas, do teto de R$ 180 mil ao de R$ 4,8 milhões', () => {
    expect(SIMPLES_ANNEXES.map((a) => a.annex)).toEqual(['I', 'II', 'III', 'IV', 'V']);
    for (const a of SIMPLES_ANNEXES) {
      expect(a.brackets.map((b) => b.upToCents)).toEqual([
        18_000_000, 36_000_000, 72_000_000, 180_000_000, 360_000_000, 480_000_000,
      ]);
    }
    const iii = SIMPLES_ANNEXES.find((a) => a.annex === 'III')!;
    expect(iii.brackets[2]).toEqual({
      bracket: 3,
      upToCents: 72_000_000,
      rate: '13.50',
      deductionCents: 1_764_000,
    });
  });

  it('alíquota efetiva: (RBT12 × nominal − dedução) ÷ RBT12, com 2 casas', () => {
    // Anexo III, R$ 500 mil: (67.500 − 17.640) ÷ 500.000 = 9,972%.
    expect(simplesEffectiveRate('III', 50_000_000)).toEqual({
      rate: '9.97',
      bracket: 3,
      nominal: '13.50',
      deductionCents: 1_764_000,
    });
    // Anexo V, R$ 1 milhão: (205.000 − 17.100) ÷ 1.000.000 = 18,79%.
    expect(simplesEffectiveRate('V', 100_000_000)?.rate).toBe('18.79');
    // Na primeira faixa, a efetiva é a nominal.
    expect(simplesEffectiveRate('III', 18_000_000)?.rate).toBe('6.00');
    expect(simplesEffectiveRate('IV', 9_000_000)?.rate).toBe('4.50');
  });

  it('empresa começando (sem receita) usa a primeira faixa; acima do teto, null', () => {
    expect(simplesEffectiveRate('III', 0)).toMatchObject({ rate: '6.00', bracket: 1 });
    expect(simplesEffectiveRate('III', 480_000_001)).toBeNull();
  });
});
