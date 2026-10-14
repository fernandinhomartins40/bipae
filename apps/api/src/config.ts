import { z } from 'zod';

const DEV_JWT_SECRET = 'bipae-dev-secret-change-me-0123456789abcdef';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3333),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('pglite://.data/bipae'),
  JWT_SECRET: z.string().min(32).default(DEV_JWT_SECRET),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:4173,http://tauri.localhost,tauri://localhost')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  MIN_CLIENT_VERSION_WEB: z.string().optional(),
  MIN_CLIENT_VERSION_DESKTOP: z.string().optional(),
  MIN_CLIENT_VERSION_CONNECTOR: z.string().optional(),
  /** Redis da fila de tarefas (F1-07). Sem ele, a fila roda em memória (desenvolvimento e testes). */
  REDIS_URL: z.string().url().optional(),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Encryption key for secrets at rest (2FA seeds). Defaults to a key derived from JWT_SECRET. */
  SECRETS_KEY: z.string().min(32).optional(),
  ADMIN_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  ADMIN_SESSION_HOURS: z.coerce.number().int().positive().default(12),
  SUPPORT_SESSION_MINUTES: z.coerce.number().int().positive().default(30),
  /** LGPD (P-03): dias entre o cancelamento da conta e a exclusão definitiva dos dados. */
  ACCOUNT_PURGE_DAYS: z.coerce.number().int().positive().default(90),
  /**
   * DEV/TEST ONLY: whoever signs up with this e-mail becomes the first platform owner (only if
   * there is none yet). Ignored in production, where e-mails are not verified: use admin-cli.
   */
  PLATFORM_BOOTSTRAP_EMAIL: z.string().email().optional(),
  /**
   * Integração com o MercadoFlow (catálogo, contas, vendas e Confere). Sem URL, id e segredo, a
   * integração fica desligada e o Bipaê funciona como sempre.
   */
  MERCADOFLOW_API_URL: z.string().optional(),
  MERCADOFLOW_INTERNAL_URL: z.string().optional(),
  MERCADOFLOW_PUBLIC_URL: z.string().default('https://mercadoflow.com'),
  MERCADOFLOW_CLIENT_ID: z.string().optional(),
  MERCADOFLOW_CLIENT_SECRET: z.string().optional(),
  MERCADOFLOW_WEBHOOK_SECRET: z.string().optional(),
  MERCADOFLOW_TERMS_URL: z.string().optional(),
  /** GitHub "owner/repo" whose public Releases carry the desktop installers ('' disables). */
  DESKTOP_RELEASES_REPO: z.string().default('fernandinhomartins40/bipae'),
  /** Bipaê staff must enable 2FA before using the admin panel (always true in production). */
  PLATFORM_REQUIRE_TOTP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Config = z.output<typeof envSchema> & {
  minimumClientVersions: { web?: string; desktop?: string; connector?: string };
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET precisa ser definido em produção');
  }
  return {
    ...parsed,
    minimumClientVersions: {
      ...(parsed.MIN_CLIENT_VERSION_WEB && { web: parsed.MIN_CLIENT_VERSION_WEB }),
      ...(parsed.MIN_CLIENT_VERSION_DESKTOP && { desktop: parsed.MIN_CLIENT_VERSION_DESKTOP }),
      ...(parsed.MIN_CLIENT_VERSION_CONNECTOR && {
        connector: parsed.MIN_CLIENT_VERSION_CONNECTOR,
      }),
    },
  };
}
