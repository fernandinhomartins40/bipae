import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  db: Db;
  kind: 'pglite' | 'postgres';
  /** Runs a multi-statement SQL script (simple query protocol). Used for migrations. */
  execScript(script: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the database from a URL:
 * - `pglite://memory` — in-memory PostgreSQL (tests)
 * - `pglite://<dir>`  — PostgreSQL in WASM persisted to a folder (local dev without Docker)
 * - `postgres://...`  — real PostgreSQL (docker compose, CI, production)
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    if (target !== 'memory') mkdirSync(target, { recursive: true });
    const client = new PGlite(target === 'memory' ? undefined : target);
    await client.waitReady;
    return {
      db: drizzlePglite(client, { schema }) as unknown as Db,
      kind: 'pglite',
      execScript: async (script) => {
        await client.exec(script);
      },
      close: () => client.close(),
    };
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // bigint columns come back as numbers; amounts are validated as safe integers on input.
  pg.types.setTypeParser(20, (v) => Number(v));
  return {
    db: drizzlePg(pool, { schema }) as unknown as Db,
    kind: 'postgres',
    execScript: async (script) => {
      await pool.query(script);
    },
    close: () => pool.end(),
  };
}

export interface TenantScope {
  tenantId: string;
  userId?: string | null;
}

/**
 * Runs `fn` in a transaction scoped to one tenant: sets app.tenant_id / app.user_id and drops
 * to role bipae_app so Row-Level Security always applies (ADR-0003). Forgetting the scope
 * returns zero rows instead of leaking data.
 */
export async function withTenant<T>(db: Db, scope: TenantScope, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${scope.tenantId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    await tx.execute(sql`set local role bipae_app`);
    return fn(tx);
  });
}

/**
 * Platform (super admin) scope: role bipae_platform, which bypasses RLS to see every tenant.
 * Only the admin module may call this, after PlatformGuard authenticated a Bipaê staff member.
 */
export async function asPlatform<T>(db: Db, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role bipae_platform`);
    return fn(tx);
  });
}

/** Same as withTenant but without a tenant (only the SECURITY DEFINER auth functions work). */
export async function asApp<T>(db: Db, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role bipae_app`);
    return fn(tx);
  });
}
