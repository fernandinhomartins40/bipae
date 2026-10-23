import { describe, expect, it } from 'vitest';
import { efdRequest, efdSettingsInput } from './efd';

const companyId = '0192a000-0000-7000-8000-000000000001';
const issues = (input: unknown) => {
  const r = efdSettingsInput.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('configuração da EFD ICMS/IPI (F4-14.b.3)', () => {
  it('padrão: perfil A, sem contador e sem vencimento', () => {
    expect(efdSettingsInput.parse({ companyId })).toMatchObject({
      profile: 'A',
      accountantName: null,
      icmsDueDay: null,
    });
  });

  it('limpa as máscaras e mantém o CNPJ do escritório', () => {
    const s = efdSettingsInput.parse({
      companyId,
      accountantName: ' Contábil Exemplo ',
      accountantCpf: '529.982.247-25',
      accountantCnpj: '11.222.333/0001-81',
      accountantPhone: '(11) 3333-4444',
      accountantCityCode: '3550308',
      icmsDueDay: 20,
    });
    expect(s).toMatchObject({
      accountantName: 'Contábil Exemplo',
      accountantCpf: '52998224725',
      accountantCnpj: '11222333000181',
      accountantPhone: '1133334444',
      icmsDueDay: 20,
    });
  });

  it('recusa CPF, CNPJ e município inválidos e contador sem nome', () => {
    expect(
      issues({
        companyId,
        accountantCpf: '123.456.789-00',
        accountantCnpj: '11.222.333/0001-00',
        accountantCityCode: '355',
      }),
    ).toEqual([
      'accountantCpf: CPF inválido',
      'accountantCnpj: CNPJ inválido',
      'accountantCityCode: Use o código IBGE do município (7 números)',
      'accountantName: Informe o nome',
    ]);
    expect(issues({ companyId, icmsDueDay: 32 })).toHaveLength(1);
  });

  it('CIAP: conta do ativo completa e código de ajuste da tabela 5.1.1 (F4-14.b.7)', () => {
    expect(
      efdSettingsInput.parse({
        companyId,
        ciapAccountCode: '1.2.3.01',
        ciapAccountName: 'Máquinas e equipamentos',
        ciapAccountLevel: 4,
        ciapAdjustmentCode: 'sp020001',
        ciapStOutputsTaxed: false,
      }),
    ).toMatchObject({
      ciapAdjustmentCode: 'SP020001',
      ciapAccountLevel: 4,
      ciapStOutputsTaxed: false,
    });
    expect(efdSettingsInput.parse({ companyId })).toMatchObject({
      ciapAccountCode: null,
      ciapAdjustmentCode: null,
      ciapStOutputsTaxed: null,
    });
    expect(issues({ companyId, ciapAccountCode: '1.2.3.01' })).toEqual([
      'ciapAccountCode: Informe o código, o nome e o nível da conta do ativo',
    ]);
    // Terceiro caractere "0" (ICMS próprio) e quarto "2" (outros créditos).
    expect(issues({ companyId, ciapAdjustmentCode: 'SP000001' })).toHaveLength(1);
  });

  it('pedido do arquivo: mês AAAA-MM e saldo credor em centavos', () => {
    expect(efdRequest.parse({ companyId, month: '2026-10', previousCreditCents: '1500' })).toEqual({
      companyId,
      month: '2026-10',
      previousCreditCents: 1500,
    });
    expect(efdRequest.safeParse({ companyId, month: '2026-13' }).success).toBe(false);
  });
});
