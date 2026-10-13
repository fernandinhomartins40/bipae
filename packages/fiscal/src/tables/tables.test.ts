import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dec } from '../decimal';
import { assertDate, assertValidity, overlaps } from '../validity';
import {
  CBS_PUBLISHED_RATES,
  CFOPS,
  CLASS_TRIBS,
  CSTS_IBS_CBS,
  FCP_BY_UF,
  REFERENCE_RATES,
  TABLE_SOURCES,
  TP_DOACAO,
  TP_RBSN,
  cfopGroup,
  cfopValidity,
  classTribsOf,
  classTribStatus,
  findCfop,
  findClassTrib,
  findCstIbsCbs,
  findFcp,
  isCfopValidOn,
  referenceRates,
} from './index';

const pacote = (caminho: string) => fileURLToPath(new URL(`../../${caminho}`, import.meta.url));

describe('origem das tabelas', () => {
  it('cada tabela aponta para um arquivo oficial guardado, com o mesmo hash', () => {
    for (const fonte of Object.values(TABLE_SOURCES)) {
      const hash = createHash('sha256').update(readFileSync(pacote(`sources/${fonte.file}`))).digest('hex');
      expect(hash, fonte.file).toBe(fonte.sha256);
      // Só fontes oficiais: Portal Nacional da NF-e, Siscomex, SEFAZ Virtual do RS, CONFAZ e o
      // Portal Nacional da NFC-e, mantido pelo ENCAT (os coordenadores tributários das SEFAZ).
      expect(fonte.page).toMatch(
        /^https:\/\/(((www|hom)\.nfe\.fazenda|portalunico\.siscomex|dfe-portal\.svrs\.rs|www\.confaz\.fazenda)\.gov\.br|nfce\.encat\.org|www\.gov\.br\/iti)\//,
      );
      assertDate(fonte.publishedAt);
      assertDate(fonte.downloadedAt);
    }
  });

  it('os dados gerados estão em dia com as planilhas', () => {
    const saida = execFileSync(process.execPath, [pacote('scripts/import-tables.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(saida).toContain('em dia');
  });
});

describe('tabela de CFOP', () => {
  it('traz os códigos sem repetição e com vigência válida', () => {
    expect(CFOPS.length).toBeGreaterThan(600);
    expect(new Set(CFOPS.map((c) => c.code)).size).toBe(CFOPS.length);
    for (const cfop of CFOPS) {
      expect(cfop.title, cfop.code).not.toBe('');
      assertValidity(cfopValidity(cfop));
      expect(cfopGroup(cfop.code), cfop.code).not.toBeNull();
      expect([0, 1, 2]).toContain(cfop.fuel);
    }
  });

  it('acha um código e diz se vale na data', () => {
    const venda = findCfop('5102')!;
    expect(venda.title).toMatch(/^Venda de mercadoria adquirida ou recebida de terceiros/);
    expect(venda.nfe).toBe(true);
    expect(venda.devolution).toBe(false);
    expect(isCfopValidOn(venda, '2026-10-13')).toBe(true);
    expect(isCfopValidOn(venda, '2005-12-31')).toBe(false);
    expect(findCfop('9999')).toBeNull();
  });

  it('respeita o fim de vigência quando a tabela trouxer um', () => {
    const encerrado = { ...findCfop('5102')!, end: '2030-01-01' };
    expect(cfopValidity(encerrado)).toEqual({ start: '2006-01-01', end: '2030-01-01' });
    expect(isCfopValidOn(encerrado, '2029-12-31')).toBe(true);
    expect(isCfopValidOn(encerrado, '2030-01-01')).toBe(false);
  });

  it('marca devoluções e separa entrada de saída pelo primeiro dígito', () => {
    expect(findCfop('1202')!.devolution).toBe(true);
    expect(cfopGroup('1202')).toEqual({ direction: 'entrada', scope: 'interna' });
    expect(cfopGroup('2102')).toEqual({ direction: 'entrada', scope: 'interestadual' });
    expect(cfopGroup('3102')).toEqual({ direction: 'entrada', scope: 'exterior' });
    expect(cfopGroup('5102')).toEqual({ direction: 'saida', scope: 'interna' });
    expect(cfopGroup('6102')).toEqual({ direction: 'saida', scope: 'interestadual' });
    expect(cfopGroup('7102')).toEqual({ direction: 'saida', scope: 'exterior' });
    expect(cfopGroup('4102')).toBeNull();
    expect(cfopGroup('51')).toBeNull();
  });
});

describe('CST e cClassTrib do IBS e da CBS', () => {
  it('toda classificação pertence a um CST da tabela e começa pelo código dele', () => {
    expect(CSTS_IBS_CBS.length).toBeGreaterThanOrEqual(18);
    expect(CLASS_TRIBS.length).toBeGreaterThanOrEqual(170);
    expect(new Set(CLASS_TRIBS.map((c) => c.cClassTrib)).size).toBe(CLASS_TRIBS.length);
    for (const item of CLASS_TRIBS) {
      expect(findCstIbsCbs(item.cst), item.cClassTrib).not.toBeNull();
      expect(item.cClassTrib.startsWith(item.cst), item.cClassTrib).toBe(true);
      assertDate(item.start);
      expect(TP_RBSN[item.tpRBSN], item.cClassTrib).toBeDefined();
      expect(TP_DOACAO[item.tpDoacao], item.cClassTrib).toBeDefined();
      for (const reducao of [item.pRedIBS, item.pRedCBS]) {
        expect(dec(reducao).greaterThanOrEqualTo(0) && dec(reducao).lessThanOrEqualTo(100)).toBe(true);
      }
    }
  });

  it('acha a tributação integral e uma alíquota reduzida a zero', () => {
    const integral = findClassTrib('000001')!;
    expect(integral).toMatchObject({ cst: '000', pRedIBS: '0', pRedCBS: '0', rateType: 'Padrão' });
    expect(integral.documents.nfce).toBe(true);
    expect(findCstIbsCbs('000')).toMatchObject({ description: 'Tributação integral' });
    expect(findCstIbsCbs('000')!.groups.ibsCbs).toBe(true);

    const cestaBasica = findClassTrib('200003')!;
    expect(cestaBasica).toMatchObject({ cst: '200', pRedIBS: '100', pRedCBS: '100', law: 'Art. 125' });
    expect(cestaBasica.lawUrl).toContain('planalto.gov.br');

    expect(findClassTrib('999999')).toBeNull();
    expect(findCstIbsCbs('999')).toBeNull();
    expect(classTribsOf('000').map((c) => c.cClassTrib)).toContain('000001');
    expect(classTribsOf('999')).toEqual([]);
  });

  it('diz a situação na data, sem decidir o que a tabela deixa em aberto (D-016)', () => {
    const integral = findClassTrib('000001')!;
    expect(classTribStatus(integral, '2025-12-31')).toBe('fora-da-vigencia');
    expect(classTribStatus(integral, '2026-01-01')).toBe('vigente');
    expect(classTribStatus(integral, '2033-01-01')).toBe('vigente');

    const comFim = { ...integral, end: '2027-01-01' };
    expect(classTribStatus(comFim, '2026-12-31')).toBe('vigente');
    expect(classTribStatus(comFim, '2027-01-01')).toBe('vigencia-indefinida');
    expect(classTribStatus(comFim, '2027-01-02')).toBe('fora-da-vigencia');

    // Códigos publicados com início e fim no mesmo dia: nunca "vigente" sem confirmação.
    const mesmoDia = CLASS_TRIBS.filter((c) => c.end !== undefined && c.end <= c.start);
    for (const item of mesmoDia) {
      expect(classTribStatus(item, item.start), item.cClassTrib).toBe('vigencia-indefinida');
    }
  });
});

describe('alíquotas de referência', () => {
  it('cada alíquota tem fonte, vigência válida e não cruza com outra do mesmo ente', () => {
    for (const rate of REFERENCE_RATES) {
      assertValidity(rate.validity);
      expect(rate.source).toMatch(/LC 214\/2025, art\. \d+/);
      expect(rate.url).toContain('planalto.gov.br');
      expect(dec(rate.rate).greaterThanOrEqualTo(0)).toBe(true);
    }
    expect(new Set(REFERENCE_RATES.map((r) => r.id)).size).toBe(REFERENCE_RATES.length);
    for (const a of REFERENCE_RATES) {
      for (const b of REFERENCE_RATES) {
        if (a.id < b.id && a.tax === b.tax && a.sphere === b.sphere) {
          expect(overlaps(a.validity, b.validity), `${a.id} × ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('a CBS da lei bate com a tabela publicada no Portal da NF-e', () => {
    for (const publicada of CBS_PUBLISHED_RATES) {
      const emVigor = referenceRates('CBS', `${publicada.year}-07-01`);
      if (publicada.rate === null) {
        // Ano que o portal marca como "aguarda legislação": não pode haver número na tabela.
        expect(emVigor, String(publicada.year)).toEqual([]);
        expect(publicada.note).toBeTruthy();
      } else {
        expect(emVigor.map((r) => r.rate), String(publicada.year)).toEqual([publicada.rate]);
      }
    }
    expect(CBS_PUBLISHED_RATES.find((r) => r.year === 2026)?.rate).toBe('0.9');
  });

  it('o IBS de teste é 0,1% em 2026 e se divide entre estado e município em 2027–2028', () => {
    expect(referenceRates('IBS', '2026-06-15').map((r) => [r.sphere, r.rate])).toEqual([
      ['estadual', '0.1'],
      ['municipal', '0'],
    ]);
    const em2027 = referenceRates('IBS', '2027-01-01');
    expect(em2027.map((r) => r.sphere).sort()).toEqual(['estadual', 'municipal']);
    expect(em2027.reduce((soma, r) => soma.plus(dec(r.rate)), dec(0)).toString()).toBe('0.1');
    expect(referenceRates('IBS', '2029-01-01')).toEqual([]);
    expect(referenceRates('IBS', '2025-12-31')).toEqual([]);
  });
});

describe('FCP por UF', () => {
  it('traz as 27 UFs, cada uma com suas alíquotas', () => {
    expect(FCP_BY_UF).toHaveLength(27);
    expect(new Set(FCP_BY_UF.map((f) => f.uf)).size).toBe(27);
    for (const item of FCP_BY_UF) {
      expect(['fixed', 'max']).toContain(item.kind);
      expect(item.rates.length, item.uf).toBeGreaterThan(0);
      for (const rate of item.rates) expect(dec(rate).greaterThanOrEqualTo(0)).toBe(true);
    }
  });

  it('distingue alíquota fixa de teto', () => {
    expect(findFcp('SP')).toMatchObject({ cUF: '35', kind: 'fixed', rates: ['2.00'] });
    expect(findFcp('RJ')).toMatchObject({ kind: 'max', rates: ['4.00'] });
    expect(findFcp('SC')).toMatchObject({ kind: 'fixed', rates: ['0.00'] });
    expect(findFcp('XX')).toBeNull();
  });
});
