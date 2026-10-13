import { z } from 'zod';
import { parseTaxId } from './documents';
import { isValidGtin } from './gtin';
import { ALL_PERMISSIONS } from './permissions';
import { TERMINAL_PLATFORMS } from './terminals';

/** API contracts shared by the API (validation) and the UI (forms). Messages are pt-BR. */

export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} é obrigatório`)
    .max(max, `${label} pode ter no máximo ${max} caracteres`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

export const emailSchema = z.string().trim().toLowerCase().email('E-mail inválido');

export const passwordSchema = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres')
  .max(128, 'Senha muito longa');

export const taxIdSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parseTaxId(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'CPF ou CNPJ inválido' });
      return z.NEVER;
    }
    return parsed.value;
  });

const optionalTaxId = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const parsed = parseTaxId(value);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'CPF ou CNPJ inválido' });
      return z.NEVER;
    }
    return parsed.value;
  });

const centsSchema = z
  .number()
  .int('Valor em centavos deve ser inteiro')
  .min(0, 'Valor não pode ser negativo')
  .max(Number.MAX_SAFE_INTEGER);

// ---------- Auth ----------

export const signupInput = z.object({
  ownerName: trimmed(2, 120, 'Seu nome'),
  email: emailSchema,
  password: passwordSchema,
  businessName: trimmed(2, 120, 'Nome do negócio'),
  taxId: optionalTaxId,
});
export type SignupInput = z.input<typeof signupInput>;

export const loginInput = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
  tenantId: z.string().uuid().optional(),
  /** Código do app autenticador, quando o usuário ativou a verificação em duas etapas. */
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos')
    .optional(),
});
export type LoginInput = z.input<typeof loginInput>;

export const refreshInput = z.object({ refreshToken: z.string().min(20) });

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Me {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string };
  permissions: string[];
  tenants: { id: string; name: string }[];
  /** Present when a Bipaê staff member is in a support session as this client. */
  support?: { readOnly: boolean };
}

// ---------- Catalog ----------

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^\d{8,14}$/, 'Código de barras deve ter de 8 a 14 dígitos')
  .refine(
    (v) => ![8, 12, 13, 14].includes(v.length) || isValidGtin(v) || v.startsWith('2'),
    'Dígito verificador do código de barras inválido',
  );

export const productInput = z.object({
  name: trimmed(1, 120, 'Nome do produto'),
  sku: optionalText(60),
  barcodes: z.array(barcodeSchema).max(20).default([]),
  unit: z.string().trim().toUpperCase().min(1).max(6).default('UN'),
  priceCents: centsSchema,
  costCents: centsSchema.nullish(),
  ncm: z
    .string()
    .trim()
    .regex(/^\d{8}$/, 'NCM deve ter 8 dígitos')
    .nullish()
    .or(z.literal('').transform(() => null)),
  cest: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'CEST deve ter 7 dígitos')
    .nullish()
    .or(z.literal('').transform(() => null)),
  isWeighable: z.boolean().default(false),
  tracksLot: z.boolean().default(false),
  active: z.boolean().default(true),
  fiscalProfileId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  attributes: z.record(z.string(), z.string().max(60)).nullish(),
  components: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().positive() }))
    .max(50)
    .default([]),
});
export type ProductInput = z.input<typeof productInput>;

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcodes: string[];
  unit: string;
  priceCents: number;
  costCents: number | null;
  ncm: string | null;
  cest: string | null;
  isWeighable: boolean;
  tracksLot: boolean;
  active: boolean;
  fiscalProfileId: string | null;
  parentId: string | null;
  attributes: Record<string, string> | null;
  /** Composição do kit; `name` vem da API para exibir. */
  components: { productId: string; quantity: number; name?: string }[];
  updatedAt: string;
}

export const unitInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(6),
  description: trimmed(1, 60, 'Descrição'),
  decimals: z.number().int().min(0).max(4).default(0),
});
export type UnitInput = z.input<typeof unitInput>;

export const priceTableInput = z.object({
  name: trimmed(1, 60, 'Nome da tabela'),
  items: z
    .array(z.object({ productId: z.string().uuid(), priceCents: centsSchema }))
    .max(10_000)
    .default([]),
});
export type PriceTableInput = z.input<typeof priceTableInput>;

export interface PriceTable {
  id: string;
  name: string;
  items: { productId: string; name: string; priceCents: number; basePriceCents: number }[];
}

/**
 * Fiscal profile data is stored only (no calculation until Phase 3).
 * Fields mirror the NF-e layout names.
 */
export const fiscalProfileInput = z.object({
  name: trimmed(1, 60, 'Nome do perfil'),
  origem: z.number().int().min(0).max(8).default(0),
  cfopInterna: z
    .string()
    .regex(/^\d{4}$/, 'CFOP deve ter 4 dígitos')
    .default('5102'),
  cfopInterestadual: z
    .string()
    .regex(/^\d{4}$/, 'CFOP deve ter 4 dígitos')
    .default('6102'),
  csosn: z
    .string()
    .regex(/^\d{3}$/, 'CSOSN deve ter 3 dígitos')
    .nullish(),
  cstIcms: z
    .string()
    .regex(/^\d{2}$/, 'CST deve ter 2 dígitos')
    .nullish(),
  cClassTrib: z
    .string()
    .regex(/^\d{6}$/, 'cClassTrib deve ter 6 dígitos')
    .nullish(),
});
export type FiscalProfileInput = z.input<typeof fiscalProfileInput>;

/** Origem da mercadoria (campo `orig` da NF-e, tabela A do CST do ICMS). */
export const ICMS_ORIGINS: { code: number; label: string }[] = [
  { code: 0, label: 'Nacional' },
  { code: 1, label: 'Estrangeira, importação direta' },
  { code: 2, label: 'Estrangeira, adquirida no mercado interno' },
  { code: 3, label: 'Nacional, conteúdo de importação acima de 40% e até 70%' },
  { code: 4, label: 'Nacional, produção conforme processos produtivos básicos' },
  { code: 5, label: 'Nacional, conteúdo de importação até 40%' },
  { code: 6, label: 'Estrangeira, importação direta, sem similar nacional (lista CAMEX)' },
  { code: 7, label: 'Estrangeira, mercado interno, sem similar nacional (lista CAMEX)' },
  { code: 8, label: 'Nacional, conteúdo de importação acima de 70%' },
];

export interface FiscalProfile {
  id: string;
  name: string;
  data: Omit<z.output<typeof fiscalProfileInput>, 'name'>;
}

// ---------- Parties ----------

export const addressSchema = z.object({
  cep: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{8}$/, 'CEP deve ter 8 dígitos')),
  street: trimmed(1, 120, 'Logradouro'),
  number: trimmed(1, 20, 'Número'),
  complement: optionalText(60),
  district: trimmed(1, 60, 'Bairro'),
  city: trimmed(1, 60, 'Cidade'),
  uf: z.enum(UFS, { message: 'UF inválida' }),
  ibgeCode: z
    .string()
    .regex(/^\d{7}$/, 'Código IBGE deve ter 7 dígitos')
    .nullish(),
});

export const partyInput = z.object({
  name: trimmed(1, 120, 'Nome'),
  taxId: optionalTaxId,
  email: emailSchema.nullish().or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{10,13}$/, 'Telefone inválido'))
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: addressSchema.nullish(),
  notes: optionalText(500),
});
export type PartyInput = z.input<typeof partyInput>;

/** Marketing consent is recorded separately from the CPF on the receipt (LGPD, ADR-0010). */
export const customerInput = partyInput.extend({
  marketingConsent: z.boolean().default(false),
  /** Tabela de preço do cliente (atacado, funcionário...). Nula usa a tabela da loja. */
  priceTableId: z.string().uuid().nullish(),
});
export type CustomerInput = z.input<typeof customerInput>;

export interface Party {
  id: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: z.output<typeof addressSchema> | null;
  notes: string | null;
  marketingConsent?: boolean;
  priceTableId?: string | null;
  updatedAt: string;
}

// ---------- Organization ----------

export const storeInput = z.object({
  companyId: z.string().uuid(),
  name: trimmed(1, 80, 'Nome da loja'),
});

export const storeUpdateInput = z.object({
  name: trimmed(1, 80, 'Nome da loja').optional(),
  /** Tabela de preço padrão dos caixas da loja; null volta ao preço de cadastro. */
  priceTableId: z.string().uuid().nullable().optional(),
});

/**
 * Regime tributário da empresa, do MEI ao Lucro Real. Os detalhes de cada um (CRT, CSOSN ou CST,
 * PIS e COFINS) ficam em `COMPANY_REGIMES`, no pacote `@bipae/fiscal`.
 */
export const COMPANY_TAX_REGIMES = ['mei', 'simples', 'simples-excesso', 'presumido', 'real'] as const;
export type CompanyTaxRegime = (typeof COMPANY_TAX_REGIMES)[number];

export const companyInput = z.object({
  legalName: trimmed(2, 120, 'Razão social'),
  tradeName: optionalText(120),
  taxId: optionalTaxId,
  uf: z.enum(UFS).nullish(),
  taxRegime: z.enum(COMPANY_TAX_REGIMES, { message: 'Regime tributário inválido' }).nullish(),
});

export const terminalInput = z.object({
  storeId: z.string().uuid(),
  name: trimmed(1, 60, 'Nome do caixa'),
  platform: z.enum(TERMINAL_PLATFORMS),
});
export type TerminalInput = z.input<typeof terminalInput>;

export interface Terminal {
  id: string;
  storeId: string;
  name: string;
  platform: (typeof TERMINAL_PLATFORMS)[number];
  nfceSeries: number;
  status: 'active' | 'revoked';
  createdAt: string;
}

export const roleInput = z.object({
  name: trimmed(1, 60, 'Nome do papel'),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1),
});

export const inviteUserInput = z.object({
  name: trimmed(2, 120, 'Nome'),
  email: emailSchema,
  password: passwordSchema,
  roleId: z.string().uuid(),
});

/** Convite por link (F1-06): papel, lojas e, se quiser, o e-mail de quem pode aceitar. */
export const inviteCreateInput = z.object({
  roleId: z.string().uuid(),
  storeIds: z.array(z.string().uuid()).max(500).nullish(),
  email: emailSchema.nullish().or(z.literal('').transform(() => null)),
});

/** Aceitar o convite: entrar com uma conta que já existe ou criar uma nova. */
export const inviteAcceptInput = z.object({
  name: trimmed(2, 120, 'Nome').optional(),
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos')
    .optional(),
});

export interface InviteInfo {
  businessName: string;
  roleName: string;
  email: string | null;
  expiresAt: string;
  status: 'valid' | 'expired' | 'used' | 'revoked';
}

// ---------- Common ----------

export const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.input<typeof listQuery>;

/** Lista de produtos; `parentId` traz só as variações de um modelo (F1-04). */
export const productListQuery = listQuery.extend({ parentId: z.string().uuid().optional() });

export interface Page<T> {
  items: T[];
  total: number;
}

export interface AuditEntry {
  id: string;
  seq: number;
  action: string;
  entity: string;
  entityId: string | null;
  actorId: string | null;
  authorizedBy: string | null;
  data: unknown;
  hash: string;
  createdAt: string;
}

/** Standard error body returned by the API. `message` is always pt-BR and user-facing. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  issues?: { path: string; message: string }[];
}
