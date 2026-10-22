import { z } from 'zod';
import { isValidCpf, parseTaxId } from './documents';

/**
 * Configuração do arquivo da EFD ICMS/IPI da empresa (F4-14.b.3): o que o arquivo pede e o
 * Bipaê não sabe sozinho. Perfil (0000, campo 14) é o que o fisco estadual definiu para o
 * estabelecimento; o contador vai no 0100; vencimento e código de receita do ICMS vão no E116.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const digits = (v: string | null) => (v ? v.replace(/\D/g, '') : null);

export const efdSettingsInput = z
  .object({
    companyId: z.string().uuid('Escolha a empresa'),
    profile: z.enum(['A', 'B', 'C']).default('A'),
    accountantName: optionalText(100),
    accountantCpf: optionalText(14).transform(digits),
    accountantCrc: optionalText(15),
    // Sem tirar letras: o CNPJ pode ser alfanumérico.
    accountantCnpj: optionalText(18).transform((v) => (v ? (parseTaxId(v)?.value ?? v) : null)),
    accountantEmail: optionalText(120),
    accountantPhone: optionalText(20).transform(digits),
    accountantCityCode: optionalText(7),
    /** Dia do mês seguinte em que vence o ICMS próprio. */
    icmsDueDay: z
      .number()
      .int()
      .min(1)
      .max(31)
      .nullish()
      .transform((v) => v ?? null),
    /** Código de receita do ICMS na UF (como a guia de recolhimento pede). */
    icmsRevenueCode: optionalText(20),
  })
  .superRefine((v, ctx) => {
    if (v.accountantCpf && !isValidCpf(v.accountantCpf)) {
      ctx.addIssue({ code: 'custom', path: ['accountantCpf'], message: 'CPF inválido' });
    }
    if (v.accountantCnpj && parseTaxId(v.accountantCnpj)?.kind !== 'cnpj') {
      ctx.addIssue({ code: 'custom', path: ['accountantCnpj'], message: 'CNPJ inválido' });
    }
    if (v.accountantCityCode && !/^\d{7}$/.test(v.accountantCityCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['accountantCityCode'],
        message: 'Use o código IBGE do município (7 números)',
      });
    }
    // O 0100 pede o nome e o CPF do contabilista quando ele é informado.
    if ((v.accountantCpf || v.accountantCrc) && !v.accountantName) {
      ctx.addIssue({ code: 'custom', path: ['accountantName'], message: 'Informe o nome' });
    }
  });
export type EfdSettingsInput = z.input<typeof efdSettingsInput>;
export type EfdSettings = z.output<typeof efdSettingsInput>;

/** Pedido do arquivo do mês. */
export const efdRequest = z.object({
  companyId: z.string().uuid('Escolha a empresa'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM)'),
  /** Saldo credor de ICMS do mês anterior, em centavos (E110, campo 10). */
  previousCreditCents: z.coerce.number().int().min(0).default(0),
});

/** O que a tela mostra antes de baixar: a apuração e o que ainda falta. */
export interface EfdSummaryView {
  fileName: string;
  lineCount: number;
  documents: number;
  settlement: {
    debitsCents: number;
    creditsCents: number;
    previousCreditCents: number;
    dueCents: number;
    creditCarriedCents: number;
  };
  warnings: string[];
}
