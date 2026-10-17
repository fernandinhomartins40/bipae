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
    expect(stReferencesFor('AC', '04011010', '2026-10-16')).toEqual([]);
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

describe('bebidas em SP: base pela pauta da Portaria SRE 27/2026 (F3-26.e)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];

  it('cerveja continua na ST, com a base pela pauta de 01/07 a 31/12/2026', () => {
    const cerveja = stStatusFor('SP', '22030000', '2026-10-16', ncmsOf).filter(
      (s) => s.annex === 'III',
    );
    expect(cerveja.length).toBeGreaterThan(0);
    expect(cerveja.every((s) => s.inSt)).toBe(true);
    expect(cerveja[0]!.base).toMatchObject({
      kind: 'pauta',
      validFrom: '2026-07-01',
      validTo: '2026-12-31',
      act: expect.stringContaining('Portaria SRE 27/2026'),
    });
    // Fora do período da pauta, a base não é afirmada.
    const depois = stStatusFor('SP', '22030000', '2027-01-15', ncmsOf).filter(
      (s) => s.annex === 'III',
    );
    expect(depois[0]!.base).toBeNull();
  });
});

describe('Paraná: Resolução SEFA 571/2019 e Anexo IX do RICMS/PR (F3-26.c)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
  const pr = ST_REFERENCES.filter((r) => r.uf === 'PR');

  it('as tabelas da resolução, com a redação atual de cada item', () => {
    expect(ST_REFERENCE_UFS).toContain('PR');
    expect(ST_SEGMENT_UFS).toContain('PR');
    const itens = pr.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(400);
    for (const item of itens) {
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
      expect(item.ncms.length, item.item).toBeGreaterThan(0);
      for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{4,8}$/);
    }
    // Nenhum item repetido dentro da mesma tabela (a redação antiga ficou de fora).
    for (const r of pr) {
      const chaves = r.items.map((i) => `${i.item}/${i.cest}`);
      expect(new Set(chaves).size, r.segment).toBe(chaves.length);
    }
  });

  it('chocolate branco 41,47% e cerveja em lata 140%, pelo NCM', () => {
    const chocolate = stReferencesFor('PR', '1704.90.10', '2026-10-17');
    expect(chocolate[0]).toMatchObject({ cest: '1700100', mva: '41.47' });
    expect(chocolate[0]!.segmentName).toBe('Produtos alimentícios: chocolates');
    const cerveja = stReferencesFor('PR', '22030000', '2026-10-17').map((m) => m.mva);
    expect(cerveja).toContain('140');
  });

  it('a redação antiga não vale: o sucos e bebidas perdeu o item 1 (sucos de frutas)', () => {
    const sucos = pr.find((r) => r.segment === 'XXII-II')!;
    expect(sucos.items.map((i) => i.item)).not.toContain('1');
    expect(sucos.items.map((i) => i.cest)).not.toContain('1701000');
  });

  it('cosméticos pela tabela nova da Resolução SEFA 1.245/2025, a partir de 01/04/2026', () => {
    const cosmeticos = pr.find((r) => r.segment === 'XII')!;
    expect(cosmeticos.validFrom).toBe('2026-04-01');
    expect(cosmeticos.items.find((i) => i.cest === '2000100')).toMatchObject({ mva: '46.78' });
    expect(stReferencesFor('PR', '12119090', '2026-03-31')).toEqual([]);
  });

  it('eletrônicos saíram da ST em 01/03/2026 (Decreto 12.828/2026): a MVA para de ser sugerida', () => {
    const anexo = ST_SEGMENTS.find((s) => s.uf === 'PR')!.annexes.find((a) => a.annex === 'XXIII')!;
    expect(anexo).toMatchObject({ excludedFrom: '2026-03-01', excludedBy: 'Decreto 12.828/2026' });
    // Aparelho de ar-condicionado (NCM 8415.10.11).
    expect(stReferencesFor('PR', '84151011', '2026-02-28').length).toBeGreaterThan(0);
    expect(stReferencesFor('PR', '84151011', '2026-03-01')).toEqual([]);
    const status = stStatusFor('PR', '84151011', '2026-10-17', ncmsOf);
    expect(status[0]).toMatchObject({ inSt: false, excludedBy: 'Decreto 12.828/2026' });
  });

  it('materiais de limpeza saíram em 01/08/2024 (Decreto 6.048/2024); alimentícios continuam', () => {
    // Água sanitária (CEST 11.001.00).
    const limpeza = stStatusFor('PR', '28289011', '2026-10-17', ncmsOf);
    expect(limpeza.find((s) => s.cest === '1100100')).toMatchObject({
      annex: 'XVIII',
      inSt: false,
      excludedFrom: '2024-08-01',
    });
    const chocolate = stStatusFor('PR', '17049010', '2026-10-17', ncmsOf);
    expect(chocolate.find((s) => s.cest === '1700100')).toMatchObject({ inSt: true });
  });
});

describe('Minas Gerais: Anexo XV do RICMS/MG, Parte 2 (F3-26.c.MG)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
  const mg = ST_REFERENCES.filter((r) => r.uf === 'MG');

  it('os capítulos da Parte 2, com a data de efeito da redação atual', () => {
    expect(ST_REFERENCE_UFS).toContain('MG');
    expect(ST_SEGMENT_UFS).toContain('MG');
    const itens = mg.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(900);
    const cests = new Set(CESTS.map((c) => c.cest));
    for (const item of itens) {
      expect(cests.has(item.cest), item.cest).toBe(true);
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
      for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
    }
    for (const r of mg) expect(r.validFrom, r.segment).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
  });

  it('leite UHT 15% e chocolate branco 77,88%', () => {
    const leite = stReferencesFor('MG', '04011010', '2026-10-17');
    expect(leite.find((m) => m.cest === '1701600')).toMatchObject({ mva: '15' });
    const chocolate = stReferencesFor('MG', '17049010', '2026-10-17');
    expect(chocolate.find((m) => m.cest === '1700100')).toMatchObject({ mva: '77.88' });
  });

  it('cerveja em lata: a MVA da indústria (140%) e a do atacadista (70%), cada uma com o nome', () => {
    const lata = stReferencesFor('MG', '22030000', '2026-10-17').filter(
      (m) => m.cest === '0302103',
    );
    expect(lata.map((m) => m.mva).sort()).toEqual(['140', '70']);
    expect(lata.find((m) => m.mva === '70')!.description).toMatch(/Atacadista/);
  });

  it('vinho: importado, nacional do 2204.10 e os demais nacionais têm MVAs diferentes', () => {
    const vinho = mg.flatMap((r) => r.items).filter((i) => i.cest === '0202400');
    expect(vinho.map((i) => i.mva)).toEqual(['115.32', '50.61', '72.25']);
  });

  it('água mineral do CEST 03.001.00 saiu da ST em 01/10/2021 (Decreto 48.248/2021)', () => {
    const cap3 = ST_SEGMENTS.find((s) => s.uf === 'MG')!.annexes.find((a) => a.annex === '3')!;
    expect(cap3.cests.find((c) => c.cest === '0300100')).toMatchObject({
      excludedFrom: '2021-10-01',
      excludedBy: 'Decreto 48.248/2021',
    });
    // A cerveja continua na ST.
    const cerveja = stStatusFor('MG', '22030000', '2026-10-17', ncmsOf);
    expect(cerveja.some((s) => s.inSt)).toBe(true);
  });
});

describe('Rio Grande do Sul: Apêndice II do RICMS/RS (F3-26.c.RS)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
  const rs = ST_REFERENCES.filter((r) => r.uf === 'RS');

  it('Seções II e III, com a MVA da operação interna', () => {
    expect(ST_REFERENCE_UFS).toContain('RS');
    const itens = rs.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(180);
    for (const item of itens) expect(item.mva, item.item).toMatch(/^\d{1,3}\.\d{2}$/);
    expect(rs.find((r) => r.segment === 'III-XXII')!.items[0]).toMatchObject({
      cest: '2000100',
      mva: '80.05',
    });
  });

  it('a Seção II, só do RS: carne bovina com MVA de 30%', () => {
    const carne = stReferencesFor('RS', '02013000', '2026-10-17');
    expect(carne.find((m) => m.cest === '1708400')).toMatchObject({ mva: '30.00' });
  });

  it('cerveja está na ST, mas a MVA fica no art. 92 do Livro III: a lista diz, sem inventar MVA', () => {
    expect(stReferencesFor('RS', '22030000', '2026-10-17')).toEqual([]);
    const status = stStatusFor('RS', '22030000', '2026-10-17', ncmsOf);
    expect(status.some((s) => s.annex === 'III-I' && s.inSt)).toBe(true);
  });
});
