import { z } from 'zod';
import { emailSchema, passwordSchema, UFS } from './contracts';

/**
 * SaaS platform rules shared by the API and the screens: plans and limits, client account
 * status, and the permissions of the Bipaê staff (super admin). See docs/saas/plano.md.
 */

// ---------------------------------------------------------------- plans and limits

export const LIMIT_RESOURCES = ['companies', 'stores', 'terminals', 'users', 'products'] as const;
export type LimitResource = (typeof LIMIT_RESOURCES)[number];
/** null = unlimited */
export type PlanLimits = Record<LimitResource, number | null>;

export const LIMIT_LABELS: Record<LimitResource, { one: string; many: string }> = {
  companies: { one: 'empresa', many: 'empresas' },
  stores: { one: 'loja', many: 'lojas' },
  terminals: { one: 'caixa', many: 'caixas' },
  users: { one: 'usuário', many: 'usuários' },
  products: { one: 'produto', many: 'produtos' },
};

/** "1 loja", "20 caixas" or "produtos sem limite" for a plan limit. */
export function describeLimit(resource: LimitResource, max: number | null): string {
  const { one, many } = LIMIT_LABELS[resource];
  if (max === null) return `${many} sem limite`;
  return `${max.toLocaleString('pt-BR')} ${max === 1 ? one : many}`;
}

export function effectiveLimits(
  plan: PlanLimits,
  overrides?: Partial<PlanLimits> | null,
): PlanLimits {
  return { ...plan, ...(overrides ?? {}) } as PlanLimits;
}

/** Message shown when creating one more `resource` would exceed the plan. */
export function limitMessage(resource: LimitResource, max: number, planName: string): string {
  const label = max === 1 ? LIMIT_LABELS[resource].one : LIMIT_LABELS[resource].many;
  return `O plano ${planName} permite até ${max} ${label}. Para ampliar, fale com a gente ou mude de plano em Minha assinatura.`;
}

export function withinLimit(limit: number | null, current: number): boolean {
  return limit === null || current < limit;
}

// ---------------------------------------------------------------- account status

export const TENANT_STATUSES = ['active', 'trial', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  active: 'Ativo',
  trial: 'Em teste',
  suspended: 'Suspenso',
  cancelled: 'Cancelado',
};

export interface AccountAccess {
  allowed: boolean;
  code?: 'suspended' | 'cancelled' | 'trial_expired';
  message?: string;
}

/**
 * Whether a client may use the system. Blocked accounts can still upload sales already made
 * offline (the API never refuses sync uploads), so no sale is ever lost.
 */
export function accountAccess(
  status: TenantStatus,
  trialEndsAt: Date | string | null,
  now: Date = new Date(),
): AccountAccess {
  if (status === 'suspended') {
    return {
      allowed: false,
      code: 'suspended',
      message:
        'Esta conta está suspensa. Fale com o suporte do Bipaê para reativar. Nenhuma venda foi perdida.',
    };
  }
  if (status === 'cancelled') {
    return {
      allowed: false,
      code: 'cancelled',
      message: 'Esta conta foi cancelada. Fale com o suporte do Bipaê.',
    };
  }
  if (status === 'trial' && trialEndsAt && new Date(trialEndsAt).getTime() < now.getTime()) {
    return {
      allowed: false,
      code: 'trial_expired',
      message:
        'O período de teste terminou. Escolha um plano para continuar; seus dados estão guardados.',
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------- Bipaê staff

export const PLATFORM_ROLES = ['owner', 'support', 'viewer'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: 'Administrador',
  support: 'Suporte',
  viewer: 'Consulta',
};

export const PLATFORM_PERMISSIONS = {
  'platform.read': 'Ver clientes, uso e auditoria',
  'platform.support': 'Entrar como o cliente (acesso de suporte)',
  'platform.notes': 'Anotar na ficha do cliente',
  'platform.tenants.manage': 'Mudar plano, teste, limites, suspender e reativar clientes',
  'platform.tenants.create': 'Criar clientes',
  'platform.plans.manage': 'Gerenciar planos',
  'platform.announcements.manage': 'Publicar avisos para os clientes',
  'platform.admins.manage': 'Gerenciar a equipe Bipaê',
} as const;
export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  owner: Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[],
  support: ['platform.read', 'platform.support', 'platform.notes'],
  viewer: ['platform.read'],
};

export function platformCan(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role].includes(permission);
}

// ---------------------------------------------------------------- contracts

export const adminLoginInput = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha'),
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos')
    .optional(),
});

export const totpCodeInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos'),
});

const reason = z.string().trim().min(3, 'Informe o motivo').max(500);

const limitValue = z.number().int().min(0).max(1_000_000).nullable();
export const planLimitsSchema = z.object({
  companies: limitValue,
  stores: limitValue,
  terminals: limitValue,
  users: limitValue,
  products: limitValue,
});

export const planInput = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,30}$/, 'Use letras minúsculas, números e hífen'),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).nullish(),
  priceCents: z.number().int().min(0).nullable(),
  limits: planLimitsSchema,
  features: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  public: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export type PlanInput = z.input<typeof planInput>;

export const changePlanInput = z.object({
  planId: z.string().min(1),
  /** When set, the client is on a trial of this plan until this date. */
  trialEndsAt: z.string().datetime({ offset: true }).nullish(),
  reason,
});

export const statusChangeInput = z.object({ reason });

export const limitOverridesInput = z.object({
  overrides: planLimitsSchema.partial(),
  reason,
});

export const noteInput = z.object({ note: z.string().trim().min(1).max(2000) });

export const impersonateInput = z.object({
  reason,
  readOnly: z.boolean().default(true),
});

export const announcementInput = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  level: z.enum(['info', 'warning', 'critical']).default('info'),
  planIds: z.array(z.string()).nullish(),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
});

export const platformAdminInput = z.object({
  email: emailSchema,
  role: z.enum(PLATFORM_ROLES),
});

export const adminCreateTenantInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: emailSchema,
  password: passwordSchema,
  planId: z.string().min(1).default('gratis'),
  trialEndsAt: z.string().datetime({ offset: true }).nullish(),
  uf: z.enum(UFS).nullish(),
});

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
}

export interface AccountView {
  tenant: {
    id: string;
    name: string;
    status: TenantStatus;
    statusReason: string | null;
    trialEndsAt: string | null;
    /** Conta cancelada: quando os dados serão excluídos de vez (P-03). */
    purgeAt: string | null;
  };
  plan: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number | null;
    features: string[];
  };
  limits: PlanLimits;
  usage: Record<LimitResource, number>;
  events: { kind: string; data: unknown; createdAt: string }[];
  plans: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number | null;
    limits: PlanLimits;
  }[];
}
