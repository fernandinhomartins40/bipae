import { describe, expect, it } from 'vitest';
import { CESTS } from './cest';
import { ST_REFERENCES, ST_REFERENCE_UFS, stReferencesFor } from './st-references';

/** F3-26: MVA (IVA-ST) oficial por UF, gerada do ato da SEFAZ. */

describe('substituição tributária por UF (F3-26)', () => {
  it('SP: a tabela inteira da Portaria SRE 12/2026, com CEST do Convênio 142/18', () => {
    const sp = ST_REFERENCES.find((r) => r.uf === 'SP')!;
    expect(sp).toMatchObject({ validFrom: '2026-05-01', validTo: '2029-01-31' });
    expect(sp.items).toHaveLength(69);
    expect(ST_REFERENCE_UFS).toContain('SP');
    const cests = new Set(CESTS.map((c) => c.cest));
    for (const item of sp.items) {
      expect(cests.has(item.cest), item.cest).toBe(true);
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,4})?$/);
      for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{4,8}$/);
    }
  });

  it('acha pelo NCM do produto, só na UF e na vigência', () => {
    const leite = stReferencesFor('SP', '0401.10.10', '2026-10-16');
    expect(leite.map((m) => [m.cest, m.mva])).toContainEqual(['1701600', '23.06']);
    // Iogurte: a tabela publica a posição 04.03 ("403").
    expect(stReferencesFor('sp', '04039000', '2026-10-16').map((m) => m.mva)).toContain('70.10');
    expect(stReferencesFor('SP', '04011010', '2026-04-30')).toEqual([]);
    expect(stReferencesFor('SP', '04011010', '2029-02-01')).toEqual([]);
    expect(stReferencesFor('PR', '04011010', '2026-10-16')).toEqual([]);
    expect(stReferencesFor('SP', '22030000', '2026-10-16')).toEqual([]);
  });

  it('o item mais específico vem primeiro', () => {
    // Preparações de carne (1602) e as de peru (1602.31.00): o de peru é mais específico.
    const peru = stReferencesFor('SP', '16023100', '2026-10-16');
    expect(peru[0]).toMatchObject({ cest: '1707901', mva: '64.00' });
    expect(peru.map((m) => m.cest)).toContain('1707900');
  });
});
