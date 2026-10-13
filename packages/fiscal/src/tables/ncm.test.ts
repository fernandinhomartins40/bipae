import { describe, expect, it } from 'vitest';
import { assertValidity } from '../validity';
import data from './data/ncm.json';
import {
  NCM_TABLE_INFO,
  findNcm,
  isNcmValidOn,
  ncmPath,
  ncmValidity,
  normalizeNcm,
  searchNcm,
} from './ncm';

describe('tabela de NCM', () => {
  const linhas = data.items as string[][];

  it('traz a tabela vigente do Siscomex, sem repetição e com vigência válida', () => {
    expect(NCM_TABLE_INFO.updatedAt).toMatch(/^Vigente em \d{2}\/\d{2}\/\d{4}$/);
    expect(NCM_TABLE_INFO.act).not.toBe('');
    expect(linhas.filter((l) => l[0]!.length === 8).length).toBeGreaterThan(10_000);
    expect(new Set(linhas.map((l) => l[0])).size).toBe(linhas.length);
    for (const linha of linhas) {
      expect(linha[0]).toMatch(/^(\d{2}|\d{4,8})$/);
      expect(linha[1], linha[0]).not.toBe('');
      expect(linha[1], linha[0]).not.toMatch(/<|^-/);
      assertValidity({ start: linha[2]!, ...(linha[3] !== undefined && { end: linha[3] }) });
    }
  });

  it('acha o NCM com ou sem pontos', () => {
    expect(normalizeNcm(' 2203.00.00 ')).toBe('22030000');
    expect(findNcm('22030000')).toEqual({
      code: '22030000',
      description: 'Cervejas de malte.',
      start: '2022-04-01',
    });
    expect(findNcm('2203.00.00')?.code).toBe('22030000');
  });

  it('só aceita no produto um NCM completo que exista na tabela', () => {
    expect(findNcm('99999999')).toBeNull();
    expect(findNcm('1006')).toBeNull();
    expect(findNcm('abc')).toBeNull();
    expect(findNcm('')).toBeNull();
  });

  it('diz se o NCM vale na data', () => {
    const cerveja = findNcm('22030000')!;
    expect(isNcmValidOn(cerveja, '2026-10-13')).toBe(true);
    expect(isNcmValidOn(cerveja, '2022-03-31')).toBe(false);
    const extinto = { ...cerveja, end: '2027-01-01' };
    expect(ncmValidity(extinto)).toEqual({ start: '2022-04-01', end: '2027-01-01' });
    expect(isNcmValidOn(extinto, '2026-12-31')).toBe(true);
    expect(isNcmValidOn(extinto, '2027-01-01')).toBe(false);
  });

  it('monta o caminho do capítulo até o código', () => {
    expect(ncmPath('1006.30.21').map((n) => [n.code, n.description])).toEqual([
      ['10', expect.any(String)],
      ['1006', 'Arroz.'],
      ['100630', 'Arroz semibranqueado ou branqueado, mesmo polido ou brunido (glaciado*)'],
      ['1006302', 'Não parboilizado'],
      ['10063021', 'Polido ou brunido'],
    ]);
    expect(ncmPath('10').map((n) => n.code)).toEqual(['10']);
    expect(ncmPath('99999999')).toEqual([]);
  });

  it('busca pelo começo do código', () => {
    const achados = searchNcm('1006.30');
    expect(achados.length).toBeGreaterThan(1);
    expect(achados.every((n) => n.code.startsWith('100630') && n.code.length === 8)).toBe(true);
    expect(searchNcm('1006', 2)).toHaveLength(2);
  });

  it('busca por palavras, sem acento, em qualquer nível do caminho', () => {
    expect(searchNcm('arroz polido').map((n) => n.code)).toContain('10063021');
    expect(searchNcm('CERVEJAS malte').map((n) => n.code)).toEqual(['22030000']);
    expect(searchNcm('nao parboilizado arroz').map((n) => n.code)).toContain('10063021');
    expect(searchNcm('palavraquenaoexiste')).toEqual([]);
  });

  it('busca vazia ou sem limite não devolve nada', () => {
    expect(searchNcm('   ')).toEqual([]);
    expect(searchNcm('arroz', 0)).toEqual([]);
  });
});
