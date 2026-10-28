import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/common/di';
import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('prontidão da API (PIE ACH-25)', () => {
  it('confere o banco e a fila, sem precisar de login', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      checks: { database: true, queue: true },
    });
  });

  it('sem banco responde 503, para o deploy e o balanceador não mandarem gente para cá', async () => {
    const db = t.app.get(DB) as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = db.execute;
    db.execute = () => Promise.reject(new Error('conexão recusada'));
    try {
      const res = await t.app.inject({ method: 'GET', url: '/v1/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'unavailable', checks: { database: false } });
      // O /health simples continua dizendo só que o processo está de pé.
      expect((await t.app.inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200);
    } finally {
      db.execute = original;
    }
  });
});
