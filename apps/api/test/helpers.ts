import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { DB } from '../src/common/di';
import { asPlatform, openDatabase, type Database, type Db } from '../src/db/client';
import { migrate } from '../src/db/migrate';

export interface TestApp {
  app: NestFastifyApplication;
  database: Database;
  close(): Promise<void>;
}

/**
 * Uses in-memory PGlite by default; set TEST_DATABASE_URL to run against real PostgreSQL
 * (CI does both). Each call gets a fresh schema.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const url = process.env.TEST_DATABASE_URL ?? 'pglite://memory';
  const database = await openDatabase(url);
  if (database.kind === 'postgres') {
    await database.db.execute(sql.raw('drop schema public cascade; create schema public;'));
  }
  await migrate(database);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    ...env,
  });
  const app = await createApp(config, database);
  return {
    app,
    database,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

let counter = 0;

/**
 * Signs up a client. Existing tests run on the unlimited "rede" plan so plan limits do not
 * interfere; pass `plan: 'gratis'` (or any plan) to test limits. `plan: null` keeps the default.
 */
export async function signup(
  app: NestFastifyApplication,
  { plan = 'rede', ...overrides }: Record<string, unknown> & { plan?: string | null } = {},
) {
  counter++;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: {
      ownerName: `Dono ${counter}`,
      email: `dono${counter}-${Date.now()}@exemplo.com.br`,
      password: 'senha-forte-123',
      businessName: `Mercadinho ${counter}`,
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.statusCode} ${res.body}`);
  const body = res.json() as {
    accessToken: string;
    refreshToken: string;
    me: { user: { id: string; email: string }; tenant: { id: string }; permissions: string[] };
  };
  if (plan) {
    await asPlatform(app.get<Db>(DB), (tx) =>
      tx.execute(sql`update tenants set plan_id = ${plan} where id = ${body.me.tenant.id}`),
    );
  }
  return { ...body, auth: { authorization: `Bearer ${body.accessToken}` } };
}

export function api(app: NestFastifyApplication, auth: Record<string, string>) {
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/v1${url}`,
      headers: auth,
      ...(payload !== undefined && { payload: payload as object }),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload: unknown = {}) => call('POST', url, payload),
    put: (url: string, payload: unknown) => call('PUT', url, payload),
    patch: (url: string, payload: unknown) => call('PATCH', url, payload),
    delete: (url: string) => call('DELETE', url),
  };
}
