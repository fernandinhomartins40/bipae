import { z } from 'zod';
import { parseTaxId } from './documents';
import { isValidGtin } from './gtin';
import { passwordProblem } from './password-policy';
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
  .max(128, 'Senha muito longa')
  .refine((p) => p.length < 8 || passwordProblem(p) === null, {
    message: 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar.',
  });

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
  /** emailVerified: confirmado pelo link do e-mail (P-04.c). */
  user: { id: string; name: string; email: string; emailVerified?: boolean };
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

// ---------------------------------------------------------------- catálogo (MercadoFlow, MF-02)

/** Dados de catálogo guardados no produto: nada disso muda o imposto nem o preço. */
export const productCatalogSchema = z.object({
  brand: optionalText(80),
  manufacturer: optionalText(120),
  department: optionalText(80),
  category: optionalText(160),
  packageDescription: optionalText(40),
  /** Conteúdo da embalagem, para o preço por kg ou litro na etiqueta. */
  content: z
    .object({
      quantity: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade do conteúdo inválida'),
      unit: z.string().trim().toUpperCase().min(1).max(6),
      packs: z.number().int().positive().default(1),
    })
    .nullish(),
  /** De onde veio o cadastro (auditoria; não aparece para o lojista). */
  source: optionalText(60),
});
export type ProductCatalog = z.output<typeof productCatalogSchema>;

/** Código de caixa ou fardo do produto e quantas unidades leva. */
export const productPackSchema = z.object({
  packGtin: barcodeSchema,
  unitsPerPack: z.number().int().positive().max(100_000),
});
export type ProductPack = z.output<typeof productPackSchema>;

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
  /** Preparado na cozinha (F5-09). */
  kitchen: z.boolean().default(false),
  /** Insumo da ficha técnica (F5-11): não aparece no caixa. */
  ingredient: z.boolean().default(false),
  active: z.boolean().default(true),
  fiscalProfileId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
  attributes: z.record(z.string(), z.string().max(60)).nullish(),
  components: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().positive() }))
    .max(50)
    .default([]),
  catalog: productCatalogSchema.nullish(),
  packs: z.array(productPackSchema).max(20).default([]),
  /** Item da pauta da ST da UF (F3-26.f): a base da ST na NF-e passa a ser o valor da pauta. */
  stPauta: z
    .object({
      uf: z.string().length(2),
      annex: z.string().regex(/^[IVX]{1,4}$/),
      item: z.string().regex(/^\d{1,3}\.\d{1,4}$/),
    })
    .nullish(),
  /** Atacarejo (F5-03): a partir de tal quantidade, cada unidade sai por tal preço. */
  wholesale: z
    .object({
      minQuantityMilli: z.number().int().min(2000, 'O atacado começa em pelo menos 2 unidades'),
      priceCents: centsSchema,
    })
    .nullish(),
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
  kitchen: boolean;
  ingredient: boolean;
  active: boolean;
  fiscalProfileId: string | null;
  parentId: string | null;
  attributes: Record<string, string> | null;
  /** Composição do kit; `name` vem da API para exibir. */
  /** Kit ou ficha técnica: quantidade de cada componente (até 4 casas), com a unidade e o custo. */
  components: {
    productId: string;
    quantity: number;
    name?: string;
    unit?: string;
    costCents?: number | null;
  }[];
  /** Marca, fabricante, departamento e conteúdo (catálogo). */
  catalog?: ProductCatalog | null;
  /** Item da pauta da ST da UF (F3-26.f). */
  stPauta?: { uf: string; annex: string; item: string } | null;
  /** Códigos de caixa ou fardo, com as unidades de cada um. */
  packs?: ProductPack[];
  /** Atacarejo (F5-03): preço de atacado a partir de uma quantidade. */
  wholesale?: { minQuantityMilli: number; priceCents: number } | null;
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
  /** CST do PIS e da COFINS (a tabela é a mesma para os dois); usado no Lucro Presumido e no Real. */
  cstPisCofins: z
    .string()
    .regex(/^\d{2}$/, 'CST do PIS/COFINS deve ter 2 dígitos')
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
  /** Limite do crediário em centavos (F2-02). Nulo: o cliente não compra no crediário. */
  creditLimitCents: z
    .number()
    .int('Limite do crediário inválido')
    .nonnegative('O limite do crediário não pode ser negativo')
    .max(100_000_000_00, 'Limite do crediário alto demais')
    .nullish(),
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
  creditLimitCents?: number | null;
  updatedAt: string;
}

/** Recebimento de uma parcela do crediário (F2-02). */
export const creditPaymentInput = z.object({
  amountCents: z.number().int('Valor inválido').positive('Informe o valor recebido'),
  note: z.string().trim().max(200).optional(),
});

/** Crediário do cliente: limite, saldo devedor e o extrato (F2-02). */
export interface CustomerCredit {
  limitCents: number | null;
  balanceCents: number;
  availableCents: number | null;
  entries: {
    id: string;
    kind: 'sale' | 'cancel' | 'return' | 'payment';
    amountCents: number;
    saleId: string | null;
    note: string | null;
    createdAt: string;
  }[];
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
export const COMPANY_TAX_REGIMES = [
  'mei',
  'simples',
  'simples-excesso',
  'presumido',
  'real',
] as const;
export type CompanyTaxRegime = (typeof COMPANY_TAX_REGIMES)[number];

/** Percentual aproximado ("6", "13,45"), de 0 a 99,99. */
const approximatePercent = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim().replace(',', '.'))
  .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v), {
    message: 'Percentual de 0 a 99,99, com até 2 casas',
  })
  .nullish()
  .or(z.literal('').transform(() => null));

export const companyInput = z.object({
  legalName: trimmed(2, 120, 'Razão social'),
  tradeName: optionalText(120),
  taxId: optionalTaxId,
  uf: z.enum(UFS).nullish(),
  taxRegime: z.enum(COMPANY_TAX_REGIMES, { message: 'Regime tributário inválido' }).nullish(),
  /** Optante pelo Simples que apura o IBS e a CBS pelo regime regular (LC 214/2025, art. 41, § 3º). */
  ibsCbsRegular: z.boolean().optional(),
  // Dados do emitente da NFC-e e da NF-e (F3-14.b).
  ie: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, '') || null)
    .refine((v) => v === null || (v.length >= 2 && v.length <= 14), 'Inscrição estadual inválida')
    .nullish(),
  street: optionalText(60),
  streetNumber: optionalText(60),
  complement: optionalText(60),
  district: optionalText(60),
  cityCode: z
    .string()
    .regex(/^\d{7}$/, 'Escolha o município')
    .nullish()
    .or(z.literal('').transform(() => null)),
  cep: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, '') || null)
    .refine((v) => v === null || v.length === 8, 'CEP deve ter 8 dígitos')
    .nullish(),
  phone: optionalText(20),
  /** Código tPag do Pix e do vale na NFC-e (dúvida D-029), entre as opções da tabela. */
  nfcePaymentCodes: z.record(z.string(), z.string().regex(/^\d{2}$/)).optional(),
  /** NFS-e Nacional (F5-13.d): inscrição municipal e série da DPS (1 a 49999, aplicativo próprio). */
  municipalRegistration: optionalText(15),
  nfseSeries: z
    .number()
    .int()
    .min(1, 'Série de 1 a 49999')
    .max(49999, 'Série de 1 a 49999')
    .optional(),
  /** Percentuais aproximados dos tributos na NFS-e (Lei 12.741/2012): o do Simples ou os três. */
  nfseSimplesPercent: approximatePercent,
  nfseTaxFederal: approximatePercent,
  nfseTaxState: approximatePercent,
  nfseTaxMunicipal: approximatePercent,
  /** Perfil fiscal das notas da venda condicional com imposto suspenso (F5-12.c.2, D-033). */
  demonstrationProfileId: z
    .string()
    .uuid('Escolha o perfil fiscal')
    .nullish()
    .or(z.literal('').transform(() => null)),
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

// ---------- Regras de ICMS da empresa (F3-06.e) ----------

const percentText = (label: string, max = 100) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(',', '.'))
    .pipe(
      z
        .string()
        .regex(/^\d{1,4}(\.\d{1,4})?$/, `${label}: use um número, como 12 ou 4,5`)
        .refine((v) => Number(v) <= max, `${label}: no máximo ${max}%`),
    );
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

/** O que muda no ICMS dos produtos do NCM: alíquota, redução de base, FCP e/ou substituição tributária. */
export const companyIcmsRuleInput = z
  .object({
    companyId: z.string().uuid(),
    name: trimmed(2, 80, 'Nome da regra'),
    ncm: z
      .array(
        z
          .string()
          .trim()
          .transform((v) => v.replace(/\D/g, ''))
          .pipe(
            z.string().regex(/^\d{2,8}$/, 'NCM: de 2 a 8 dígitos (pode ser o começo do código)'),
          ),
      )
      .min(1, 'Informe pelo menos um NCM')
      .max(50),
    validFrom: isoDay,
    validTo: isoDay.nullish(),
    rate: percentText('Alíquota').nullish(),
    baseReduction: percentText('Redução da base').nullish(),
    fcpRate: percentText('FCP').nullish(),
    st: z
      .object({
        mva: percentText('MVA', 1000),
        rate: percentText('Alíquota da ST'),
        baseReduction: percentText('Redução da base da ST').nullish(),
      })
      .nullish(),
    // Código de benefício fiscal da UF (cBenef, F3-27): 8 ou 10 caracteres, ou "SEM CBENEF",
    // como o leiaute da NF-e aceita.
    benefitCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^([A-Z0-9]{8}|[A-Z0-9]{10}|SEM CBENEF)$/,
            'Código de benefício (cBenef): 8 ou 10 letras e números, como PR810001, ou SEM CBENEF',
          ),
      )
      .nullish()
      .or(z.literal('').transform(() => null)),
    source: trimmed(3, 200, 'Fonte (lei, decreto ou orientação do contador)'),
  })
  .refine((v) => v.rate || v.baseReduction || v.fcpRate || v.st || v.benefitCode, {
    message:
      'Informe o que muda no ICMS: alíquota, redução da base, FCP, substituição tributária ou código de benefício',
    path: ['rate'],
  })
  .refine((v) => !v.validTo || v.validTo > v.validFrom, {
    message: 'O fim da vigência precisa ser depois do início',
    path: ['validTo'],
  });
export type CompanyIcmsRuleInput = z.input<typeof companyIcmsRuleInput>;

export interface CompanyIcmsRuleRow {
  id: string;
  companyId: string;
  name: string;
  ncm: string[];
  validFrom: string;
  validTo: string | null;
  effect: {
    rate?: string;
    baseReduction?: string;
    fcpRate?: string;
    st?: { mva: string; rate: string; baseReduction?: string };
    /** Código de benefício fiscal da UF (cBenef). */
    benefitCode?: string;
  };
  source: string;
  updatedAt: string;
}

// ---------- Certificado digital A1 (F3-10) ----------

/** Envio do certificado A1: o arquivo .pfx em base64 e a senha dele. */
export const certificateUploadInput = z.object({
  pfxBase64: z
    .string()
    .min(100, 'Escolha o arquivo do certificado (.pfx ou .p12)')
    .max(200_000, 'Arquivo grande demais para um certificado A1')
    .regex(/^[A-Za-z0-9+/=]+$/, 'Arquivo do certificado em formato inválido'),
  password: z.string().min(1, 'Informe a senha do certificado').max(200),
});
export type CertificateUploadInput = z.input<typeof certificateUploadInput>;

/** Situação do certificado de uma empresa, sem nenhum segredo. */
export interface CertificateStatus {
  companyId: string;
  subject: string;
  cnpj: string;
  notAfter: string;
  daysLeft: number;
  status: 'valido' | 'vencendo' | 'vencido';
}

/** Teste de conexão com a SEFAZ de homologação (F3-11): NF-e (55) ou NFC-e (65). */
export const sefazStatusInput = z.object({
  model: z.enum(['55', '65'], { message: 'Escolha NF-e (55) ou NFC-e (65)' }).default('65'),
});

/** Resposta do status do serviço da SEFAZ, como a tela mostra. */
export interface SefazStatus {
  model: '55' | '65';
  uf: string;
  environment: 'homologacao';
  cStat: string;
  xMotivo: string;
  online: boolean;
  averageSeconds?: number;
  observation?: string;
  checkedAt: string;
}

// ---------------------------------------------------------------- compras por XML (F3-19)

export const purchaseXmlInput = z.object({
  xml: z
    .string()
    .min(50, 'Escolha o arquivo XML da nota de compra')
    .max(5_000_000, 'Arquivo grande demais para uma nota fiscal'),
});

/** Marca ou desmarca a nota de compra como uso ou consumo pessoal (LC 214/2025, art. 57). */
export const purchasePersonalUseInput = z.object({ personalUse: z.boolean() });

/** Fator de conversão como texto decimal ("12", "0,5"): unidades de estoque por unidade da nota. */
const conversionFactor = z
  .union([z.number(), z.string()])
  .transform((value) => String(value).trim().replace(',', '.'))
  .refine((value) => /^\d{1,6}(\.\d{1,4})?$/.test(value) && /[1-9]/.test(value), {
    message: 'Fator de conversão inválido: use um número maior que zero, com até 4 casas',
  });

export const purchaseImportInput = purchaseXmlInput.extend({
  storeId: z.string().uuid('Escolha a loja que recebe a mercadoria'),
  items: z
    .array(
      z.object({
        line: z.number().int().positive(),
        /** Produto da loja; null cria um produto novo com os dados da nota. */
        productId: z.string().uuid().nullable(),
        factor: conversionFactor.default('1'),
        /** Unidade de estoque do produto novo. */
        unit: z.string().trim().min(1).max(6).optional(),
        /** Preço de venda do produto novo, em centavos. */
        priceCents: z.number().int().nonnegative().optional(),
        /** Nome do produto novo (padrão: o do catálogo, senão o da nota). */
        name: z.string().trim().min(1, 'Nome do produto é obrigatório').max(120).optional(),
      }),
    )
    .min(1, 'A nota precisa de pelo menos um item'),
});
export type PurchaseImportInput = z.input<typeof purchaseImportInput>;

/** O que a tela mostra antes de confirmar a entrada. */
export interface PurchasePreview {
  accessKey: string;
  number: number;
  series: number;
  issuedAt: string;
  totalCents: number;
  environment: 'producao' | 'homologacao';
  authorized: boolean;
  signature: { valid: boolean; signer: string | null; trusted: boolean };
  company: { id: string; name: string };
  supplier: { id: string | null; name: string; taxId: string };
  alreadyImported: boolean;
  items: {
    line: number;
    supplierCode: string;
    gtin: string | null;
    description: string;
    unit: string;
    quantity: string;
    totalCents: number;
    suggestion: {
      productId: string;
      productName: string;
      unit: string;
      factor: string;
      via: 'fornecedor' | 'codigo-de-barras';
    } | null;
    /** O que o catálogo sabe do produto, para o cadastro novo (MF-03). */
    catalog: {
      description: string;
      brand: string | null;
      packageDescription: string | null;
    } | null;
  }[];
}

export interface PurchaseSummary {
  id: string;
  accessKey: string;
  number: number;
  series: number;
  issuedAt: string;
  totalCents: number;
  supplierName: string;
  storeName: string;
  authorized: boolean;
  /** Uso ou consumo pessoal (LC 214/2025, art. 57): sem crédito de IBS e CBS. */
  personalUse: boolean;
  itemCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------- catálogo (MercadoFlow, MF-02)

/** Produto como o catálogo devolve, já com o NCM e o CEST conferidos na tabela oficial. */
export interface CatalogProduct {
  gtin: string;
  found: boolean;
  reason?: 'NAO_ENCONTRADO' | 'GTIN_INVALIDO' | 'SEM_RESPOSTA';
  description?: string;
  brand?: string | null;
  manufacturer?: string | null;
  department?: string | null;
  category?: string | null;
  unit?: string;
  weighable?: boolean;
  packageDescription?: string | null;
  content?: { quantity: string; unit: string; packs: number } | null;
  /** Sugestões: só vêm quando o código existe na tabela oficial vigente. */
  ncm?: string | null;
  ncmConfidence?: number | null;
  cest?: string | null;
  packs?: ProductPack[];
  source?: string | null;
}

export const catalogLookupInput = z.object({
  gtins: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\d{8,14}$/, 'Código de barras inválido'),
    )
    .min(1)
    .max(200),
});

// ---------------------------------------------------------------- MercadoFlow: contas (MF-04)

export const mercadoflowAccountInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD: 10 ou 11 dígitos')),
  acceptTerms: z.literal(true, {
    message: 'Para criar a conta, marque a autorização e o aceite dos termos do MercadoFlow',
  }),
});

export const mercadoflowConnectInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  returnUrl: z
    .string()
    .url('Endereço de volta inválido')
    .refine(
      (v) => v.startsWith('https://') || v.startsWith('http://localhost'),
      'Endereço de volta inválido',
    ),
});

export interface MercadoflowLinkView {
  storeId: string;
  storeName: string;
  status: 'PENDENTE' | 'ATIVA' | 'REVOGADA' | 'RECUSADA' | 'EXPIRADA' | null;
  marketId: string | null;
  scopes: string[];
  createdVia: 'ACCOUNT' | 'CONNECT' | null;
  connectUrl: string | null;
  connectedAt: string | null;
  lastError: string | null;
  /** Último envio de vendas (NFC-e) aceito pelo MercadoFlow (MF-08). */
  lastSalesSyncAt: string | null;
  /** LIMITE_DO_PLANO: vendas em pausa até esta hora. */
  salesPausedUntil: string | null;
  /** Aplicar sozinho o preço aprovado e o encarte (MF-11). */
  autoApply: { prices: boolean; promotions: boolean };
  customerActive: boolean | null;
  discount: { active: boolean; partner?: string; percent?: number } | null;
}

/** Preço aprovado ou encarte do MercadoFlow esperando o gerente (MF-11). */
export interface MercadoflowPendingView {
  id: string;
  storeId: string;
  storeName: string;
  kind: 'price' | 'promotion' | 'order';
  /** Por que não dá para aplicar ainda (produto não cadastrado, por exemplo). */
  problem: string | null;
  /** Preço: gtin, productId, productName, priceCents, currentPriceCents, approvedBy. */
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface MercadoflowOverview {
  enabled: boolean;
  termsUrl: string | null;
  publicUrl: string;
  stores: MercadoflowLinkView[];
  queue: { pending: number; sent: number; rejected: number };
  errors: { kind: string; error: string }[];
}

/** Decisões do Tino de uma loja vinculada (GET /mercadoflow/decisions, MF-10). */
export interface MercadoflowStoreDecisions {
  storeId: string;
  storeName: string;
  /** unavailable: o MercadoFlow não respondeu agora. */
  status: 'ok' | 'unavailable';
  total: number;
  byActionType: Record<string, number>;
  expectedImpactCents: number;
  lockedByPlan: boolean;
  url: string | null;
  items: {
    id: string;
    actionType: string;
    title: string;
    rationale: string | null;
    gtin: string | null;
    productName: string | null;
    expectedImpactCents: number | null;
    url: string | null;
  }[];
}

export interface MercadoflowDecisions {
  enabled: boolean;
  stores: MercadoflowStoreDecisions[];
}

/** Notas que chegaram no Confere e ainda não foram vistas (GET /mercadoflow/confere-notices, MF-14). */
export interface ConfereNotices {
  unseen: number;
  items: {
    id: string;
    storeId: string;
    documentId: string;
    supplierName: string | null;
    invoiceNumber: string | null;
    totalCents: number | null;
    itemsCount: number | null;
    receivedAt: string;
  }[];
}

// ---------- Pedidos de compra (F4-01) ----------

export const purchaseOrderInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  supplierId: z.string().uuid('Escolha o fornecedor'),
  expectedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de entrega inválida')
    .nullish(),
  notes: z.string().trim().max(500).nullish(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityMilli: z.number().int().positive('A quantidade precisa ser maior que zero'),
        unitCostCents: z.number().int().nonnegative('Custo inválido'),
      }),
    )
    .min(1, 'Coloque pelo menos um produto no pedido')
    .max(500, 'Pedido com itens demais'),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderInput>;

export const purchaseOrderCancelInput = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo do cancelamento').max(200),
});

export type PurchaseOrderStatus = 'draft' | 'sent' | 'received' | 'cancelled';

export interface PurchaseOrderView {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  storeId: string;
  storeName: string;
  supplierId: string;
  supplierName: string;
  supplierTaxId: string | null;
  expectedAt: string | null;
  notes: string | null;
  totalCents: number;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: {
    line: number;
    productId: string;
    productName: string;
    unit: string;
    quantityMilli: number;
    unitCostCents: number;
    totalCents: number;
    /** Quanto chegou na entrada (F4-02); nulo antes do recebimento. */
    receivedMilli: number | null;
    /** Códigos de barras do produto, para conferir bipando. */
    barcodes: string[];
  }[];
}

/** Entrada de mercadoria do pedido (F4-02): quanto chegou de cada linha. */
export const purchaseOrderReceiveInput = z.object({
  items: z
    .array(
      z.object({
        line: z.number().int().positive(),
        receivedMilli: z.number().int().nonnegative('Quantidade recebida inválida'),
      }),
    )
    .min(1)
    .max(500),
  note: z.string().trim().max(300).optional(),
});

/** Impostos da venda do produto em % do preço, para formar o preço (F4-03). */
export interface ProductPricing {
  productId: string;
  productName: string;
  costCents: number | null;
  priceCents: number;
  companyId: string;
  regime: string | null;
  /** Simples Nacional: os tributos estão no DAS; a alíquota efetiva vem da pessoa. */
  simples: boolean;
  /** Cada imposto em centésimos de ponto percentual (1250 = 12,5%). */
  taxes: { label: string; bp: number }[];
  taxesBp: number;
  /** O que falta configurar para o cálculo ficar completo. */
  pending: string[];
  notes: string[];
}

// ---------- Contas a pagar e a receber (F4-04) ----------

export const financialEntryInput = z
  .object({
    kind: z.enum(['payable', 'receivable']),
    companyId: z.string().uuid().optional(),
    description: z.string().trim().min(2, 'Descreva a conta').max(200),
    category: z.string().trim().max(60).nullish(),
    supplierId: z.string().uuid().nullish(),
    customerId: z.string().uuid().nullish(),
    document: z.string().trim().max(60).nullish(),
    amountCents: z.number().int().positive('Informe o valor'),
    dueDate: isoDay,
    installments: z.number().int().min(1).max(60).default(1),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((v) => !(v.supplierId && v.customerId), {
    message: 'Escolha fornecedor ou cliente, não os dois',
  });
export type FinancialEntryInput = z.input<typeof financialEntryInput>;

export const financialPaymentInput = z.object({
  paidAt: isoDay,
  paidCents: z.number().int().nonnegative('Valor pago inválido'),
  paymentMethod: z.string().trim().max(40).nullish(),
});

export type FinancialEntryStatus = 'open' | 'paid' | 'cancelled';

export interface FinancialEntryView {
  id: string;
  kind: 'payable' | 'receivable';
  status: FinancialEntryStatus;
  /** Em aberto e vencida (antes de hoje, no fuso de Brasília). */
  overdue: boolean;
  description: string;
  category: string | null;
  partyName: string | null;
  supplierId: string | null;
  customerId: string | null;
  document: string | null;
  amountCents: number;
  dueDate: string;
  installment: number;
  installments: number;
  groupId: string;
  paidAt: string | null;
  paidCents: number | null;
  paymentMethod: string | null;
  cancelReason: string | null;
}

export interface FinancialSummary {
  payable: { openCents: number; overdueCents: number; dueNext7Cents: number };
  receivable: { openCents: number; overdueCents: number; dueNext7Cents: number };
}

/** Uma linha do fluxo de caixa (F4-05): dia (AAAA-MM-DD) ou mês (AAAA-MM). */
export interface CashFlowRow {
  period: string;
  /** Vendas recebidas (sem crediário), menos devoluções pagas. */
  salesCents: number;
  receivedCents: number;
  paidCents: number;
  netCents: number;
  projectedInCents: number;
  projectedOutCents: number;
  /** Saldo acumulado do realizado desde o início do período. */
  balanceCents: number;
}

/** Um mês da DRE gerencial (F4-06), em centavos. */
export interface DreMonth {
  month: string;
  grossRevenueCents: number;
  returnsCents: number;
  taxesCents: number;
  netRevenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expenses: { category: string; cents: number }[];
  expensesCents: number;
  resultCents: number;
}

export interface DreReport {
  months: DreMonth[];
  notes: string[];
}

// ---------- Conciliação bancária (F4-07) ----------

export const bankImportInput = z.object({
  /** Conteúdo do arquivo .ofx (texto). */
  content: z.string().min(20, 'Escolha o arquivo do extrato (.ofx)').max(5_000_000),
});

export interface BankTransactionView {
  id: string;
  bankAccountName: string;
  postedOn: string;
  amountCents: number;
  memo: string;
  status: 'pending' | 'matched' | 'ignored';
  entryId: string | null;
  /** Contas em aberto de mesmo valor e sentido com vencimento até 10 dias de distância. */
  suggestions: { id: string; description: string; dueDate: string; partyName: string | null }[];
}

export interface BankImportResult {
  account: string;
  imported: number;
  repeated: number;
}

// ---------- Recebíveis de cartão e Pix (F4-08) ----------

export const SETTLEMENT_METHODS = ['credit', 'debit', 'pix', 'voucher'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const settlementRulesInput = z.object({
  rules: z
    .array(
      z.object({
        method: z.enum(SETTLEMENT_METHODS),
        feeBp: z.number().int().min(0).max(10_000, 'Taxa acima de 100%'),
        days: z.number().int().min(0).max(120, 'Prazo de até 120 dias'),
      }),
    )
    .min(1),
});

export interface SettlementRuleView {
  method: SettlementMethod;
  feeBp: number;
  days: number;
  /** Ainda não configurada pela loja: vale o prazo usual com taxa zero. */
  configured: boolean;
}

export interface SettlementDay {
  /** Data prevista do recebimento (AAAA-MM-DD). */
  date: string;
  method: SettlementMethod;
  salesCount: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
  /** Achou entrada no extrato com o valor líquido, na data ou um dia depois. */
  received: boolean;
}

/** Cliente com parcela do crediário vencida (F4-09). */
export interface DelinquentCustomer {
  customerId: string | null;
  name: string;
  taxId: string;
  phone: string | null;
  overdueCents: number;
  installments: number;
  oldestDue: string;
  daysLate: number;
  /** Atraso acima da tolerância: o caixa não vende mais no crediário. */
  blocked: boolean;
}

// ---------- Relatórios (F4-10) ----------

export type SalesReportGroup = 'product' | 'operator' | 'store' | 'payment' | 'day';

export interface SalesReportRow {
  key: string;
  label: string;
  /** Só por produto. */
  quantityMilli: number | null;
  salesCount: number;
  revenueCents: number;
  /** Nulo quando algum item não tem custo no cadastro (ou por forma de pagamento). */
  costCents: number | null;
  marginCents: number | null;
  /** Margem sobre a receita em centésimos de ponto (2500 = 25%). */
  marginBp: number | null;
  avgTicketCents: number;
  /** Curva ABC (só por produto). */
  abc: 'A' | 'B' | 'C' | null;
}

export interface SalesReport {
  from: string;
  to: string;
  group: SalesReportGroup;
  salesCount: number;
  revenueCents: number;
  avgTicketCents: number;
  rows: SalesReportRow[];
}

// ---------- Inventário pelo celular (F4-11) ----------

export const inventoryInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  name: z.string().trim().min(2, 'Dê um nome à contagem').max(80),
});

/** add: soma (cada bipe); set: troca pelo valor digitado. Pelo produto ou pelo código. */
export const inventoryCountInput = z
  .object({
    productId: z.string().uuid().optional(),
    code: z.string().trim().min(1).max(60).optional(),
    mode: z.enum(['add', 'set']),
    quantityMilli: z.number().int().nonnegative('Quantidade inválida'),
  })
  .refine((v) => v.productId || v.code, { message: 'Bipe ou escolha o produto' });

export interface InventoryView {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  status: 'open' | 'closed' | 'cancelled';
  createdAt: string;
  closedAt: string | null;
  items: {
    productId: string;
    productName: string;
    unit: string;
    countedMilli: number;
    /** Estoque do sistema agora, para mostrar a diferença antes de fechar. */
    systemMilli: number;
  }[];
}

// ---------- Transferência entre lojas (F4-12) ----------

export const stockTransferInput = z
  .object({
    fromStoreId: z.string().uuid('Escolha a loja de origem'),
    toStoreId: z.string().uuid('Escolha a loja de destino'),
    note: z.string().trim().max(200).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantityMilli: z.number().int().positive('Quantidade inválida'),
        }),
      )
      .min(1, 'Inclua pelo menos um produto')
      .max(500),
  })
  .refine((v) => v.fromStoreId !== v.toStoreId, {
    message: 'A origem e o destino precisam ser lojas diferentes',
  })
  .refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
    message: 'O mesmo produto aparece duas vezes',
  });

/** Sem itens: chegou tudo. Com itens: o que chegou de fato de cada produto. */
export const stockTransferReceiveInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        receivedMilli: z.number().int().nonnegative('Quantidade inválida'),
      }),
    )
    .optional(),
});

export const stockTransferCancelInput = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo do cancelamento').max(200),
});

export interface StockTransferView {
  id: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: 'in_transit' | 'received' | 'cancelled';
  note: string | null;
  /** Lojas de CNPJs diferentes: a mercadoria precisa de NF-e de transferência. */
  needsInvoice: boolean;
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantityMilli: number;
    receivedMilli: number | null;
  }[];
}

// ---------- Apuração de IBS e CBS (F4-13) ----------

export interface IbsCbsBalanceView {
  debitCents: number;
  creditCents: number;
  balanceCents: number;
  payableCents: number;
  creditLeftCents: number;
}

export interface IbsCbsSettlementView {
  companyId: string;
  companyName: string;
  /** AAAA-MM */
  month: string;
  mode: 'regular' | 'simples' | 'falta-configurar';
  message: string | null;
  totals: {
    salesIbsCents: number;
    salesCbsCents: number;
    returnsIbsCents: number;
    returnsCbsCents: number;
    purchasesIbsCents: number;
    purchasesCbsCents: number;
  };
  ibs: IbsCbsBalanceView | null;
  cbs: IbsCbsBalanceView | null;
  /** Regra do período (em 2026, a dispensa de recolhimento da fase de teste). */
  period: { message: string; paymentWaived: boolean; source: string } | null;
  sources: string[];
  /** O que ficou de fora da conta e precisa de atenção. */
  pending: {
    saleItemsWithoutTax: number;
    purchaseItemsWithoutIbsCbs: number;
    /** Itens de notas marcadas como uso ou consumo pessoal, fora do crédito (art. 57). */
    purchaseItemsPersonalUse: number;
  };
}

// ---------- Etiquetas de gôndola e de balança (F5-01) ----------

export const labelsInput = z
  .object({
    kind: z.enum(['shelf', 'scale']),
    /** Loja: o preço sai da tabela de preço da loja, quando ela tem uma. */
    storeId: z.string().uuid().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          copies: z.number().int().min(1).max(100).default(1),
          /** Etiqueta de balança: o peso da embalagem, em gramas. */
          grams: z.number().int().min(1, 'Peso inválido').max(99_999, 'Peso inválido').optional(),
        }),
      )
      .min(1, 'Escolha pelo menos um produto')
      .max(300),
  })
  .refine((v) => v.kind !== 'scale' || v.items.every((i) => i.grams), {
    message: 'Informe o peso de cada etiqueta de balança',
  });

// ---------- Promoções do caixa (F5-02) ----------

const productIdList = z
  .array(z.string().uuid())
  .min(1, 'Escolha pelo menos um produto')
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, 'O mesmo produto aparece duas vezes');

export const promotionRuleInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('buy_x_pay_y'),
      productIds: productIdList,
      buy: z.number().int().min(2, 'Leve pelo menos 2').max(100),
      pay: z.number().int().min(1, 'Pague pelo menos 1'),
    })
    .refine((r) => r.pay < r.buy, { message: 'Quem leva precisa pagar menos do que leva' }),
  z.object({
    kind: z.literal('quantity_tier'),
    productIds: productIdList,
    tiers: z
      .array(
        z.object({
          minQuantityMilli: z.number().int().positive('Quantidade inválida'),
          unitPriceCents: z.number().int().positive('Preço inválido'),
        }),
      )
      .min(1, 'Informe pelo menos uma faixa')
      .max(10)
      .refine(
        (t) => new Set(t.map((x) => x.minQuantityMilli)).size === t.length,
        'Duas faixas com a mesma quantidade',
      ),
  }),
  z.object({
    kind: z.literal('combo'),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantityMilli: z
            .number()
            .int()
            .positive()
            .refine((q) => q % 1000 === 0, 'O combo usa unidades inteiras'),
        }),
      )
      .min(2, 'O combo precisa de pelo menos dois produtos')
      .max(10)
      .refine(
        (items) => new Set(items.map((i) => i.productId)).size === items.length,
        'O mesmo produto aparece duas vezes',
      ),
    priceCents: z.number().int().positive('Preço inválido'),
  }),
]);

export const promotionInput = z
  .object({
    name: z.string().trim().min(2, 'Dê um nome à promoção').max(80),
    startsOn: isoDay,
    endsOn: isoDay.nullable().default(null),
    active: z.boolean().default(true),
    /** Só nesta loja; sem loja, vale em todas as lojas da empresa. */
    storeId: z.string().uuid().nullable().default(null),
    rule: promotionRuleInput,
  })
  .refine((p) => p.endsOn === null || p.endsOn >= p.startsOn, {
    message: 'O fim precisa ser depois do início',
  });

export type PromotionRule = z.output<typeof promotionRuleInput>;

export interface PromotionView {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  /** Só nesta loja (null = todas). */
  storeId: string | null;
  rule: PromotionRule;
  /** Nome dos produtos da regra, para a tela. */
  products: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

// ---------- NFC-e da venda (F3-14) ----------

export type FiscalDocumentStatus =
  | 'pending'
  | 'error'
  | 'not_configured'
  | 'authorized'
  | 'rejected'
  | 'denied'
  /** Cancelamento registrado na SEFAZ (F3-17). */
  | 'cancelled'
  /** Venda cancelada antes de a nota sair: o número vai para a inutilização. */
  | 'voided';

/** Ajuda em linguagem simples para um código de rejeição da SEFAZ (F3-18). */
export interface RejectionHelpView {
  cause: string;
  fix: string;
  next: 'corrigir' | 'automatico' | 'suporte';
  area: string;
}

export interface FiscalDocumentView {
  id: string;
  /** Venda do caixa (NFC-e) ou rascunho da retaguarda (NF-e, F3-33). */
  saleId: string | null;
  invoiceId: string | null;
  model: string;
  series: number | null;
  number: number | null;
  accessKey: string | null;
  status: FiscalDocumentStatus;
  /** O que falta configurar para emitir (status not_configured). */
  pendingItems: string[];
  /** Emitida em contingência off-line (F3-15). */
  contingency: boolean;
  /** NF-e em contingência SVC (F3-16) e a chave da tentativa normal que ela substituiu. */
  contingencyMode?: 'SVC-AN' | 'SVC-RS' | null;
  replacedAccessKey?: string | null;
  /** Recusada ou denegada: a causa e o que fazer, em linguagem simples (F3-18). */
  help: RejectionHelpView | null;
  cStat: string | null;
  xMotivo: string | null;
  protocol: string | null;
  attempts: number;
  lastError: string | null;
  authorizedAt: string | null;
  updatedAt: string;
  /** Pedido de cancelamento da nota na SEFAZ (F3-17), quando a venda foi cancelada. */
  cancellation: {
    status: 'pending' | 'error' | 'registered' | 'rejected';
    reason: string;
    cStat: string | null;
    xMotivo: string | null;
    protocol: string | null;
    lastError: string | null;
    registeredAt: string | null;
    help: RejectionHelpView | null;
  } | null;
}

// ---------- Inutilização de numeração (F3-17) ----------

/** Faixa de números da série sem nota, que precisa ser inutilizada. */
export interface NumberingGapView {
  model: '65';
  series: number;
  from: number;
  to: number;
}

export interface InutilizationView {
  id: string;
  companyId: string;
  model: string;
  series: number;
  from: number;
  to: number;
  year: string;
  reason: string;
  status: 'registered' | 'rejected';
  cStat: string;
  xMotivo: string;
  protocol: string | null;
  help: RejectionHelpView | null;
  createdAt: string;
}

export const inutilizationInput = z
  .object({
    companyId: z.string().uuid(),
    model: z.literal('65').default('65'),
    series: z.number().int().min(1, 'Série inválida.').max(999, 'Série inválida.'),
    from: z.number().int().min(1, 'Número inicial inválido.').max(999_999_999),
    to: z.number().int().min(1, 'Número final inválido.').max(999_999_999),
    reason: z
      .string()
      .trim()
      .min(15, 'A justificativa precisa ter pelo menos 15 caracteres.')
      .max(255, 'A justificativa pode ter no máximo 255 caracteres.'),
  })
  .refine((v) => v.to >= v.from, {
    message: 'O número final não pode ser menor que o inicial.',
    path: ['to'],
  });
export type InutilizationInput = z.infer<typeof inutilizationInput>;

// ---------- Painel de prevenção de perdas (F5-05) ----------

export interface LossOperatorView {
  operatorId: string;
  name: string;
  salesCount: number;
  salesCents: number;
  cancelledCount: number;
  cancelledCents: number;
  /** Cancelamentos sobre vendas, em pontos-base (100 = 1%). */
  cancelRateBp: number;
  returnsCount: number;
  returnsCents: number;
  /** Vendas com desconto acima do limite, autorizado por um supervisor. */
  authorizedDiscountCount: number;
  authorizedDiscountCents: number;
  withdrawalsCount: number;
  withdrawalsCents: number;
  /** Soma das diferenças no fechamento do caixa (negativo = faltou dinheiro). */
  cashDifferenceCents: number;
  alerts: string[];
}

export interface LossProductView {
  productId: string;
  name: string;
  /** Quantidade perdida, em milésimos (ajustes e diferenças de contagem para menos). */
  lostMilli: number;
  /** Valor a custo; null quando o produto não tem custo cadastrado. */
  lostCostCents: number | null;
}

export interface ExpiredLotView {
  productId: string;
  name: string;
  lotCode: string;
  expiresOn: string;
  quantityMilli: number;
  costCents: number | null;
}

export interface LossDashboardView {
  from: string;
  to: string;
  totals: {
    salesCount: number;
    salesCents: number;
    cancelledCount: number;
    cancelledCents: number;
    returnsCount: number;
    returnsCents: number;
    authorizedDiscountCount: number;
    authorizedDiscountCents: number;
    withdrawalsCount: number;
    withdrawalsCents: number;
    cashDifferenceCents: number;
    stockLossCostCents: number;
    expiredCostCents: number;
  };
  operators: LossOperatorView[];
  products: LossProductView[];
  expiredLots: ExpiredLotView[];
  /** Avisos em linguagem simples, do mais importante para o menos. */
  alerts: string[];
}

// ---------- Comandas (F5-07) ----------

export interface TabView {
  id: string;
  storeId: string;
  terminalId: string;
  label: string;
  status: 'open' | 'paid' | 'cancelled';
  items: {
    line: number;
    productId: string;
    name: string;
    unit: string;
    quantityMilli: number;
    unitPriceCents: number;
  }[];
  totalCents: number;
  saleId: string | null;
  cancelReason: string | null;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
}

// ---------- Cozinha (F5-09) ----------

export interface KitchenTicketView {
  id: string;
  storeId: string;
  tabId: string;
  tabLabel: string;
  line: number;
  productId: string;
  name: string;
  quantityMilli: number;
  status: 'pending' | 'ready' | 'delivered' | 'cancelled';
  createdAt: string;
  readyAt: string | null;
  deliveredAt: string | null;
}

// ---------- Pedidos do garçom (F5-08) ----------

export const tabOrderInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  label: z.string().trim().min(1, 'Informe a mesa ou a comanda').max(30, 'Até 30 letras'),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000),
      }),
    )
    .min(1, 'Escolha pelo menos um item')
    .max(100),
});
export type TabOrderInput = z.input<typeof tabOrderInput>;

export interface TabOrderView {
  id: string;
  storeId: string;
  label: string;
  items: { productId: string; name: string; quantityMilli: number }[];
  waiterName: string;
  /** pending: esperando o caixa; received: na comanda; rejected: o caixa não conseguiu. */
  status: 'pending' | 'received' | 'rejected';
  reason: string | null;
  createdAt: string;
  receivedAt: string | null;
}

// ---------- Delivery com taxa por bairro (F5-10) ----------

export const deliveryZoneInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  name: z.string().trim().min(2, 'Informe o bairro').max(60, 'Nome do bairro muito longo'),
  feeCents: z.number().int().min(0, 'Taxa inválida').max(100_000, 'Taxa muito alta'),
  active: z.boolean().default(true),
});
export type DeliveryZoneInput = z.input<typeof deliveryZoneInput>;

export interface DeliveryZoneView {
  id: string;
  storeId: string;
  name: string;
  feeCents: number;
  active: boolean;
}

export interface DeliveryView {
  saleId: string;
  storeId: string;
  terminalSeq: number;
  totalCents: number;
  occurredAt: string;
  /** pending: a sair; out: saiu para entrega; delivered: entregue. */
  status: 'pending' | 'out' | 'delivered';
  updatedAt: string;
  delivery: {
    zoneId: string | null;
    zoneName: string;
    feeCents: number;
    name: string;
    phone: string;
    address: {
      street: string;
      number: string;
      complement: string | null;
      district: string;
      cityCode: string | null;
      cityName: string | null;
      uf: string | null;
      cep: string | null;
    };
  };
}

// ---------- Venda condicional (F5-12.b) ----------

/** Prazo máximo de volta: a suspensão do ICMS vale por 60 dias (Ajuste SINIEF 02/18, cl. 4ª). */
export const CONDITIONAL_MAX_DAYS = 60;

export const conditionalInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  customerId: z.string().uuid('Escolha o cliente'),
  /** Sem data, vale o prazo máximo. */
  dueOn: isoDay.optional(),
  note: z.string().trim().max(300).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000),
      }),
    )
    .min(1, 'Escolha pelo menos uma peça')
    .max(100),
});
export type ConditionalInput = z.input<typeof conditionalInput>;

/** Na volta: quanto de cada peça o cliente ficou (o resto voltou à loja). */
export const conditionalCloseInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        keptMilli: z.number().int().min(0, 'Quantidade inválida'),
      }),
    )
    .max(100),
});
export type ConditionalCloseInput = z.input<typeof conditionalCloseInput>;

export interface ConditionalView {
  id: string;
  number: number;
  storeId: string;
  storeName: string;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  status: 'open' | 'closed' | 'cancelled';
  dueOn: string;
  /** Passou do prazo e ainda está aberto. */
  overdue: boolean;
  note: string | null;
  createdAt: string;
  closedAt: string | null;
  /** Pedido enviado ao caixa com o que o cliente ficou (F5-08). */
  tabOrderId: string | null;
  /** NF-e do condicional (F5-12.c): remessa, retorno, entrada simbólica e venda. */
  invoices: {
    id: string;
    demonstration: 'remessa' | 'retorno' | 'entradaSimbolica' | 'venda';
    status: 'draft' | 'issued' | 'discarded';
    documentStatus: FiscalDocumentStatus | null;
    number: number | null;
    /** O que falta resolver para emitir (rascunho). */
    pending: string[];
  }[];
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantityMilli: number;
    unitPriceCents: number;
    keptMilli: number | null;
  }[];
  totalCents: number;
}

// ---------- API pública: chaves (F6-01.a, ADR-0016) ----------

/** Escopos que uma chave pode receber: por enquanto, só leitura. */
export const PUBLIC_API_SCOPES = ['catalog.read', 'parties.read'] as const;
export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export const PUBLIC_API_SCOPE_LABELS: Record<PublicApiScope, string> = {
  'catalog.read': 'Ler produtos, preços, estoque e vendas',
  'parties.read': 'Ler clientes e fornecedores',
};

export const apiKeyInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome para a chave (ex.: Loja virtual)').max(60),
  scopes: z
    .array(z.enum(PUBLIC_API_SCOPES))
    .min(1, 'Escolha pelo menos uma permissão')
    .transform((s) => [...new Set(s)]),
});
export type ApiKeyInput = z.input<typeof apiKeyInput>;

export interface ApiKeyView {
  id: string;
  name: string;
  /** Começo da chave, para reconhecer (a chave inteira só aparece ao criar). */
  prefix: string;
  scopes: string[];
  createdByName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Resposta da criação: a única vez em que a chave inteira aparece. */
export interface ApiKeyCreated extends ApiKeyView {
  key: string;
}

// ---------- API pública: webhooks (F6-01.c, ADR-0016) ----------

export const WEBHOOK_EVENTS = [
  'sale.completed',
  'sale.cancelled',
  'sale.returned',
  'product.updated',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'sale.completed': 'Venda feita no caixa',
  'sale.cancelled': 'Venda cancelada',
  'sale.returned': 'Devolução de venda',
  'product.updated': 'Produto cadastrado ou alterado (inclusive preço)',
};

export const webhookInput = z.object({
  url: z
    .string()
    .trim()
    .url('Informe o endereço completo, começando com https://')
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'O endereço precisa começar com https://'),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1, 'Escolha pelo menos um aviso')
    .transform((e) => [...new Set(e)]),
  active: z.boolean().default(true),
});
export type WebhookInput = z.input<typeof webhookInput>;

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  /** Resumo das últimas entregas. */
  pending: number;
  failed: number;
  lastDeliveryAt: string | null;
}

/** Na criação (e ao gerar outro): a única vez em que o segredo aparece. */
export interface WebhookCreated extends WebhookView {
  secret: string;
}

export interface WebhookDeliveryView {
  id: string;
  event: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

// ---------- CRM (F6-08.a) ----------

/** Resumo do cliente para a ficha: o que ele comprou, pelo CPF/CNPJ. */
export interface CustomerSummary {
  customerId: string;
  /** Sem CPF/CNPJ no cadastro não há como juntar as compras. */
  hasTaxId: boolean;
  purchases: number;
  /** Compras menos devoluções. */
  totalCents: number;
  averageTicketCents: number | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  averageIntervalDays: number | null;
  segment: 'novo' | 'frequente' | 'sumido' | 'ativo' | null;
  topProducts: { productId: string; name: string; quantityMilli: number; totalCents: number }[];
  recentSales: {
    id: string;
    occurredAt: string;
    kind: 'sale' | 'return';
    status: 'completed' | 'cancelled';
    totalCents: number;
    storeName: string;
  }[];
}

/** Uma linha da lista de relacionamento (segmentos). */
export interface CrmCustomerRow {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  marketingConsent: boolean;
  purchases: number;
  totalCents: number;
  lastPurchaseAt: string;
  segment: 'novo' | 'frequente' | 'sumido' | 'ativo';
}

// ---------- Fidelidade (F6-08.b) ----------

export const loyaltyProgramInput = z.object({
  active: z.boolean(),
  centsPerPoint: z.number().int().min(1, 'Informe quanto de compra vale 1 ponto').max(100_000),
  pointValueCents: z.number().int().min(1, 'Informe quanto vale 1 ponto').max(10_000),
  expiryMonths: z.number().int().min(1).max(60),
  minRedeemPoints: z.number().int().min(1).max(1_000_000),
});
export type LoyaltyProgramInput = z.input<typeof loyaltyProgramInput>;

export interface LoyaltyStatement {
  /** Sem CPF/CNPJ no cadastro não há pontos. */
  hasTaxId: boolean;
  points: number;
  /** Quanto os pontos valem hoje, em centavos. */
  valueCents: number;
  entries: {
    kind: 'earn' | 'redeem' | 'reverse_earn' | 'reverse_redeem';
    points: number;
    saleId: string | null;
    createdAt: string;
    expiresAt: string | null;
  }[];
}

// ---------- NF-e da retaguarda (F3-33) ----------

/** Destinatário da NF-e: copiado do cadastro do cliente e conferido na própria nota. */
export const nfeRecipientInput = z.object({
  customerId: z.string().uuid().nullish(),
  taxId: taxIdSchema,
  name: trimmed(2, 60, 'Nome do destinatário'),
  /** 1 contribuinte do ICMS (com IE), 2 contribuinte isento de inscrição, 9 não contribuinte. */
  ieIndicator: z.union([z.literal(1), z.literal(2), z.literal(9)], {
    message: 'Diga se o destinatário é contribuinte do ICMS',
  }),
  ie: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{2,14}$/, 'Inscrição estadual inválida'))
    .nullish()
    .or(z.literal('').transform(() => null)),
  email: emailSchema.nullish().or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{10,13}$/, 'Telefone inválido'))
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: addressSchema,
});

export const NFE_FREIGHT_MODES = [
  'porContaDoRemetente',
  'porContaDoDestinatario',
  'porContaDeTerceiros',
  'proprioPorContaDoRemetente',
  'proprioPorContaDoDestinatario',
  'semFrete',
] as const;

export const NFE_PRESENCE_MODES = [
  'presencial',
  'internet',
  'teleatendimento',
  'entregaEmDomicilio',
  'presencialForaDoEstabelecimento',
  'outros',
] as const;

export const nfeInvoiceInput = z
  .object({
    companyId: z.string().uuid('Escolha a empresa emitente'),
    storeId: z.string().uuid('Escolha a loja'),
    nature: trimmed(1, 60, 'Natureza da operação').default('Venda de mercadoria'),
    purpose: z.enum(['normal', 'devolucao']).default('normal'),
    presence: z.enum(NFE_PRESENCE_MODES).default('presencial'),
    /** Sem a escolha, é consumidor final quem não é contribuinte do ICMS. */
    finalConsumer: z.boolean().nullish(),
    references: z
      .array(z.string().regex(/^[0-9A-Z]{44}$/, 'Chave de acesso com 44 caracteres'))
      .max(20)
      .default([]),
    recipient: nfeRecipientInput,
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000_000),
          unitPriceCents: centsSchema,
          discountCents: centsSchema.default(0),
          /** CFOP próprio do item; sem ele, vale o do perfil fiscal do produto. */
          cfop: z
            .string()
            .regex(/^\d{4}$/, 'CFOP com 4 dígitos')
            .nullish(),
        }),
      )
      .min(1, 'Escolha pelo menos um produto')
      .max(990, 'A NF-e aceita no máximo 990 itens'),
    transport: z
      .object({
        freight: z.enum(NFE_FREIGHT_MODES).default('semFrete'),
        freightCents: centsSchema.default(0),
        carrier: z
          .object({
            taxId: optionalTaxId,
            name: trimmed(2, 60, 'Nome da transportadora'),
            uf: z.enum(UFS).nullish(),
          })
          .nullish(),
        volumes: z
          .object({
            quantity: z.number().int().positive().max(999_999).nullish(),
            species: optionalText(60),
            grossKg: z
              .string()
              .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Peso em kg, com ponto')
              .nullish(),
          })
          .nullish(),
      })
      .default({ freight: 'semFrete', freightCents: 0 }),
    installments: z
      .array(z.object({ dueDate: isoDay, amountCents: centsSchema }))
      .max(120)
      .default([]),
    /** Pagamentos pelo código tPag da tabela oficial (90 = sem pagamento). */
    payments: z
      .array(
        z.object({
          code: z.string().regex(/^\d{2}$/, 'Meio de pagamento inválido'),
          amountCents: centsSchema,
          description: optionalText(60),
        }),
      )
      .min(1, 'Informe o pagamento')
      .max(100),
    additionalInfo: optionalText(2000),
  })
  .refine((v) => v.purpose !== 'devolucao' || v.references.length > 0, {
    message: 'A devolução precisa da chave da nota devolvida',
    path: ['references'],
  });
export type NfeInvoiceInput = z.input<typeof nfeInvoiceInput>;

export interface NfeInvoiceView {
  id: string;
  /** Nota da venda condicional (Ajuste SINIEF 02/18, F5-12.c): de qual condicional e qual nota. */
  conditionalId: string | null;
  demonstration: 'remessa' | 'retorno' | 'entradaSimbolica' | 'venda' | null;
  companyId: string;
  storeId: string;
  status: 'draft' | 'issued' | 'discarded';
  nature: string;
  purpose: 'normal' | 'devolucao';
  presence: (typeof NFE_PRESENCE_MODES)[number];
  finalConsumer: boolean | null;
  references: string[];
  recipient: z.output<typeof nfeRecipientInput>;
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantityMilli: number;
    unitPriceCents: number;
    discountCents: number;
    cfop: string | null;
  }[];
  transport: z.output<typeof nfeInvoiceInput>['transport'];
  installments: { dueDate: string; amountCents: number }[];
  payments: { code: string; amountCents: number; description: string | null }[];
  additionalInfo: string | null;
  /** Total dos produtos menos os descontos, mais o frete (sem a ST e o IPI). */
  totalCents: number;
  /** Conferência com o motor: o que falta para emitir e os avisos (CFOP trocado, FCP...). */
  check: { ok: boolean; pending: string[]; notes: string[]; totalCents: number | null };
  /** A nota na SEFAZ, depois de emitida. */
  document: FiscalDocumentView | null;
  /** Cartas de correção da NF-e (F3-33.g), da mais nova para a mais antiga. */
  corrections: NfeCorrectionView[];
  createdAt: string;
  updatedAt: string;
}

export interface NfeCorrectionView {
  sequence: number;
  text: string;
  status: 'pending' | 'error' | 'registered' | 'rejected';
  cStat: string | null;
  xMotivo: string | null;
  protocol: string | null;
  lastError: string | null;
  registeredAt: string | null;
}

// ---------- Notas contra o CNPJ da empresa (distribuição de DF-e, F3-20) ----------

export const DFE_MANIFESTATIONS = [
  'ciencia',
  'confirmacao',
  'desconhecimento',
  'naoRealizada',
] as const;

export const dfeManifestInput = z
  .object({
    type: z.enum(DFE_MANIFESTATIONS, { message: 'Escolha a manifestação' }),
    reason: optionalText(255),
  })
  .refine((v) => v.type !== 'naoRealizada' || (v.reason?.length ?? 0) >= 15, {
    message: 'Diga por que a operação não foi realizada (pelo menos 15 caracteres)',
    path: ['reason'],
  });
export type DfeManifestInput = z.input<typeof dfeManifestInput>;

export interface DfeDocumentView {
  id: string;
  companyId: string;
  accessKey: string;
  issuerTaxId: string;
  issuerName: string;
  issuedAt: string | null;
  totalCents: number;
  situation: 'autorizada' | 'denegada' | 'cancelada' | null;
  /** A nota completa já chegou (depois da ciência), pronta para dar entrada. */
  hasXml: boolean;
  manifestation: (typeof DFE_MANIFESTATIONS)[number] | null;
  manifestationStatus: 'registered' | 'rejected' | 'error' | null;
  manifestationMessage: string | null;
  /** A compra já entrou pelo XML (F3-19). */
  purchaseId: string | null;
}

export interface DfeSyncResult {
  /** Documentos novos ou atualizados nesta busca. */
  received: number;
  /** Quando dá para perguntar de novo ao Ambiente Nacional (null: já). */
  nextQueryAt: string | null;
  message: string;
}

/** Emitir a NF-e na contingência SVC (F3-16): o motivo vai na nota (xJust, 15 a 256 caracteres). */
/**
 * Carta de correção da NF-e (F3-33.g): o texto substitui o das cartas anteriores, então traz tudo
 * o que está sendo corrigido. Não corrige valores, impostos, quantidade, remetente, destinatário
 * nem datas (Convênio S/N de 1970, art. 7º, § 1º-A).
 */
export const nfeCorrectionInput = z.object({
  text: z
    .string()
    .trim()
    .min(15, 'Escreva a correção com pelo menos 15 caracteres')
    .max(1000, 'A correção pode ter no máximo 1.000 caracteres'),
});

/** Cancelamento da NF-e autorizada (F3-33.f): a justificativa vai à SEFAZ (15 a 255). */
export const nfeCancelInput = z.object({
  reason: z
    .string()
    .trim()
    .min(15, 'Explique o motivo do cancelamento com pelo menos 15 caracteres')
    .max(255, 'O motivo pode ter no máximo 255 caracteres'),
});

export const nfeContingencyInput = z.object({
  reason: z
    .string()
    .trim()
    .min(15, 'Explique a contingência com pelo menos 15 caracteres')
    .max(256, 'A justificativa pode ter no máximo 256 caracteres'),
});

// ---------- Serviços e ordem de serviço (F5-13.c) ----------

/** Alíquota do ISSQN como texto decimal ("2", "2,5"): até 5% (regra E0595 da NFS-e Nacional). */
const issRate = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim().replace(',', '.'))
  .refine((v) => /^\d(\.\d{1,2})?$/.test(v) && Number(v) <= 5, {
    message: 'Alíquota do ISSQN de 0 a 5%, com até 2 casas',
  });

export const serviceInput = z.object({
  name: trimmed(1, 120, 'Nome do serviço'),
  /** Código de tributação nacional (cTribNac) da lista nacional de serviços. */
  code: z
    .string()
    .transform((v) => v.replace(/\D/g, '').padStart(6, '0'))
    .pipe(z.string().regex(/^\d{6}$/, 'Escolha o serviço na lista nacional')),
  nbs: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{9}$/, 'NBS com 9 dígitos'))
    .nullish()
    .or(z.literal('').transform(() => null)),
  issRate: issRate.nullish().or(z.literal('').transform(() => null)),
  priceCents: centsSchema.default(0),
  active: z.boolean().default(true),
});
export type ServiceInput = z.input<typeof serviceInput>;

export interface ServiceView {
  id: string;
  name: string;
  code: string;
  /** Descrição do código na lista nacional. */
  codeDescription: string | null;
  nbs: string | null;
  issRate: string | null;
  priceCents: number;
  active: boolean;
}

export const SERVICE_ORDER_STATUSES = [
  'open',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
] as const;

export const serviceOrderInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  customerId: z.string().uuid('Escolha o cliente'),
  equipment: optionalText(200),
  problem: optionalText(2000),
  notes: optionalText(2000),
  dueOn: isoDay.nullish(),
  items: z
    .array(
      z
        .object({
          kind: z.enum(['service', 'product']),
          serviceId: z.string().uuid().nullish(),
          productId: z.string().uuid().nullish(),
          description: optionalText(300),
          quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000_000),
          unitPriceCents: centsSchema,
        })
        .refine((i) => (i.kind === 'service' ? Boolean(i.serviceId) : Boolean(i.productId)), {
          message: 'Escolha o serviço ou a peça',
        }),
    )
    .max(200)
    .default([]),
});
export type ServiceOrderInput = z.input<typeof serviceOrderInput>;

export const serviceOrderStatusInput = z.object({
  status: z.enum(['open', 'in_progress', 'ready', 'cancelled'], {
    message: 'Situação inválida',
  }),
});

/** Entrega: o total vira conta a receber com este vencimento (sem data, hoje). */
export const serviceOrderDeliverInput = z.object({ dueDate: isoDay.nullish() });

export interface ServiceOrderView {
  id: string;
  number: number;
  storeId: string;
  storeName: string;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
  status: (typeof SERVICE_ORDER_STATUSES)[number];
  equipment: string | null;
  problem: string | null;
  notes: string | null;
  dueOn: string | null;
  createdAt: string;
  deliveredAt: string | null;
  items: {
    line: number;
    kind: 'service' | 'product';
    serviceId: string | null;
    productId: string | null;
    description: string;
    quantityMilli: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
  servicesCents: number;
  productsCents: number;
  totalCents: number;
}

/** NFS-e Nacional da ordem de serviço (F5-13.d). */
export interface NfseDocumentView {
  id: string;
  serviceOrderId: string;
  series: number;
  number: number;
  status: 'pending' | 'error' | 'not_configured' | 'authorized' | 'rejected' | 'cancelled';
  pendingItems: string[];
  /** Recusa da Sefin: o código da regra e a mensagem. */
  errors: { code: string; message: string }[];
  accessKey: string | null;
  lastError: string | null;
  authorizedAt: string | null;
  /** Pedido de cancelamento (F5-13.g) e a resposta da Sefin. */
  cancellation: {
    status: 'pending' | 'error' | 'registered' | 'rejected';
    code: '1' | '2' | '9';
    reason: string;
    errors: { code: string; message: string }[];
    lastError: string | null;
    cancelledAt: string | null;
  } | null;
}

/**
 * Cancelamento da NFS-e Nacional (F5-13.g): o código da justificativa (1 erro na emissão, 2
 * serviço não prestado, 9 outros) e o texto, de 15 a 255 caracteres.
 */
export const nfseCancelInput = z.object({
  code: z.enum(['1', '2', '9'], { message: 'Escolha o motivo do cancelamento' }),
  reason: z
    .string()
    .trim()
    .min(15, 'Explique o motivo com pelo menos 15 caracteres')
    .max(255, 'O motivo pode ter no máximo 255 caracteres'),
});

// ---------- Recuperar senha por e-mail (P-04.b) ----------

export const passwordForgotInput = z.object({ email: emailSchema });
export const passwordResetInput = z.object({
  token: z.string().trim().min(20, 'Link inválido').max(200, 'Link inválido'),
  password: passwordSchema,
});

/** Confirmar o e-mail da conta pelo link (P-04.c). */
export const emailVerifyInput = z.object({
  token: z.string().trim().min(20, 'Link inválido').max(200, 'Link inválido'),
});
