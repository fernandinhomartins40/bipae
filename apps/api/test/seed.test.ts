import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, seed } from '../src/seed';
import { api, type TestApp } from './helpers';

/** The seed runs through the real API, so it must succeed against a fresh database. */
describe('seed', () => {
  let t: TestApp;
  const dir = `pglite://${process.env.TMPDIR ?? process.env.TEMP ?? '/tmp'}/bipae-seed-${Date.now()}`;

  beforeAll(async () => {
    await seed(dir);
    await seed(dir); // idempotent
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a usable demo market', async () => {
    const { openDatabase } = await import('../src/db/client');
    const { createApp } = await import('../src/app');
    const { loadConfig } = await import('../src/config');
    const database = await openDatabase(dir);
    const app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: dir }), database);
    t = { app, database, close: async () => { await app.close(); await database.close(); } };

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: DEMO.ownerEmail, password: DEMO.password },
    });
    expect(login.statusCode).toBe(200);
    const client = api(app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await client.get('/products?limit=200')).json().total).toBe(30);
    expect((await client.get('/customers')).json().total).toBe(5);
    expect((await client.get('/terminals')).json()).toHaveLength(2);
    expect((await client.get('/audit/verify')).json().valid).toBe(true);
  });
});

