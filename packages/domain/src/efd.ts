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
    /** CIAP (F4-14.b.7): conta contábil do ativo imobilizado (registros 0300 e 0500). */
    ciapAccountCode: optionalText(60),
    ciapAccountName: optionalText(60),
    ciapAccountLevel: z
      .number()
      .int()
      .min(1)
      .max(99999)
      .nullish()
      .transform((v) => v ?? null),
    /**
     * Código do ajuste do crédito do ativo no E111, da tabela 5.1.1 da UF (dúvida D-041): 8
     * caracteres, a UF, "0" (ICMS próprio), "2" (outros créditos) e o número.
     */
    ciapAdjustmentCode: optionalText(8)
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => !v || /^[A-Z]{2}02\d{4}$/.test(v), {
        message: 'Use o código da tabela 5.1.1 da sua UF (ex.: SP020000), com 8 caracteres',
      }),
    /** As saídas com CST 60 contam como tributadas no índice do CIAP? Sem resposta, não contam. */
    ciapStOutputsTaxed: z
      .boolean()
      .nullish()
      .transform((v) => v ?? null),
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
    // O 0500 pede o código, o nome e o nível da conta juntos.
    const account = [v.ciapAccountCode, v.ciapAccountName, v.ciapAccountLevel];
    if (account.some((x) => x !== null) && account.some((x) => x === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ciapAccountCode'],
        message: 'Informe o código, o nome e o nível da conta do ativo',
      });
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
  /**
   * Inventário do estoque nesta data (AAAA-MM-DD), motivo 01 (bloco H). Em fevereiro, sem este
   * campo, o arquivo leva o de 31/12 do ano anterior.
   */
  inventoryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data do inventário inválida (use AAAA-MM-DD)')
    .optional(),
});

/** O que a tela mostra antes de baixar: a apuração e o que ainda falta. */
export interface EfdSummaryView {
  fileName: string;
  lineCount: number;
  documents: number;
  settlement: {
    debitsCents: number;
    creditsCents: number;
    /** Ajustes a crédito (E111): o crédito do ativo pelo CIAP. */
    adjustmentCreditsCents: number;
    previousCreditCents: number;
    dueCents: number;
    creditCarriedCents: number;
  };
  warnings: string[];
}

/** Tipos de saída do bem do CIAP (G125): alienação ou transferência, perecimento e outras. */
export const ciapDisposalType = z.enum(['AT', 'PE', 'OT']);
export type CiapDisposalType = z.infer<typeof ciapDisposalType>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');
const cents = z.number().int('Valor em centavos').min(0, 'O valor não pode ser negativo');

/** Bem do CIAP como a tela mostra (F4-14.b.7). */
export interface CiapAssetView {
  id: string;
  code: string;
  description: string;
  origin: 'purchase' | 'manual';
  enteredOn: string;
  icmsOwnCents: number;
  icmsStCents: number;
  icmsFreightCents: number;
  icmsDifalCents: number;
  installments: number;
  appropriatedInstallments: number;
  costCenter: '1' | '2';
  usage: string | null;
  writtenOffOn: string | null;
  writeOffType: CiapDisposalType | null;
  disposalAccessKey: string | null;
}

/**
 * Bem que já existia antes do Bipaê (sem nota de compra no sistema): entra no CIAP como saldo
 * inicial, com o ICMS que deu crédito na época. Bem que entrou neste mês ou depois vem pela compra.
 */
export const ciapAssetCreate = z.object({
  companyId: z.string().uuid('Escolha a empresa'),
  description: z.string().trim().min(2, 'Descreva o bem').max(100),
  enteredOn: isoDay,
  icmsOwnCents: cents.default(0),
  icmsStCents: cents.default(0),
  icmsFreightCents: cents.default(0),
  icmsDifalCents: cents.default(0),
  installments: z.number().int().min(1).max(999).default(48),
  costCenter: z.enum(['1', '2']).default('1'),
  usage: z.string().trim().max(60).nullish(),
});
export type CiapAssetCreate = z.infer<typeof ciapAssetCreate>;

/** ICMS do frete (CT-e) e DIFAL pago na guia entram no crédito do bem; só antes da primeira parcela baixada. */
export const ciapAssetUpdate = z.object({
  icmsFreightCents: cents.optional(),
  icmsDifalCents: cents.optional(),
  costCenter: z.enum(['1', '2']).optional(),
  usage: z.string().trim().max(60).nullish(),
});
export type CiapAssetUpdate = z.infer<typeof ciapAssetUpdate>;

/**
 * Saída do bem. Na alienação ou transferência (AT) vale a NF-e de saída autorizada da empresa
 * (G130): a data é a da nota. Perecimento e outras saídas pedem a data.
 */
export const ciapAssetWriteOff = z
  .object({
    type: ciapDisposalType,
    on: isoDay.optional(),
    accessKey: z
      .string()
      .regex(/^\d{44}$/, 'A chave da NF-e tem 44 números')
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'AT' && !v.accessKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['accessKey'],
        message: 'Informe a NF-e de saída do bem',
      });
    }
    if (v.type !== 'AT' && !v.on) {
      ctx.addIssue({ code: 'custom', path: ['on'], message: 'Informe a data da saída' });
    }
  });
export type CiapAssetWriteOff = z.infer<typeof ciapAssetWriteOff>;
