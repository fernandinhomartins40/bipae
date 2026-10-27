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
  /**
   * E-mail transacional (P-04): servidor SMTP do provedor (smtps://usuario:senha@servidor:465).
   * Sem ele, o e-mail fica desligado e as telas não oferecem o que precisa dele.
   */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Bipaê <nao-responda@bipae.com.br>'),
  /** Endereço público do aplicativo, para os links dos e-mails. */
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'),
  /**
   * Endereço público da API (sem o /v1), para os avisos do banco e dos parceiros de pagamento
   * (F8-09.c.2). Sem ele, usa a origem do APP_PUBLIC_URL (a API atende em /v1 no mesmo domínio).
   */
  API_PUBLIC_URL: z.string().optional(),
  /**
   * Assistente de IA (F6-07, ADR-0011): chave da API dos modelos Claude (item E13). Sem ela, o
   * assistente aparece como "falta configurar" e nada mais muda.
   */
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Chamadas ao provedor por conta por dia, para o custo caber no plano. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(200),
  /**
   * Cobrança dos planos (F6-04): quem recebe a mensalidade. `simulator` só em desenvolvimento e
   * testes (recusado em produção); `mercadopago` ou `pagbank` usam o token da conta do Bipaê.
   * Sem isso, a tela mostra "falta configurar" e nenhuma fatura gera QR. Os preços dos planos
   * ficam na tabela de planos (painel), nunca aqui.
   */
  BILLING_PROVIDER: z.enum(['simulator', 'mercadopago', 'pagbank']).optional(),
  BILLING_TOKEN: z.string().optional(),
  BILLING_SANDBOX: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Boleto da fatura (F6-04.c): `asaas` usa o token da conta do Bipaê no Asaas; `simulator` só fora da
   * produção. Cartão recorrente: só `simulator` por enquanto; o parceiro real depende da conta (E9).
   */
  BILLING_BOLETO_PROVIDER: z.enum(['simulator', 'asaas']).optional(),
  BILLING_BOLETO_TOKEN: z.string().optional(),
  BILLING_CARD_PROVIDER: z.enum(['simulator']).optional(),
  /** Dias de tolerância depois do vencimento, antes do bloqueio gentil. */
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(5),
  /** Quantos dias antes do fim do período a próxima fatura sai. */
  BILLING_ADVANCE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  /**
   * Armazenamento das fotos de produto (F1-08). `db` (padrão) guarda no PostgreSQL; `disk` usa a
   * pasta STORAGE_DIR (em produção, um volume aprovado em E12); `s3` usa um serviço compatível
   * com S3. Segredos do S3 só por variável de ambiente.
   */
  STORAGE_DRIVER: z.enum(['db', 'disk', 's3']).default('db'),
  STORAGE_DIR: z.string().default('.data/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** `false` para endereço bucket.host (AWS); `true` (padrão) para /bucket/chave (MinIO). */
  S3_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
  // A equipe do Bipaê entra no painel com 2FA em produção, sem exceção por variável (F7-02.c).
  if (parsed.NODE_ENV === 'production' && !parsed.PLATFORM_REQUIRE_TOTP) {
    throw new Error('PLATFORM_REQUIRE_TOTP não pode ser desligado em produção');
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
