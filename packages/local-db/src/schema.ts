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
];

export async function migrateLocal(storage: LocalStorage): Promise<number> {
  const [row] = await storage.query<{ user_version: number }>('PRAGMA user_version');
  const current = Number(row?.user_version ?? 0);
  for (let version = current; version < LOCAL_MIGRATIONS.length; version++) {
    await storage.transaction(async () => {
      await storage.driver.exec(LOCAL_MIGRATIONS[version]!);
      await storage.driver.run(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return LOCAL_MIGRATIONS.length;
}

export async function getMeta(storage: Pick<LocalStorage, 'query'>, key: string) {
  const [row] = await storage.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(
  storage: Pick<LocalStorage, 'execute'>,
  key: string,
  value: string,
) {
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
