import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('health', () => {
  it('is public', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('signup', () => {
  it('creates a ready-to-sell business with no mandatory setup', async () => {
    const owner = await signup(t.app, { taxId: '11.222.333/0001-81' });
    expect(owner.me.permissions).toContain('admin.users');
    const client = api(t.app, owner.auth);

    const companies = (await client.get('/companies')).json();
    expect(companies).toHaveLength(1);
    expect(companies[0].taxId).toBe('11222333000181');
    expect((await client.get('/stores')).json()).toHaveLength(1);
    const units = (await client.get('/units')).json() as { code: string }[];
    expect(units.map((u) => u.code)).toEqual(expect.arrayContaining(['UN', 'KG', 'L']));
    expect((await client.get('/fiscal-profiles')).json()).toHaveLength(1);
    expect((await client.get('/roles')).json()).toHaveLength(4);

    const audit = (await client.get('/audit')).json();
    expect(audit.items[0]).toMatchObject({ action: 'tenant.created', seq: 1 });
  });

  it('rejects an e-mail already in use with a pt-BR message', async () => {
    const owner = await signup(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: {
        ownerName: 'Outro',
        email: owner.me.user.email.toUpperCase(),
        password: 'senha-forte-123',
        businessName: 'Outro negócio',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Já existe uma conta com este e-mail.');
  });

  it('validates input with field messages', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { ownerName: 'A', email: 'x', password: '1', businessName: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});

describe('login and sessions', () => {
  it('logs in, refreshes with rotation and detects reuse', async () => {
    const owner = await signup(t.app);
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: owner.me.user.email, password: 'errada-123' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().message).toBe('E-mail ou senha incorretos.');

    const unknown = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ninguem@exemplo.com.br', password: 'qualquer-123' },
    });
    expect(unknown.statusCode).toBe(401);

    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: owner.me.user.email, password: 'senha-forte-123' },
    });
    expect(login.statusCode).toBe(200);
    const first = login.json().refreshToken as string;

    const rotated = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json().refreshToken as string;
    expect(second).not.toBe(first);

    // Reusing the old token is treated as theft: the whole family is revoked.
    const reuse = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: second },
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const owner = await signup(t.app);
    const out = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: owner.refreshToken },
    });
    expect(out.statusCode).toBe(204);
    const refresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: owner.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('rejects missing and forged access tokens', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/products' })).statusCode).toBe(401);
    const forged = await t.app.inject({
      method: 'GET',
      url: '/v1/products',
      headers: { authorization: 'Bearer abc.def.ghi' },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().message).toBe('Sua sessão expirou. Entre novamente.');
  });

  it('an accountant can serve several businesses and switch between them', async () => {
    const a = await signup(t.app);
    const b = await signup(t.app);
    const email = `contador-${Date.now()}@exemplo.com.br`;
    for (const owner of [a, b]) {
      const client = api(t.app, owner.auth);
      const roles = (await client.get('/roles')).json() as { id: string; systemKey: string }[];
      const res = await client.post('/members', {
        name: 'Sérgio Contador',
        email,
        password: 'senha-forte-123',
        roleId: roles.find((r) => r.systemKey === 'accountant')!.id,
      });
      expect(res.statusCode).toBe(201);
    }
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123', tenantId: b.me.tenant.id },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().me.tenant.id).toBe(b.me.tenant.id);
    expect(login.json().me.tenants).toHaveLength(2);

    const switched = await api(t.app, {
      authorization: `Bearer ${login.json().accessToken}`,
    }).post('/auth/switch-tenant', { tenantId: a.me.tenant.id });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().me.tenant.id).toBe(a.me.tenant.id);

    const notMine = await signup(t.app);
    const denied = await api(t.app, {
      authorization: `Bearer ${login.json().accessToken}`,
    }).post('/auth/switch-tenant', { tenantId: notMine.me.tenant.id });
    expect(denied.statusCode).toBe(403);
  });
});

describe('client version policy', () => {
  it('asks old clients to update but always accepts sync uploads', async () => {
    const strict = await createTestApp({ MIN_CLIENT_VERSION_DESKTOP: '1.2.0' });
    try {
      const old = await strict.app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-bipae-client': 'desktop/1.0.0' },
      });
      expect(old.statusCode).toBe(426);
      expect(old.json().code).toBe('update_required');

      const sync = await strict.app.inject({
        method: 'POST',
        url: '/v1/sync/events',
        headers: { 'x-bipae-client': 'desktop/1.0.0' },
      });
      expect(sync.statusCode).not.toBe(426);

      const current = await strict.app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-bipae-client': 'desktop/1.2.0' },
      });
      expect(current.statusCode).toBe(200);
      expect(current.json().minimumClientVersions).toEqual({ desktop: '1.2.0' });
    } finally {
      await strict.close();
    }
  });
});
