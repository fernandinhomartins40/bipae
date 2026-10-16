import type { LocalStorage } from './storage';

/**
 * Terminal database schema (ADR-0004). The same migrations run on every platform.
 * Quantities are integer thousandths (`*_milli`) so weighed items (kg with 3 decimals) stay exact;
 * money is integer cents (ADR-0008). Never edit a released migration: append a new one.
 */
export const LOCAL_MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- Catalog cache, filled by sync pull. Read-only on the terminal.
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    search_name TEXT NOT NULL,
    sku TEXT,
    unit TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    is_weighable INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    ncm TEXT,
    cest TEXT,
    fiscal_profile_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX products_search ON products (search_name);
  CREATE INDEX products_sku ON products (sku);
  CREATE TABLE barcodes (code TEXT PRIMARY KEY, product_id TEXT NOT NULL);
  CREATE INDEX barcodes_product ON barcodes (product_id);

  -- Cash register sessions (abertura → sangria/suprimento → fechamento cego).
  CREATE TABLE cash_sessions (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    opening_cents INTEGER NOT NULL,
    closed_at TEXT,
    closing_json TEXT
  );
  CREATE TABLE cash_movements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('withdrawal', 'supply')),
    amount_cents INTEGER NOT NULL,
    reason TEXT,
    authorized_by TEXT,
    created_at TEXT NOT NULL
  );

  -- Sales are immutable facts; the full sale is kept as JSON plus queryable columns.
  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    terminal_seq INTEGER NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('sale', 'return')),
    status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')),
    total_cents INTEGER NOT NULL,
    customer_tax_id TEXT,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX sales_session ON sales (session_id);

  -- Quotes (orçamentos) live on the terminal until converted into a sale.
  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'converted', 'discarded')),
    data TEXT NOT NULL
  );

  -- Outbox of events to send to the server (idempotent by id).
  CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT
  );
  CREATE INDEX outbox_pending ON outbox (sent_at, seq);
  `,
  /* 2 — F1-03: tabelas de preço (retrato inteiro vindo do servidor; veja PricingSnapshot) */ `
  CREATE TABLE price_tables (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE price_table_items (
    table_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    PRIMARY KEY (table_id, product_id)
  );
  -- Clientes com tabela própria, pelo CPF/CNPJ (o que o caixa sabe do cliente).
  CREATE TABLE customer_price_tables (tax_id TEXT PRIMARY KEY, price_table_id TEXT NOT NULL);
  `,
  /* 3 — F1-04: variações apontam para o modelo; o modelo não é vendido no caixa */ `
  ALTER TABLE products ADD COLUMN parent_id TEXT;
  CREATE INDEX products_parent ON products (parent_id);
  `,
  /* 4 — F3-06: perfis fiscais (retrato inteiro vindo do servidor; veja FiscalSnapshot) */ `
  CREATE TABLE fiscal_profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `,
  /* 5 — F2-02: crediário (limite e saldo devedor no momento do retrato de preços) */ `
  CREATE TABLE customer_credit (
    tax_id TEXT PRIMARY KEY,
    limit_cents INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL
  );
  `,
  /* 6 — F4-09: cliente com parcela do crediário vencida além da tolerância */ `
  ALTER TABLE customer_credit ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
  `,
  /* 7 — F5-07: comandas (mesa ou número) com os itens lançados aos poucos, até virar venda */ `
  CREATE TABLE tabs (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'cancelled')),
    data TEXT NOT NULL
  );
  CREATE INDEX tabs_status ON tabs (status);
  `,
];

/**
 * Brings the terminal database up to date, one transaction per migration. Runs on every app
 * start, so after an update new migrations apply on top of the existing data (pending sales
 * included). `migrations` is injectable for tests.
 */
export async function migrateLocal(
  storage: LocalStorage,
  migrations: readonly string[] = LOCAL_MIGRATIONS,
): Promise<number> {
  const [row] = await storage.query<{ user_version: number }>('PRAGMA user_version');
  const current = Number(row?.user_version ?? 0);
  if (current > migrations.length) {
    throw new Error('Este banco local é de uma versão mais nova do Bipaê. Atualize o aplicativo.');
  }
  for (let version = current; version < migrations.length; version++) {
    await storage.transaction(async () => {
      await storage.driver.exec(migrations[version]!);
      await storage.driver.run(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return migrations.length;
}

export async function getMeta(storage: Pick<LocalStorage, 'query'>, key: string) {
  const [row] = await storage.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    key,
  ]);
  return row?.value ?? null;
}

export async function setMeta(storage: Pick<LocalStorage, 'execute'>, key: string, value: string) {
  await storage.execute(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

/** Accent- and case-insensitive search key ("Café" → "cafe"). */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
