import { describe, expect, it } from 'vitest';
import { dec } from '../decimal';
import { COMPANY_REGIMES, findCompanyRegime } from '../regimes';
import { assertDate } from '../validity';
import { FCP_BY_UF } from './rates';
import {
  ICMS_GENERAL_RATES,
  ICMS_RATES_CHECKED_AT,
  UFS,
  icmsGeneralRate,
  interstateRate,
} from './icms-uf';

describe('alíquota geral do ICMS por UF', () => {
  it('nenhuma das 27 UFs fica de fora', () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    // A mesma lista da tabela oficial de FCP do Portal da NF-e.
    expect([...UFS].sort()).toEqual(FCP_BY_UF.map((f) => f.uf).sort());
    assertDate(ICMS_RATES_CHECKED_AT);
  });

  it('só tem número a UF confirmada em fonte oficial; as outras explicam o que falta', () => {
    for (const item of ICMS_GENERAL_RATES) {
      expect(item.law, item.uf).not.toBe('');
      expect(item.url, item.uf).toMatch(/^https?:\/\//);
      if (item.status === 'confirmado') {
        expect(item.rate, item.uf).toBeDefined();
        const rate = dec(item.rate!);
        expect(rate.greaterThanOrEqualTo(17) && rate.lessThanOrEqualTo(25), item.uf).toBe(true);
        // Fonte oficial: governo, Assembleia ou Judiciário (STF), ou o portal nacional.
        expect(item.url, item.uf).toMatch(/\.gov\.br|\.leg\.br|\.jus\.br/);
      } else {
        expect(item.rate, item.uf).toBeUndefined();
        expect(item.note, item.uf).toContain('D-021');
      }
    }
  });

  it('o retrato de 16/10/2026: as 27 UFs confirmadas em fonte oficial (dúvida D-021)', () => {
    const conta = (status: string) => ICMS_GENERAL_RATES.filter((i) => i.status === status).map((i) => i.uf);
    expect(conta('confirmado')).toHaveLength(27);
    expect(conta('pendente')).toEqual([]);
    expect(conta('divergente')).toEqual([]);
  });

  it('consulta por sigla', () => {
    expect(icmsGeneralRate('SP')).toMatchObject({ status: 'confirmado', rate: '18' });
    expect(icmsGeneralRate('BA')).toMatchObject({ rate: '20.5' });
    expect(icmsGeneralRate('AL')).toMatchObject({ status: 'confirmado', rate: '20.5' });
    expect(icmsGeneralRate('AP')).toMatchObject({ status: 'confirmado', rate: '18' });
    expect(icmsGeneralRate('XX')).toBeNull();
  });
});

describe('alíquota interestadual do ICMS', () => {
  it('7% do Sul e do Sudeste (menos o ES) para as demais UFs', () => {
    expect(interstateRate('SP', 'BA')).toMatchObject({ rate: '7', reason: 'sul-sudeste-para-demais' });
    expect(interstateRate('RS', 'ES').rate).toBe('7');
    expect(interstateRate('MG', 'GO').rate).toBe('7');
  });

  it('12% nos demais casos', () => {
    expect(interstateRate('SP', 'RJ')).toMatchObject({ rate: '12', reason: 'geral' });
    expect(interstateRate('BA', 'SP').rate).toBe('12');
    expect(interstateRate('ES', 'SP').rate).toBe('12');
    expect(interstateRate('ES', 'BA').rate).toBe('12');
    expect(interstateRate('GO', 'AM').rate).toBe('12');
  });

  it('4% para mercadoria importada, qualquer que seja o caminho', () => {
    expect(interstateRate('SP', 'BA', { imported: true })).toMatchObject({ rate: '4', reason: 'importado' });
    expect(interstateRate('BA', 'SP', { imported: true }).rate).toBe('4');
    expect(interstateRate('SP', 'BA').source).toContain('Senado Federal');
  });

  it('recusa UF inválida e operação dentro da mesma UF', () => {
    expect(() => interstateRate('SP', 'XX')).toThrow('UF inválida');
    expect(() => interstateRate('XX', 'SP')).toThrow('UF inválida');
    expect(() => interstateRate('SP', 'SP')).toThrow('mesma UF');
  });

  it('toda combinação de UFs diferentes tem alíquota', () => {
    for (const origem of UFS) {
      for (const destino of UFS) {
        if (origem === destino) continue;
        expect(['7', '12'], `${origem}→${destino}`).toContain(interstateRate(origem, destino).rate);
      }
    }
  });
});

describe('regimes de empresa', () => {
  it('cobre do MEI ao Lucro Real, cada um com o seu CRT', () => {
    expect(COMPANY_REGIMES.map((r) => [r.id, r.crt])).toEqual([
      ['mei', 4],
      ['simples', 1],
      ['simples-excesso', 2],
      ['presumido', 3],
      ['real', 3],
    ]);
    for (const regime of COMPANY_REGIMES) {
      expect(regime.label).not.toBe('');
      expect(regime.hint).not.toBe('');
      expect(regime.source).not.toBe('');
    }
  });

  it('diz se o ICMS usa CSOSN ou CST e de onde vêm o PIS e a COFINS', () => {
    expect(findCompanyRegime('mei')).toMatchObject({ icmsCode: 'csosn', pisCofins: 'das', taxRegime: 'simples' });
    expect(findCompanyRegime('simples')).toMatchObject({ icmsCode: 'csosn', pisCofins: 'das' });
    // Acima do sublimite o ICMS sai do Simples, mas o PIS e a COFINS continuam nele.
    expect(findCompanyRegime('simples-excesso')).toMatchObject({ icmsCode: 'cst', pisCofins: 'das' });
    expect(findCompanyRegime('presumido')).toMatchObject({ icmsCode: 'cst', pisCofins: 'cumulativo' });
    expect(findCompanyRegime('real')).toMatchObject({ icmsCode: 'cst', pisCofins: 'nao-cumulativo' });
    expect(findCompanyRegime('ltda')).toBeNull();
  });
});
