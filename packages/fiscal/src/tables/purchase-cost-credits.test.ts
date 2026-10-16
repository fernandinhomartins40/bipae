import { describe, expect, it } from 'vitest';
import { COMPANY_REGIMES } from '../regimes';
import { PURCHASE_COST_CREDITS, recoverableTaxes } from './purchase-cost-credits';

describe('créditos que saem do custo da compra (dúvida D-024)', () => {
  it('cada regime do motor tem a regra, com a explicação', () => {
    for (const regime of COMPANY_REGIMES) {
      const row = PURCHASE_COST_CREDITS.find((r) => r.regime === regime.id);
      expect(row, regime.id).toBeDefined();
      expect(row!.note.length, regime.id).toBeGreaterThan(20);
    }
  });

  it('Simples e MEI não recuperam; Presumido recupera o ICMS; Real, ICMS, PIS e COFINS', () => {
    expect(recoverableTaxes('mei')).toEqual([]);
    expect(recoverableTaxes('simples')).toEqual([]);
    expect(recoverableTaxes('simples-excesso')).toEqual(['icms']);
    expect(recoverableTaxes('presumido')).toEqual(['icms']);
    expect(recoverableTaxes('real')).toEqual(['icms', 'pis', 'cofins']);
    // Sem regime cadastrado, o custo fica cheio.
    expect(recoverableTaxes(null)).toEqual([]);
  });
});
