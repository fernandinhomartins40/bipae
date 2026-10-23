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
    // O Acre tem tabela desde 01/04/2023 (IN DIAT 1/2023); antes disso, nada.
    expect(stReferencesFor('AC', '04011010', '2023-03-31')).toEqual([]);
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
      // Até 1.138% (pentes vendidos porta a porta, art. 20, IX).
      expect(item.mva, item.item).toMatch(/^\d{1,4}(\.\d{1,2})?$/);
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
    // Antes disso, nada da tabela de cosméticos (o mesmo NCM aparece na venda porta a porta).
    const antes = stReferencesFor('PR', '12119090', '2026-03-31');
    expect(antes.filter((m) => !m.segmentName.startsWith('Venda porta a porta'))).toEqual([]);
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

  it('autopeças: as duas MVAs do art. 5º viram duas referências, a empresa escolhe a dela', () => {
    // Espelho retrovisor (CEST 01.016.00, NCM 7009.10.00, posição 16 do art. 28 do Anexo IX).
    const espelho = stReferencesFor('PR', '70091000', '2026-10-21').filter(
      (m) => m.cest === '0101600',
    );
    expect(espelho.map((m) => m.mva).sort()).toEqual(['36.56', '71.78']);
    expect(espelho.find((m) => m.mva === '71.78')).toMatchObject({
      cest: '0101600',
      segmentName: 'Autopeças: demais casos',
      description: 'Espelhos retrovisores',
    });
    const autopecas = pr.filter((r) => r.segment.startsWith('V-'));
    expect(autopecas.map((r) => r.segment)).toEqual(['V-I', 'V-II']);
    for (const r of autopecas) {
      // Posição 109 revogada em 2020 e a 125 ("outras peças", sem NCM) ficam de fora.
      expect(r.items.map((i) => i.item)).not.toContain('109');
      expect(r.items.map((i) => i.cest)).not.toContain('0111000');
      expect(r.items.length).toBe(123);
    }
    // A redação atual da posição 41 (8421.32.00), não a original (8421.39.20).
    const depurador = autopecas[0]!.items.find((i) => i.item === '41')!;
    expect(depurador.ncms).toEqual(['84213200']);
    const status = stStatusFor('PR', '70091000', '2026-10-21', ncmsOf);
    expect(status.find((s) => s.cest === '0101600')).toMatchObject({ annex: 'V', inSt: true });
  });

  it('medicamentos: a MVA segue a lista do PIS/COFINS do CEST, com as exceções de NCM', () => {
    // Genérico da lista positiva (CEST 13.002.00) e da negativa (13.002.01), NCM 3004.90.69.
    const generico = stReferencesFor('PR', '30049069', '2026-10-21');
    expect(generico.find((m) => m.cest === '1300200')).toMatchObject({ mva: '38.24' });
    expect(generico.find((m) => m.cest === '1300201')).toMatchObject({ mva: '33' });
    expect(generico.find((m) => m.cest === '1300202')).toMatchObject({ mva: '41.38' });
    // 3004.90.46 está fora dos incisos I e II (art. 25): só sobra a lista neutra.
    const excecao = stReferencesFor('PR', '30049046', '2026-10-21').filter((m) =>
      m.cest.startsWith('13'),
    );
    expect(excecao.map((m) => m.cest)).toEqual(['1300102', '1300202', '1300302', '1300402']);
    const anexo = ST_SEGMENTS.find((s) => s.uf === 'PR')!.annexes.find((a) => a.annex === 'XXIV')!;
    expect(anexo.name).toBe('Medicamentos');
    expect(pr.find((r) => r.segment === 'XXIV-V')!.note).toMatch(/PMPF/);
  });

  it('venda porta a porta: MVA por lista do art. 20, duas no perfume (indústria e atacado)', () => {
    const perfume = stReferencesFor('PR', '33030010', '2026-10-21');
    expect(
      perfume.map((m) => [m.segmentName.replace(/^Venda porta a porta: /, ''), m.mva]),
    ).toEqual(
      expect.arrayContaining([
        ['perfumaria e de higiene pessoal, saída da indústria (art. 20, IX)', '398.58'],
        ['perfumaria e de higiene pessoal, saída do atacado (art. 20, IX)', '33.72'],
        ['demais produtos (art. 20, X)', '30'],
      ]),
    );
    expect(perfume.find((m) => m.mva === '398.58')).toMatchObject({ cest: '2800100' });
    // Vestido de malha de algodão (inciso II), fora da lista do Anexo IX: CEST 28.999.00.
    expect(stReferencesFor('PR', '61044200', '2026-10-21')).toContainEqual(
      expect.objectContaining({ mva: '27.6', cest: '2899900' }),
    );
    // A redação atual: o item 23 do inciso IX (chupetas) foi revogado em 01/10/2023.
    const ix = pr.find((r) => r.segment === 'XX-IX-industria')!;
    expect(ix.items.map((i) => i.item)).not.toContain('23');
    expect(ix.items.find((i) => i.item === '21')).toMatchObject({ mva: '1138.0' });
    // Pincéis do 9603.30.00: o item cobre os dois CEST do Anexo IX.
    const pinceis = pr.find((r) => r.segment === 'XX-IV')!.items.filter((i) => i.item === '19');
    expect(pinceis.map((i) => i.cest)).toEqual(['2802800', '2802801']);
  });

  it('veículos: 30% pela tabela do inciso I e 34% para os de duas rodas (art. 29 da resolução)', () => {
    const carro = stReferencesFor('PR', '87032310', '2026-10-21');
    expect(carro.map((m) => m.mva)).toEqual(['30']);
    expect(carro[0]!.segmentName).toMatch(/art\. 136, II/);
    const moto = stReferencesFor('PR', '87112000', '2026-10-21');
    expect(moto.map((m) => m.mva).sort()).toEqual(['34', '34']);
    // Posição 32 (furgão elétrico, Convênio ICMS 174/2024), número e CEST em linhas separadas.
    expect(stReferencesFor('PR', '87046000', '2026-10-21')[0]).toMatchObject({
      cest: '2503200',
      mva: '30',
    });
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

describe('Santa Catarina: Anexo 1-A do RICMS/SC (F3-26.c.SC)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];

  it('bebidas alcoólicas: só a MVA original interna (74,15%), sem as ajustadas', () => {
    const vodka = stReferencesFor('SC', '22086000', '2026-10-17').filter(
      (m) => m.cest === '0201800',
    );
    expect(vodka.map((m) => m.mva)).toEqual(['74.15']);
  });

  it('cerveja e refrigerante: a MVA do atacadista e a da indústria, cada uma com o nome', () => {
    const refri = stReferencesFor('SC', '22021000', '2026-10-17').filter(
      (m) => m.cest === '0301000',
    );
    expect(refri.map((m) => m.mva).sort()).toEqual(['154.46', '80.24']);
    expect(refri.find((m) => m.mva === '80.24')!.description).toMatch(/atacadista/);
  });

  it('alimentícios saíram da ST em 01/04/2018 (Decreto 1.541/2018)', () => {
    const chocolate = stStatusFor('SC', '17049010', '2026-10-17', ncmsOf);
    expect(chocolate.length).toBeGreaterThan(0);
    expect(chocolate.every((s) => !s.inSt)).toBe(true);
    expect(chocolate[0]).toMatchObject({
      excludedFrom: '2018-04-01',
      excludedBy: 'Decreto 1.541/2018',
    });
    expect(stReferencesFor('SC', '17049010', '2026-10-17')).toEqual([]);
  });

  it('cosméticos saíram em 01/01/2021 (Decreto 982/2020), menos na venda porta a porta', () => {
    const perfume = stStatusFor('SC', '33030010', '2026-10-17', ncmsOf);
    expect(perfume.find((s) => s.annex === 'XIX')).toMatchObject({
      inSt: false,
      excludedFrom: '2021-01-01',
    });
    expect(perfume.find((s) => s.annex === 'XXVI')).toMatchObject({ inSt: true });
    const cerveja = stStatusFor('SC', '22030000', '2026-10-17', ncmsOf);
    expect(cerveja.some((s) => s.inSt)).toBe(true);
  });
});

describe('Bahia: Anexo 1 do RICMS/BA, redação vigente em 2026 (F3-26.c.BA)', () => {
  const ba = ST_REFERENCES.filter((r) => r.uf === 'BA');

  it('itens com CEST, NCM e a MVA original das operações internas, só em 2026', () => {
    expect(ST_REFERENCE_UFS).toContain('BA');
    const itens = ba.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(250);
    for (const item of itens) {
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
      expect(item.ncms.length, item.item).toBeGreaterThan(0);
    }
    for (const r of ba) expect(r).toMatchObject({ validFrom: '2026-01-01', validTo: '2026-12-31' });
    expect(stReferencesFor('BA', '22030000', '2027-01-15')).toEqual([]);
  });

  it('farinha de trigo: as faixas de CEST (17.044.00 a 17.044.27) entram inteiras, com 77,37%', () => {
    const farinha = ba.flatMap((r) => r.items).filter((i) => i.cest.startsWith('17044'));
    expect(farinha.length).toBeGreaterThan(10);
    expect(new Set(farinha.map((i) => i.mva))).toEqual(new Set(['77.37']));
  });

  it('autopeças remetem ao Convênio ICMS 142/18 inteiro: as exceções da nota não viram item', () => {
    expect(ba.find((r) => r.segment === '1')).toBeUndefined();
  });
});

describe('Goiás: Apêndice II do Anexo VIII do RCTE/GO (F3-26.d.GO)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];

  it('cerveja em lata: 140% quando quem vende é a indústria e 70% no atacadista', () => {
    const lata = stReferencesFor('GO', '22030000', '2026-10-17').filter(
      (m) => m.cest === '0302103',
    );
    expect(lata.map((m) => m.mva).sort()).toEqual(['140', '70']);
    expect(lata.find((m) => m.mva === '140')!.description).toMatch(/industrial/);
  });

  it('a redação nova vale: pneus de automóvel com 42% (Decreto 10.799/2025)', () => {
    const pneu = stReferencesFor('GO', '40111000', '2026-10-17').find((m) => m.cest === '1600100');
    expect(pneu).toMatchObject({ mva: '42' });
  });

  it('autopeças e materiais de construção saíram da ST em 01/03/2018 (Decreto 9.108)', () => {
    const go = ST_SEGMENTS.find((s) => s.uf === 'GO')!;
    expect(go.annexes.find((a) => a.annex === 'XIII')).toMatchObject({
      excludedFrom: '2018-03-01',
      excludedBy: 'Decreto 9.108',
    });
    const tubo = stStatusFor('GO', '39172100', '2026-10-17', ncmsOf);
    expect(tubo.find((s) => s.annex === 'XV')).toMatchObject({
      inSt: false,
      excludedFrom: '2018-03-01',
    });
    // Na venda porta a porta (marketing direto, inciso XVII) o mesmo NCM continua na ST.
    expect(tubo.find((s) => s.annex === 'XVII')).toMatchObject({ inSt: true });
  });
});

describe('Rio de Janeiro: Anexo I do Livro II do RICMS/RJ (F3-26.c.RJ)', () => {
  const rj = ST_REFERENCES.filter((r) => r.uf === 'RJ');

  it('o Anexo I inteiro, com CEST, NCM e a MVA original', () => {
    expect(ST_REFERENCE_UFS).toContain('RJ');
    const itens = rj.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(600);
    for (const item of itens) {
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
      for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
    }
  });

  it('água mineral em vidro: a MVA muda pela embalagem e por quem vende', () => {
    const agua = rj.flatMap((r) => r.items).filter((i) => i.cest === '0300300');
    expect(agua.find((i) => /301 a 500ml, industrial/.test(i.description))).toMatchObject({
      mva: '250',
    });
    expect(agua.find((i) => /301 a 500ml, demais/.test(i.description))).toMatchObject({
      mva: '170',
    });
  });

  it('NCM colado no Word ("2202.10.002202.99.00") vira os dois códigos', () => {
    const refri = rj.flatMap((r) => r.items).find((i) => i.cest === '0301000')!;
    expect(refri.ncms).toEqual(['22021000', '22029900']);
  });

  it('venda porta a porta: "Capítulos 33 e 34" vira os capítulos', () => {
    const outros = rj.flatMap((r) => r.items).find((i) => i.cest === '2805600')!;
    expect(outros).toMatchObject({ ncms: ['33', '34'], mva: '49.39' });
  });
});

describe('Espírito Santo: Portaria 16-R/2019 atualizada (F3-26.d.ES)', () => {
  const es = ST_REFERENCES.filter((r) => r.uf === 'ES');

  it('a redação atual (preta) e não a anterior (verde): limpeza com 70% e 40,88%', () => {
    const itens = es.flatMap((r) => r.items);
    expect(itens.length).toBeGreaterThan(300);
    expect(itens.find((i) => i.cest === '1100100')).toMatchObject({ mva: '70.00' });
    expect(itens.find((i) => i.cest === '1100500')).toMatchObject({ mva: '40.88' });
    // A seção de óleos aparece uma vez só (a redação original de 2020 fica de fora).
    expect(es.filter((r) => r.segment === 'VII')).toHaveLength(1);
  });

  it('já traz a Portaria 30-R/2026: produtos de cereais por expansão com 60%', () => {
    const cereal = stReferencesFor('ES', '19041000', '2026-10-17').find(
      (m) => m.cest === '1703000',
    );
    expect(cereal).toMatchObject({ mva: '60.00' });
  });

  it('itens revogados viram "saiu da ST" com a data da portaria', () => {
    const es2 = ST_SEGMENTS.find((s) => s.uf === 'ES')!;
    const bebidas = es2.annexes.find((a) => a.annex === 'II')!;
    expect(bebidas.cests.find((c) => c.cest === '0300400')).toMatchObject({
      excludedFrom: '2022-09-02',
      excludedBy: 'Portaria 81-R',
    });
  });
});

describe('Alagoas: Decreto 90.309/2023 com as MVAs (F3-26.d.AL)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
  const al = ST_REFERENCES.filter((r) => r.uf === 'AL');

  it('os anexos por segmento, com a MVA-ST original', () => {
    expect(ST_REFERENCE_UFS).toContain('AL');
    expect(al.flatMap((r) => r.items).length).toBeGreaterThan(700);
    const pneu = stReferencesFor('AL', '40111000', '2026-10-17').find((m) => m.cest === '1600100');
    expect(pneu).toMatchObject({ mva: '42' });
  });

  it('o CEST quebrado no PDF ("04.00" + "1.00") é lido inteiro: cigarros com 50%', () => {
    const cigarro = stReferencesFor('AL', '24022000', '2026-10-17').find(
      (m) => m.cest === '0400100',
    );
    expect(cigarro).toMatchObject({ mva: '50' });
  });

  it('salgadinho de trigo saiu da ST em 01/09/2025 (Decreto 103.496/2025)', () => {
    const status = stStatusFor('AL', '19059090', '2026-10-17', ncmsOf).find(
      (s) => s.cest === '1703101',
    );
    expect(status).toMatchObject({
      inSt: false,
      excludedFrom: '2025-09-01',
      excludedBy: 'Decreto 103.496/2025',
    });
    expect(stReferencesFor('AL', '19059090', '2026-10-17').map((m) => m.cest)).not.toContain(
      '1703101',
    );
  });
});

describe('Distrito Federal: Caderno I do Anexo IV do RICMS/DF (F3-26.d.DF)', () => {
  const df = ST_REFERENCES.filter((r) => r.uf === 'DF');
  const linesOf = (cest: string) => df.flatMap((r) => r.items).filter((i) => i.cest === cest);
  const annexOf = (annex: string) =>
    ST_SEGMENTS.find((s) => s.uf === 'DF')!.annexes.find((a) => a.annex === annex)!;
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];

  it('os itens do texto compilado, com a redação até o Decreto 48.865/2026', () => {
    expect(ST_REFERENCE_UFS).toContain('DF');
    expect(ST_SEGMENT_UFS).toContain('DF');
    expect(df.flatMap((r) => r.items).length).toBeGreaterThan(800);
    for (const r of df) expect(r.validFrom).toBe('2026-07-01');
    expect(annexOf('40-I').name).toBe('Chocolates');
  });

  it('MVA fixada no texto do item: cigarros 50%, cimento 20%, veículos 30% e motos 34%', () => {
    expect(linesOf('0400100').map((i) => i.mva)).toEqual(['50', '50']);
    expect(linesOf('0500100').map((i) => i.mva)).toEqual(['20']);
    expect(linesOf('2500100').map((i) => i.mva)).toEqual(['30']);
    expect(linesOf('2600100').map((i) => i.mva)).toEqual(['34']);
  });

  it('tintas: 35% nos subitens 1.0 e 2.0 e 50% no 3.0; o 2.1, fora do subitem 6.3, fica sem MVA', () => {
    expect(linesOf('2400100').map((i) => i.mva)).toEqual(['35']);
    expect(linesOf('2400300').map((i) => i.mva)).toEqual(['50']);
    expect(linesOf('2400200').map((i) => [i.item, i.mva])).toEqual([['2.0', '35']]);
  });

  it('sorvetes pela posição da NCM: 70% no 2105.00 e 328% nos preparados (1806, 1901 e 2106)', () => {
    expect(stReferencesFor('DF', '21050010', '2026-10-22').map((m) => m.mva)).toEqual(['70']);
    expect(stReferencesFor('DF', '21069029', '2026-10-22').map((m) => m.mva)).toContain('328');
    // O 0404 também está no CEST 23.002.00, mas o subitem 22.3 não dá MVA para ele.
    expect(linesOf('2300200')[0]!.ncms).toEqual(['1806', '1901', '2106']);
  });

  it('autopeças: 36,56% com índice de fidelidade e 71,78% nos demais casos, cada uma com o nome', () => {
    const catalisador = linesOf('0100100');
    expect(catalisador.map((i) => i.mva)).toEqual(['36.56', '71.78']);
    expect(catalisador[0]!.description).toMatch(/índice de fidelidade/);
    expect(catalisador[1]!.description).toMatch(/nos demais casos\.$/);
  });

  it('tabelas com MVA da indústria e do atacadista: chocolate branco 41,47% e 32,60%', () => {
    expect(linesOf('1700100').map((i) => [i.item, i.mva])).toEqual([
      ['1.0/I', '41.47'],
      ['1.0/A', '32.60'],
    ]);
    // Água sanitária: a célula repete o número para dois grupos de UF ("55,66 ___ 55,66").
    expect(linesOf('1100100').map((i) => i.mva)).toEqual(['55.66', '44.39']);
    expect(linesOf('1600100').map((i) => i.mva)).toEqual(['42']);
  });

  it('vale a redação nova: o subitem 6.0 do item 38 é dentifrício (26,04%), não óleo essencial', () => {
    expect(linesOf('2002300').map((i) => [i.item, i.mva])).toEqual([
      ['6.0/I', '26.04'],
      ['6.0/A', '17.14'],
    ]);
    expect(annexOf('38').cests.some((c) => c.cest === '2000600')).toBe(false);
  });

  it('subitem revogado sai e o repristinado volta', () => {
    // Telha de fibrocimento (1.0 do item 7, Decreto 42.320/2021) e vinho no item 34 (Decreto 43.938/2022).
    expect(annexOf('7').cests.some((c) => c.cest === '1002300')).toBe(false);
    expect(annexOf('34').cests.some((c) => c.cest === '0202400')).toBe(false);
    expect(annexOf('31').cests.some((c) => c.cest === '0202400')).toBe(true);
    // Corrente de transmissão (109.0 do item 28): revogada em 2020 e repristinada em 2021.
    expect(annexOf('28').cests.some((c) => c.cest === '0111100')).toBe(true);
  });

  it('combustíveis estão na ST, mas sem MVA no texto (PMPF): não viram sugestão', () => {
    expect(stReferencesFor('DF', '27101259', '2026-10-22')).toEqual([]);
    const gasolina = stStatusFor('DF', '27101259', '2026-10-22', ncmsOf).find(
      (s) => s.cest === '0600201',
    );
    expect(gasolina).toMatchObject({ inSt: true, annex: '4' });
  });

  it('a tabela de óleos repetida depois do texto do item 42 não entra no item 42', () => {
    expect(annexOf('42').cests.some((c) => c.cest.startsWith('17'))).toBe(false);
    expect(annexOf('40-VIII').cests.some((c) => c.cest === '1706500')).toBe(true);
  });
});

describe('Acre: Tabela I do Anexo I do RICMS/AC na IN DIAT 1/2023 (F3-26.d.AC)', () => {
  const ac = ST_REFERENCES.filter((r) => r.uf === 'AC');

  it('os segmentos com a MVA original, lida antes dos três multiplicadores', () => {
    expect(ST_REFERENCE_UFS).toContain('AC');
    expect(ac.flatMap((r) => r.items).length).toBeGreaterThan(800);
    expect(ac.every((r) => r.validFrom === '2023-04-01')).toBe(true);
    const lata = stReferencesFor('AC', '22021000', '2026-10-22').find((m) => m.cest === '0301002');
    expect(lata).toMatchObject({ mva: '75' });
    // "45% 15,55% 20,55% 23,55%": a MVA é 45, e não o multiplicador.
    const achocolatado = stReferencesFor('AC', '18069000', '2026-10-22').find(
      (m) => m.cest === '1700600',
    );
    expect(achocolatado).toMatchObject({ mva: '45' });
    const lampada = stReferencesFor('AC', '8539', '2026-10-22').find((m) => m.cest === '0900100');
    expect(lampada).toMatchObject({ mva: '60.03' });
  });

  it('autopeças: as duas MVAs do quadro do segmento (índice de fidelidade e demais casos)', () => {
    const autopecas = ac.find((r) => r.segment === '01')!;
    const catalisador = autopecas.items.filter((i) => i.cest === '0100100');
    expect(catalisador.map((i) => i.mva)).toEqual(['36.56', '71.78']);
    expect(catalisador[0]!.ncms).toEqual(['38151210', '38151290']);
  });

  it('a redação anterior fica de fora e o item revogado sai da ST com a data', () => {
    const bebidas = ac.find((r) => r.segment === '03')!;
    expect(bebidas.items.filter((i) => i.cest === '0301201')).toHaveLength(1);
    const segmento = ST_SEGMENTS.find((s) => s.uf === 'AC')!.annexes.find((a) => a.annex === '03')!;
    expect(segmento.cests.find((c) => c.cest === '0301003')).toMatchObject({
      excludedFrom: '2023-04-01',
      excludedBy: 'Instrução Normativa DIAT 2/2023',
    });
  });
});

describe('Amazonas: Anexos III a XXVI da Lei 6.108/2022 (F3-26.d.AM)', () => {
  const am = ST_REFERENCES.filter((r) => r.uf === 'AM');

  it('um anexo por segmento, lido da versão vigente do SILT', () => {
    expect(ST_REFERENCE_UFS).toContain('AM');
    expect(am.flatMap((r) => r.items).length).toBeGreaterThan(900);
    const refrigerante = stReferencesFor('AM', '22021000', '2026-10-23').find(
      (m) => m.cest === '0301000',
    );
    expect(refrigerante).toMatchObject({ mva: '50' });
    const achocolatado = stReferencesFor('AM', '18069000', '2026-10-23').find(
      (m) => m.cest === '1700600',
    );
    expect(achocolatado).toMatchObject({ mva: '40' });
    const sabao = stReferencesFor('AM', '34012090', '2026-10-23').find((m) => m.cest === '1100200');
    expect(sabao).toMatchObject({ mva: '21' });
  });

  it('autopeças: MVA com e sem índice de fidelidade, desde a Lei 6.222/2023', () => {
    const autopecas = am.find((r) => r.segment === '01')!;
    expect(autopecas.validFrom).toBe('2023-01-01');
    const catalisador = autopecas.items.filter((i) => i.cest === '0100100');
    expect(catalisador.map((i) => i.mva)).toEqual(['36.56', '71.78']);
  });

  it('porta a porta: "Capítulos 13 e 15 a 23" vira a lista de capítulos', () => {
    const porta = am.flatMap((r) => r.items).find((i) => i.cest === '2806200')!;
    expect(porta.ncms).toEqual(['13', '15', '16', '17', '18', '19', '20', '21', '22', '23']);
  });
});

describe('Rondônia: Anexo VI do RICMS/RO (F3-26.d.RO)', () => {
  const ro = ST_REFERENCES.filter((r) => r.uf === 'RO');

  it('os segmentos com a MVA original, com o nome do Convênio ICMS 142/18', () => {
    expect(ST_REFERENCE_UFS).toContain('RO');
    expect(ro.flatMap((r) => r.items).length).toBeGreaterThan(350);
    expect(ro.find((r) => r.segment === '17')!.segmentName).toBe('Produtos alimentícios');
    const autopeca = ro.find((r) => r.segment === '01')!.items[0];
    expect(autopeca).toMatchObject({ cest: '0100100', mva: '35' });
  });

  it('NCM colado na tabela ("2207.202208.40.00") vira os dois códigos', () => {
    const cachaca = ro.flatMap((r) => r.items).find((i) => i.cest === '0200400')!;
    expect(cachaca.ncms).toEqual(['220720', '22084000']);
  });
});

describe('Mato Grosso do Sul: Subanexo I do Anexo III do RICMS/MS (F3-26.d.MS)', () => {
  const ncmsOf = (cest: string) => CESTS.find((c) => c.cest === cest)?.ncm ?? [];
  const ms = ST_REFERENCES.filter((r) => r.uf === 'MS');
  const itens = ms.flatMap((r) => r.items);

  it('a redação atual inteira, com CEST, NCM e a MVA das operações internas', () => {
    expect(ST_REFERENCE_UFS).toContain('MS');
    expect(ST_SEGMENT_UFS).toContain('MS');
    expect(itens.length).toBeGreaterThan(850);
    const cests = new Set(CESTS.map((c) => c.cest));
    for (const item of itens) {
      expect(cests.has(item.cest), item.cest).toBe(true);
      expect(item.mva, item.item).toMatch(/^\d{1,3}(\.\d{1,2})?$/);
      for (const n of item.ncms) expect(n, item.item).toMatch(/^\d{2,8}$/);
    }
    const cimento = stReferencesFor('MS', '25232910', '2026-10-21').find(
      (m) => m.cest === '0500100',
    );
    expect(cimento).toMatchObject({ mva: '20' });
  });

  it('água mineral em vidro: 140% quando vende a indústria (IV-A) e 100% no atacadista (IV-B)', () => {
    const agua = stReferencesFor('MS', '22011000', '2026-10-21').filter(
      (m) => m.cest === '0300300',
    );
    expect(agua.find((m) => /industrial/.test(m.segmentName))).toMatchObject({ mva: '140' });
    expect(agua.find((m) => /atacadista/.test(m.segmentName))).toMatchObject({ mva: '100' });
  });

  it('medicamentos pela lista do PIS/COFINS: referência negativa com 19,75%', () => {
    expect(itens.find((i) => i.cest === '1300101')).toMatchObject({
      ncms: ['3003', '3004'],
      mva: '19.75',
    });
  });

  it('venda porta a porta: "Capítulos 13 e 15 a 23" vira os capítulos, faixa expandida', () => {
    const alimentos = itens.find((i) => i.cest === '2806200')!;
    expect(alimentos).toMatchObject({ mva: '37.63' });
    expect(alimentos.ncms).toEqual(['13', '15', '16', '17', '18', '19', '20', '21', '22', '23']);
  });

  it('combustíveis estão na ST, mas sem MVA na tabela (PMPF): não viram sugestão', () => {
    expect(itens.some((i) => i.cest.startsWith('06'))).toBe(false);
    const gasolina = stStatusFor('MS', '27101259', '2026-10-21', ncmsOf).find(
      (s) => s.cest === '0600200',
    );
    expect(gasolina).toMatchObject({ inSt: true, annex: 'VII' });
  });

  it('papelaria saiu da ST em 01/08/2024 (Decreto 16.467/2024), lista da redação anterior', () => {
    const guache = stStatusFor('MS', '32131000', '2026-10-21', ncmsOf).find(
      (s) => s.cest === '1900100',
    );
    expect(guache).toMatchObject({
      inSt: false,
      excludedFrom: '2024-08-01',
      excludedBy: 'Decreto 16.467/2024',
    });
    expect(
      stStatusFor('MS', '32131000', '2024-07-31', ncmsOf).find((s) => s.cest === '1900100'),
    ).toMatchObject({ inSt: true });
  });

  it('eletrônicos saíram em 01/04/2025, menos as luminárias repristinadas (itens 122 a 125)', () => {
    const freezer = stStatusFor('MS', '84181000', '2026-10-21', ncmsOf).find(
      (s) => s.cest === '2100200',
    );
    expect(freezer).toMatchObject({
      inSt: false,
      excludedFrom: '2025-04-01',
      excludedBy: 'Decreto 16.584/2025',
    });
    const luminaria = stReferencesFor('MS', '94051100', '2026-10-21').find(
      (m) => m.cest === '2112300',
    );
    expect(luminaria).toMatchObject({ mva: '38', validFrom: '2025-04-01' });
  });
});

describe('Pernambuco: Anexo 37 do RICMS/PE (F3-26.d.PE)', () => {
  const pe = ST_REFERENCES.filter((r) => r.uf === 'PE');
  const mvaOf = (cest: string) =>
    pe.flatMap((r) => r.items).find((i) => i.cest === cest)?.mva ?? null;

  it('capítulos com a MVA no artigo e as tabelas 37-A a 37-C, ligados ao CEST', () => {
    expect(ST_REFERENCE_UFS).toContain('PE');
    expect(ST_SEGMENT_UFS).toContain('PE');
    expect(pe.flatMap((r) => r.items).length).toBeGreaterThan(300);
    // Lâmina de barbear, item 64.0 do Anexo XIX do Convênio: 30% (art. 36).
    expect(mvaOf('2006400')).toBe('30');
    // Lâmpadas: uma MVA por item (art. 38): eletrônica 102,31%.
    expect(mvaOf('0900200')).toBe('102,31');
    // Smartphone 5%, os demais eletrônicos 20% (art. 76).
    expect(mvaOf('2105300')).toBe('5');
    expect(mvaOf('2100100')).toBe('20');
    // Henna, item 1.0 do Anexo 37-A: 76,45%.
    expect(mvaOf('2000100')).toBe('76,45');
  });

  it('pneus: bicicleta pelo art. 50 e veículo pelo art. 54; o item fora dos dois não entra', () => {
    expect(mvaOf('1600500')).toBe('105');
    expect(mvaOf('1600100')).toBe('42');
    expect(mvaOf('1600600')).toBeNull();
  });

  it('vale a redação atual: andaime (48.0 do Anexo 37-C) com 39%, não os 65% de antes', () => {
    expect(mvaOf('1004800')).toBe('39');
  });

  it('capítulos de pauta, PMC ou MVA por remetente ficam de fora (falta configurar)', () => {
    // Medicamentos (PMC da CMED), água e refrigerante (preço do ato da Sefaz), autopeças.
    expect(stReferencesFor('PE', '30049099', '2026-10-18')).toEqual([]);
    expect(stReferencesFor('PE', '22021000', '2026-10-18')).toEqual([]);
  });
});

describe('Ceará: veículos novos do RICMS/CE de 1997 (F3-26.d.CE)', () => {
  const ce = ST_REFERENCES.filter((r) => r.uf === 'CE');
  const itemOf = (cest: string) => ce.flatMap((r) => r.items).find((i) => i.cest === cest);

  it('os CEST do caput do art. 561 com a MVA-ST original do art. 562', () => {
    expect(ST_REFERENCE_UFS).toContain('CE');
    expect(ST_SEGMENT_UFS).toContain('CE');
    // 25.001.00 a 25.029.00 e 26.001.00 e 26.001.01: 31 CEST.
    expect(ce.flatMap((r) => r.items)).toHaveLength(31);
    // § 3º: veículos do caput, menos as motos, 30%.
    expect(itemOf('2500100')?.mva).toBe('30');
    expect(itemOf('2502900')?.mva).toBe('30');
    // § 4º: CEST 26.001.00 e 26.001.01, 34%.
    expect(itemOf('2600100')?.mva).toBe('34');
    expect(itemOf('2600101')?.mva).toBe('34');
    // O que não está no caput (25.030.00 em diante) fica de fora.
    expect(itemOf('2503000')).toBeUndefined();
  });

  it('o CEST 26.001.01 só entra com o Decreto 35.579 (DOE de 19/10/2026)', () => {
    const since = (cest: string) => ce.find((r) => r.items.some((i) => i.cest === cest))?.validFrom;
    expect(since('2500100')).toBe('2018-01-01');
    expect(since('2600100')).toBe('2018-01-01');
    expect(since('2600101')).toBe('2026-10-19');
    expect(stReferencesFor('CE', '87032100', '2026-10-22').map((m) => m.mva)).toEqual(['30']);
  });

  it('o resto da ST do Ceará não vira sugestão (carga líquida por CNAE, MVA só por segmento)', () => {
    // Medicamentos (Decreto 36.617/2025, carga líquida) e lâmpadas (IN 43/2017, sem CEST).
    expect(stReferencesFor('CE', '30049099', '2026-10-22')).toEqual([]);
    expect(stReferencesFor('CE', '85395200', '2026-10-22')).toEqual([]);
  });
});

describe('Mato Grosso: Portaria 195/2019-SEFAZ/MT (F3-26.d.MT)', () => {
  const mt = ST_REFERENCES.filter((r) => r.uf === 'MT');
  const linesOf = (cest: string) => mt.flatMap((r) => r.items).filter((i) => i.cest === cest);

  it('duas MVAs por CEST: a do Anexo Único (crédito outorgado) e a do art. 2º-B (demais)', () => {
    expect(ST_REFERENCE_UFS).toContain('MT');
    const catalisador = linesOf('0100100');
    expect(catalisador.map((i) => i.mva)).toEqual(['50,39', '65,29']);
    expect(catalisador[0]!.description).toMatch(/crédito outorgado/);
    expect(catalisador[1]!.description).toMatch(/art\. 2º-B/);
  });

  it('vale a redação atual: água sanitária com 38,14% (Portaria 161/2022), não os 59,64%', () => {
    expect(linesOf('1100100')[0]!.mva).toBe('38,14');
    // Massas instantâneas: 33,69% (Portaria 143/2022); a redação original de 45,52% fica de fora.
    expect(linesOf('1704701')[0]!.mva).toBe('33,69');
  });

  it('porta a porta só da tabela XX (a XIX antiga, de antes da renumeração, fica de fora)', () => {
    expect(linesOf('2800100').filter((i) => i.item.endsWith('/1'))).toHaveLength(1);
  });
});

describe('Pará, Piauí e Sergipe: Portal Nacional da ST do CONFAZ (F3-26.d)', () => {
  const linesOf = (uf: string, cest: string) =>
    ST_REFERENCES.filter((r) => r.uf === uf)
      .flatMap((r) => r.items)
      .filter((i) => i.cest === cest);

  it('a MVA das operações internas declarada pela UF, sem as ajustadas', () => {
    for (const uf of ['PA', 'PI', 'SE']) expect(ST_REFERENCE_UFS).toContain(uf);
    expect(linesOf('PA', '0900200').map((i) => i.mva)).toEqual(['102,31']);
    expect(linesOf('SE', '1600100').map((i) => i.mva)).toEqual(['42']);
    // Piauí tem MVA própria nas autopeças: 40% e 26,5% com índice de fidelidade.
    expect(linesOf('PI', '0100100').map((i) => i.mva)).toEqual(['40', '26,5']);
  });

  it('duas MVAs viram duas linhas, com o rótulo da planilha', () => {
    const catalisador = linesOf('PA', '0100100');
    expect(catalisador.map((i) => i.description)).toEqual([
      expect.stringMatching(/Regra Geral$/),
      expect.stringMatching(/Índice Fidelização$/),
    ]);
  });

  it('aba repetida por engano (a "Farinha de trigo" do PI copia as lâmpadas) entra uma vez', () => {
    expect(linesOf('PI', '0900200')).toHaveLength(1);
  });

  it('aba só com preço (pauta/PFC) ou sem a MVA interna fica de fora', () => {
    // Sergipe: águas e bebidas frias vão por preço (PFC); alimentícios não têm a coluna interna.
    expect(linesOf('SE', '0300100')).toEqual([]);
    expect(linesOf('SE', '1704400')).toEqual([]);
  });
});
