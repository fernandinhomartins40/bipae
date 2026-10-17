import { describe, expect, it } from 'vitest';
import { checkCompanyIcmsRules, companyIcmsSettings, type CompanyIcmsRule } from './company-rules';
import { saleTaxSummaries, type SaleFiscalProfile } from './sale';

const HOJE = '2026-06-15';

// Números de EXEMPLO, como os que o contador cadastraria: não são alíquotas oficiais.
const regra = (
  parcial: Partial<CompanyIcmsRule> & Pick<CompanyIcmsRule, 'id'>,
): CompanyIcmsRule => ({
  name: parcial.id,
  ncm: ['2203'],
  validity: { start: '2026-01-01' },
  effect: { rate: '25' },
  source: 'Exemplo',
  ...parcial,
});

const REVENDA: SaleFiscalProfile = {
  cfopInterna: '5102',
  cfopInterestadual: '6102',
  csosn: '102',
  cstIcms: '00',
  cstPisCofins: '01',
  cClassTrib: '000001',
};

describe('regras de ICMS da empresa', () => {
  it('a regra do NCM vale mais que a alíquota geral da UF', () => {
    const [cerveja, arroz] = saleTaxSummaries({
      company: { uf: 'SP', taxRegime: 'real' },
      items: [
        { operationCents: 10_000, profile: REVENDA, ncm: '22030000' },
        { operationCents: 10_000, profile: REVENDA, ncm: '10063021' },
      ],
      date: HOJE,
      rules: [regra({ id: 'cerveja', effect: { rate: '25' } })],
    })!;
    expect(cerveja!.icmsCents).toBe(2500);
    expect(arroz!.icmsCents).toBe(1800);
  });

  it('a regra mais específica vence, e a vigência é respeitada', () => {
    const regras = [
      regra({ id: 'bebidas', ncm: ['22'], effect: { rate: '25' } }),
      regra({
        id: 'cerveja-de-malte',
        ncm: ['22030000'],
        effect: { rate: '20', baseReduction: '10' },
      }),
      regra({
        id: 'antiga',
        ncm: ['1006'],
        validity: { start: '2020-01-01', end: '2026-01-01' },
        effect: { rate: '7' },
      }),
    ];
    expect(companyIcmsSettings(regras, '22030000', HOJE)).toMatchObject({
      ruleId: 'cerveja-de-malte',
    });
    expect(companyIcmsSettings(regras, '22021000', HOJE)).toMatchObject({ ruleId: 'bebidas' });
    expect(companyIcmsSettings(regras, '10063021', HOJE)).toEqual({});
    expect(companyIcmsSettings(regras, '10063021', '2025-06-01')).toMatchObject({
      ruleId: 'antiga',
    });
    expect(companyIcmsSettings(regras, null, HOJE)).toEqual({});
    expect(companyIcmsSettings([], '22030000', HOJE)).toEqual({});
  });

  it('substituição tributária e FCP vindos da regra', () => {
    const [item] = saleTaxSummaries({
      company: { uf: 'SP', taxRegime: 'real' },
      items: [{ operationCents: 10_000, profile: { ...REVENDA, cstIcms: '10' }, ncm: '22030000' }],
      date: HOJE,
      rules: [
        regra({ id: 'st', effect: { rate: '18', fcpRate: '2', st: { mva: '40', rate: '18' } } }),
      ],
    })!;
    expect(item).toMatchObject({
      icmsCents: 1800,
      icmsStCents: 720,
      fcpCents: 200,
      complete: true,
    });
  });

  it('o código de benefício (cBenef, F3-27) sai da regra sem mexer no cálculo', () => {
    const settings = companyIcmsSettings(
      [regra({ id: 'isencao', effect: { rate: '0', benefitCode: 'PR810001' } })],
      '22030000',
      HOJE,
    );
    expect(settings).toMatchObject({ icms: { rate: '0' }, benefitCode: 'PR810001' });
    expect(settings.icms).not.toHaveProperty('benefitCode');
    const semCodigo = companyIcmsSettings([regra({ id: 'aliquota' })], '22030000', HOJE);
    expect(semCodigo).not.toHaveProperty('benefitCode');
  });

  it('duas regras empatadas bloqueiam o ICMS com a explicação, sem escolher uma delas', () => {
    const regras = [
      regra({ id: 'a', name: 'Cerveja A' }),
      regra({ id: 'b', name: 'Cerveja B', effect: { rate: '20' } }),
    ];
    const [item] = saleTaxSummaries({
      company: { uf: 'SP', taxRegime: 'real' },
      items: [{ operationCents: 10_000, profile: REVENDA, ncm: '22030000' }],
      date: HOJE,
      rules: regras,
    })!;
    expect(item!.icmsCents).toBeNull();
    expect(item!.pending[0]).toBe(
      'Mais de uma regra de ICMS da empresa vale para o NCM 22030000: Cerveja A, Cerveja B. Corrija em Regras de ICMS.',
    );
  });

  it('a conferência do cadastro explica cada problema', () => {
    expect(checkCompanyIcmsRules([regra({ id: 'ok' })])).toEqual([]);
    const problemas = checkCompanyIcmsRules([
      regra({ id: 'sem-ncm', name: 'Sem NCM', ncm: [] }),
      regra({ id: 'ncm-ruim', name: 'NCM ruim', ncm: ['22a'] }),
      regra({ id: 'vazia', name: 'Vazia', ncm: ['04'], effect: {} }),
      regra({
        id: 'datas',
        name: 'Datas',
        ncm: ['05'],
        validity: { start: '2027-01-01', end: '2026-01-01' },
      }),
      regra({ id: 'x', name: 'X', ncm: ['09'] }),
      regra({ id: 'y', name: 'Y', ncm: ['09'] }),
    ]);
    expect(problemas).toEqual([
      'A regra "Sem NCM" precisa de pelo menos um NCM.',
      'NCM "22a" inválido na regra "NCM ruim".',
      'A regra "Vazia" não diz o que muda no ICMS.',
      expect.stringMatching(/^Regra "Datas": Vigência inválida/),
      'As regras "X" e "Y" valem para os mesmos NCM no mesmo período.',
    ]);
  });
});
