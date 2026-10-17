import { describe, expect, it } from 'vitest';
import { CESTS } from './cest';
import {
  ST_REFERENCES,
  ST_REFERENCE_UFS,
  ST_SEGMENTS,
  ST_SEGMENT_UFS,
  stReferencesFor,
  stStatusFor,
} from './st-references';

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

describe('mercadorias em ST em SP (Portaria CAT 68/2019, F3-26.b)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];

  it('os anexos e o que saiu da ST em 2026, com a data e a portaria', () => {
    const sp = ST_SEGMENTS.find((s) => s.uf === 'SP')!;
    const anexo = (n: string) => sp.annexes.find((a) => a.annex === n)!;
    expect(anexo('XIII')).toMatchObject({
      name: 'Produtos de limpeza',
      excludedFrom: '2026-08-01',
      excludedBy: 'Portaria SRE 20/2026',
    });
    expect(anexo('XI')).toMatchObject({
      excludedFrom: '2026-04-01',
      excludedBy: 'Portaria SRE 94/2025',
    });
    expect(anexo('X')).toMatchObject({ name: 'Bebidas alcoólicas', excludedFrom: '2026-01-01' });
    expect(anexo('XVI').excludedFrom).toBeUndefined();
    expect(ST_SEGMENT_UFS).toContain('SP');
  });

  it('limpeza saiu da ST em 01/08/2026: antes estava, depois não', () => {
    // Água sanitária (CEST 11.001.00, NCM 2828.90.11).
    const antes = stStatusFor('SP', '28289011', '2026-07-31', ncmsOf);
    const depois = stStatusFor('SP', '28289011', '2026-10-16', ncmsOf);
    expect(antes.find((s) => s.cest === '1100100')).toMatchObject({ inSt: true });
    expect(depois.find((s) => s.cest === '1100100')).toMatchObject({
      inSt: false,
      excludedFrom: '2026-08-01',
      excludedBy: 'Portaria SRE 20/2026',
    });
  });

  it('item revogado dentro de anexo em vigor: água em copo plástico saiu em 01/07/2026', () => {
    const agua = stStatusFor('SP', '22011000', '2026-10-16', ncmsOf).find(
      (s) => s.cest === '0300500',
    );
    expect(agua).toMatchObject({ annex: 'III', inSt: false, excludedFrom: '2026-07-01' });
    // O leite UHT continua na ST (e tem a MVA da Portaria SRE 12/2026).
    const leite = stStatusFor('SP', '04011010', '2026-10-16', ncmsOf).find(
      (s) => s.cest === '1701600',
    );
    expect(leite).toMatchObject({ annex: 'XVI', inSt: true });
  });

  it('as duas portarias concordam: nenhum CEST com IVA-ST está fora da ST', () => {
    const sp = ST_SEGMENTS.find((s) => s.uf === 'SP')!;
    const xvi = sp.annexes.find((a) => a.annex === 'XVI')!;
    const fora = new Set(xvi.cests.filter((c) => c.excludedFrom).map((c) => c.cest));
    const iva = ST_REFERENCES.find((r) => r.uf === 'SP')!.items;
    expect(iva.filter((i) => fora.has(i.cest))).toEqual([]);
  });
});
