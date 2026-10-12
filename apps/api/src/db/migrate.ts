import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Ordered SQL migrations from ./migrations (copied next to the bundle by build.mjs).
 * Add new files with a higher prefix; never edit one that was already applied.
 */
export function loadMigrations(
  dir: URL = new URL('./migrations/', import.meta.url),
): { name: string; sql: string }[] {
  const path = fileURLToPath(dir);
  return readdirSync(path)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ''), sql: readFileSync(`${path}/${f}`, 'utf8') }));
}

export async function migrate(
  database: Database,
  migrations = loadMigrations(),
): Promise<string[]> {
  const { db } = database;
  await db.execute(
    sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const result = await db.execute(sql`select name from schema_migrations`);
  const applied = new Set(rowsOf<{ name: string }>(result).map((r) => r.name));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    const name = migration.name.replace(/[^a-z0-9_]/gi, '');
    // One script so the migration and its bookkeeping commit atomically.
    await database.execScript(
      `begin;
${migration.sql}
;insert into schema_migrations (name) values ('${name}');
commit;`,
    );
    ran.push(migration.name);
  }
  return ran;
}

/** Both drivers return `{ rows }` from execute(), typed differently. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
