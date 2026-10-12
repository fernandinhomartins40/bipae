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
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  MIN_CLIENT_VERSION_WEB: z.string().optional(),
  MIN_CLIENT_VERSION_DESKTOP: z.string().optional(),
  MIN_CLIENT_VERSION_CONNECTOR: z.string().optional(),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
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
