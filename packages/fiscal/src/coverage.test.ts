import { describe, expect, it } from 'vitest';
import { withPendingUf } from '../test/pending-uf';
import { coverageMatrix } from './coverage';

describe('matriz de cobertura para o painel (F3-23.b)', () => {
  it('traz as 27 UFs × 5 regimes, com o que falta em cada combinação', () => {
    const m = coverageMatrix('2026-06-15');
    expect(m.rows).toHaveLength(27);
    expect(m.total).toBe(135);
    // Desde 16/10/2026, as 27 UFs têm a alíquota geral confirmada (D-021).
    expect(m.complete).toBe(135);
    expect(m.rows.find((r) => r.uf === 'AL')).toMatchObject({
      rateStatus: 'confirmado',
      rate: '20.5',
    });
    const pendente = withPendingUf('AL', () => coverageMatrix('2026-06-15'));
    // Os 3 regimes que dependem da alíquota (sublimite, Presumido e Real) ficam incompletos.
    expect(pendente.complete).toBe(132);
    const al = pendente.rows.find((r) => r.uf === 'AL')!;
    expect(al).toMatchObject({ rateStatus: 'pendente', rate: null });
    expect(al.cells.find((c) => c.regime === 'simples')!.complete).toBe(true);
    expect(al.cells.find((c) => c.regime === 'real')!.pending[0]).toContain(
      'AL ainda não foi confirmada',
    );
    expect(m.rows.find((r) => r.uf === 'SP')).toMatchObject({
      rate: '18',
      rateStatus: 'confirmado',
    });
  });
});
