import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../src/common/tokens';
import { currentTotp } from '../src/common/totp';
import { asPlatform } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F1-01: verificação em duas etapas opcional para os usuários dos clientes. */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const PASSWORD = 'senha-forte-123';
const login = (email: string, totp?: string) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password: PASSWORD, ...(totp && { totp }) },
  });

async function withTotp() {
  const owner = await signup(t.app);
  const client = api(t.app, owner.auth);
  const setup = await client.post('/auth/totp/setup');
  expect(setup.statusCode).toBe(200);
  const { secret, uri } = setup.json() as { secret: string; uri: string };
  expect(uri).toMatch(/^otpauth:\/\/totp\/Bipa/);
  expect((await client.post('/auth/totp/enable', { code: '000000' })).statusCode).toBe(422);
  const enabled = await client.post('/auth/totp/enable', { code: currentTotp(secret) });
  expect(enabled.statusCode).toBe(200);
  return { owner, client, secret };
}

describe('verificação em duas etapas dos clientes', () => {
  it('ativa com o código do app e passa a pedir o código no login', async () => {
    const { owner, client, secret } = await withTotp();
    expect((await client.get('/auth/totp')).json()).toEqual({ enabled: true });

    const without = await login(owner.me.user.email);
    expect(without.statusCode).toBe(401);
    expect(without.json().code).toBe('totp_required');
    expect(without.json().message).toContain('código de 6 dígitos');

    const wrong = await login(owner.me.user.email, '000000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('totp_invalid');

    expect((await login(owner.me.user.email, currentTotp(secret))).statusCode).toBe(200);

    // A senha errada continua dizendo só "e-mail ou senha" (não revela que há 2FA).
    const badPassword = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: owner.me.user.email, password: 'errada-123' },
    });
    expect(badPassword.json().code).toBe('invalid_login');

    const audit = (await client.get('/audit')).json() as { items: { action: string }[] };
    expect(audit.items.map((i) => i.action)).toContain('auth.totp_enabled');
  });

  it('desativar exige um código válido', async () => {
    const { owner, client, secret } = await withTotp();
    expect((await client.post('/auth/totp/disable', { code: '000000' })).statusCode).toBe(422);
    const off = await client.post('/auth/totp/disable', { code: currentTotp(secret) });
    expect(off.json()).toEqual({ enabled: false });
    expect((await login(owner.me.user.email)).statusCode).toBe(200);
  });

  it('a semente fica cifrada no banco e nunca aparece na API', async () => {
    const { owner, client, secret } = await withTotp();
    const [row] = await asPlatform(t.database.db, async (tx) =>
      rowsOf<{ totp_secret: string }>(
        await tx.execute(sql`select totp_secret from users where id = ${owner.me.user.id}`),
      ),
    );
    expect(row!.totp_secret.startsWith('v1.')).toBe(true);
    expect(row!.totp_secret).not.toContain(secret);
    for (const path of ['/auth/me', '/team', '/auth/totp']) {
      expect((await client.get(path)).body).not.toContain(secret);
    }
  });

  it('o suporte Bipaê, entrando como o cliente, não mexe na 2FA', async () => {
    const owner = await signup(t.app);
    const tokens = t.app.get(TokenService);
    const token = await tokens.signAccess({
      sub: owner.me.user.id,
      tid: owner.me.tenant.id,
      imp: owner.me.user.id,
    });
    const support = api(t.app, { authorization: `Bearer ${token}` });
    const res = await support.post('/auth/totp/setup');
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('suporte Bipaê');
  });

  it('quem perdeu o celular é liberado pelo painel super admin, que encerra as sessões', async () => {
    const { owner } = await withTotp();
    const staff = await signup(t.app, { plan: null });
    await asPlatform(t.database.db, (tx) =>
      tx.execute(
        sql`insert into platform_admins (user_id, role) values (${staff.me.user.id}, 'owner')`,
      ),
    );
    const adminToken = await t.app
      .get(TokenService)
      .signAdmin({ sub: staff.me.user.id, mfa: true });
    const admin = api(t.app, { authorization: `Bearer ${adminToken}` });

    const reset = await admin.post(`/admin/users/${owner.me.user.id}/reset-totp`);
    expect(reset.statusCode).toBe(200);
    expect((await login(owner.me.user.email)).statusCode).toBe(200);
    // The old session was revoked.
    const refresh = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: owner.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
    const trail = (await admin.get('/admin/audit')).json() as { items: { action: string }[] };
    expect(trail.items.map((i) => i.action)).toContain('user.totp_reset');
  });
});
