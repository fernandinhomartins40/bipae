import { describe, expect, it } from 'vitest';
import {
  CBENEF_TABLES,
  CBENEF_UFS,
  cbenefLookup,
  cbenefSuggestions,
  isPresumedCredit,
} from './cbenef';

/** F3-27.b: códigos de benefício fiscal da tabela oficial da UF. */

describe('cBenef do Paraná (tabela oficial por CST, V27)', () => {
  const pr = CBENEF_TABLES.find((t) => t.uf === 'PR')!;

  it('a tabela inteira, com os CST de cada código', () => {
    expect(CBENEF_UFS).toContain('PR');
    expect(pr.codes.length).toBeGreaterThan(450);
    for (const c of pr.codes) {
      expect(c.code, c.code).toMatch(/^(PR\d{6}|SEM CBENEF)$/);
      for (const cst of c.csts) expect(cst, c.code).toMatch(/^\d{2}$/);
    }
    expect(pr.codes.find((c) => c.code === 'PR800001')).toMatchObject({
      csts: ['41'],
      from: '2018-08-01',
    });
  });

  it('código de julho de 2026: isenção do item 74-A do Anexo V, CST 30 e 40', () => {
    const r = cbenefLookup('pr', 'pr810205', '2026-10-17', '40');
    expect(r).toMatchObject({ covered: true, valid: true, cstOk: true });
    expect(r.entry!.description).toMatch(/74-A do Anexo V/);
    expect(cbenefLookup('PR', 'PR810205', '2026-07-05').valid).toBe(false);
    expect(cbenefLookup('PR', 'PR810205', '2026-10-17', '00').cstOk).toBe(false);
  });

  it('código encerrado não vale depois do fim; código inexistente e UF sem tabela', () => {
    const encerrado = pr.codes.find((c) => c.to)!;
    const depois = new Date(`${encerrado.to}T12:00:00Z`);
    depois.setUTCDate(depois.getUTCDate() + 1);
    expect(cbenefLookup('PR', encerrado.code, depois.toISOString().slice(0, 10)).valid).toBe(false);
    expect(cbenefLookup('PR', 'PR999999', '2026-10-17')).toMatchObject({
      covered: true,
      entry: null,
    });
    expect(cbenefLookup('MA', 'MA000001', '2026-10-17')).toMatchObject({
      covered: false,
      entry: null,
    });
  });

  it('sugere os códigos que valem para o CST, com busca na descrição', () => {
    const isencoes = cbenefSuggestions('PR', '40', '2026-10-17', 'isenção');
    expect(isencoes.length).toBeGreaterThan(50);
    expect(isencoes.every((c) => c.csts.includes('40'))).toBe(true);
    expect(cbenefSuggestions('MA', '40', '2026-10-17')).toEqual([]);
  });
});

describe('cBenef de Santa Catarina (Tabela 5.2A)', () => {
  const sc = CBENEF_TABLES.find((t) => t.uf === 'SC')!;

  it('a tabela com o tipo do benefício e os CST', () => {
    expect(CBENEF_UFS).toContain('SC');
    expect(sc.codes.length).toBeGreaterThan(600);
    expect(sc.codes.find((c) => c.code === 'SC820003')).toMatchObject({
      csts: ['20', '70'],
      kind: 'Redução da Base de Cálculo',
      from: '2023-05-01',
    });
    expect(sc.codes.find((c) => c.code === 'SC820003')!.description).toMatch(
      /tijolo, telha, tubo e manilha/,
    );
  });

  it('crédito presumido não leva CST: vai no cCredPresumido, não no cBenef', () => {
    const credito = sc.codes.find((c) => c.code === 'SC850001')!;
    expect(isPresumedCredit(credito)).toBe(true);
    expect(credito.csts).toEqual([]);
    expect(isPresumedCredit(sc.codes.find((c) => c.code === 'SC820003')!)).toBe(false);
  });

  it('isenções valem para os CST de isenção', () => {
    const isencoes = sc.codes.filter((c) => c.kind === 'Isenção');
    expect(isencoes.length).toBeGreaterThan(200);
    expect(isencoes.every((c) => c.csts.length > 0)).toBe(true);
  });
});

describe('cBenef do Rio Grande do Sul (Tabela cBenef x CST)', () => {
  it('a planilha inteira, com a descrição legível e a referência legal', () => {
    expect(CBENEF_UFS).toContain('RS');
    const r = cbenefLookup('RS', 'RS051001', '2026-10-17', '40');
    expect(r).toMatchObject({ covered: true, valid: true, cstOk: true });
    expect(r.entry!.description).toMatch(/^ISENÇÃO - Saídas de reprodutores ou matrizes/);
    expect(r.entry!.from).toBe('2016-10-01');
  });

  it('a data de fim vem da planilha: insumos agropecuários até 31/12/2027', () => {
    expect(cbenefLookup('RS', 'RS051007', '2027-12-31').valid).toBe(true);
    expect(cbenefLookup('RS', 'RS051007', '2028-01-01').valid).toBe(false);
  });
});

describe('cBenef de Goiás (IN 1.518/2022-GSE)', () => {
  it('a tabela com o dispositivo legal; a redação mais nova vence', () => {
    expect(CBENEF_UFS).toContain('GO');
    const r = cbenefLookup('GO', 'GO800001', '2026-10-17', '41');
    expect(r).toMatchObject({ covered: true, valid: true, cstOk: true });
    expect(r.entry!.description).toMatch(/NÃO INCIDÊNCIA DO ICMS.*RCTE, Art 79/);
  });

  it('código revogado vale só até a data da nota (21/06/2023)', () => {
    expect(cbenefLookup('GO', 'GO811023', '2023-06-21').valid).toBe(true);
    expect(cbenefLookup('GO', 'GO811023', '2026-10-17').valid).toBe(false);
  });
});

describe('cBenef do Espírito Santo (cBenef ES V6)', () => {
  it('a planilha com a vigência em número de série do Excel e o tipo do benefício', () => {
    expect(CBENEF_UFS).toContain('ES');
    const r = cbenefLookup('ES', 'ES120001', '2026-10-17', '40');
    expect(r).toMatchObject({ covered: true, valid: true, cstOk: true });
    expect(r.entry).toMatchObject({ from: '2016-07-01', to: '2032-12-31' });
    expect(r.entry!.description).toMatch(/INVEST-ES/);
    expect(cbenefLookup('ES', 'ES120001', '2033-01-01').valid).toBe(false);
  });
});

describe('cBenef de São Paulo (Tabela CST x cBenef)', () => {
  it('a planilha com o dispositivo e a descrição; SEM CBENEF não vale mais desde 01/07/2026', () => {
    expect(CBENEF_UFS).toContain('SP');
    const r = cbenefLookup('SP', 'SP099009', '2026-10-17', '40');
    expect(r).toMatchObject({ covered: true, valid: true, cstOk: true });
    expect(r.entry!.description).toMatch(/Nota Fiscal Fácil/);
    expect(cbenefLookup('SP', 'SEM CBENEF', '2026-06-30').valid).toBe(true);
    expect(cbenefLookup('SP', 'SEM CBENEF', '2026-07-01').valid).toBe(false);
  });

  it('"Vigorou até" encerra o código na data', () => {
    expect(cbenefLookup('SP', 'SP010340', '2026-04-30').valid).toBe(true);
    expect(cbenefLookup('SP', 'SP010340', '2026-05-01').valid).toBe(false);
  });
});
