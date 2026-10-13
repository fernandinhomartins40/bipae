import { describe, expect, it } from 'vitest';
import { companyIcmsRuleInput } from './contracts';

/** F3-06.e: contrato das regras de ICMS da empresa. */
const base = {
  companyId: '0190a3c4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
  name: 'Cervejas',
  ncm: ['2203'],
  validFrom: '2026-01-01',
  source: 'Orientação do contador',
};
const erro = (valor: unknown) => {
  const r = companyIcmsRuleInput.safeParse(valor);
  return r.success ? null : r.error.issues[0]!.message;
};

describe('regra de ICMS da empresa', () => {
  it('aceita vírgula decimal e NCM com pontos', () => {
    const r = companyIcmsRuleInput.parse({ ...base, ncm: ['2203.00.00'], rate: '27,5', st: { mva: '40', rate: '18' } });
    expect(r).toMatchObject({ ncm: ['22030000'], rate: '27.5', st: { mva: '40', rate: '18' } });
  });

  it('exige dizer o que muda no ICMS', () => {
    expect(erro(base)).toBe('Informe o que muda no ICMS: alíquota, redução da base, FCP ou substituição tributária');
    expect(erro({ ...base, fcpRate: '2' })).toBeNull();
    expect(erro({ ...base, baseReduction: '33,33' })).toBeNull();
  });

  it('confere percentuais, NCM e vigência', () => {
    expect(erro({ ...base, rate: 'abc' })).toBe('Alíquota: use um número, como 12 ou 4,5');
    expect(erro({ ...base, rate: '101' })).toBe('Alíquota: no máximo 100%');
    expect(erro({ ...base, rate: '12', st: { mva: '1001', rate: '18' } })).toBe('MVA: no máximo 1000%');
    expect(erro({ ...base, rate: '12', ncm: ['2'] })).toBe('NCM: de 2 a 8 dígitos (pode ser o começo do código)');
    expect(erro({ ...base, rate: '12', ncm: [] })).toBe('Informe pelo menos um NCM');
    expect(erro({ ...base, rate: '12', validTo: '2025-12-31' })).toBe('O fim da vigência precisa ser depois do início');
    expect(erro({ ...base, rate: '12', validTo: '2027-01-01' })).toBeNull();
  });
});
