import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTotp } from '../src/common/totp';
import { asPlatform } from '../src/db/client';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const PASSWORD = 'senha-forte-123';

/** A Bipaê staff member with 2FA enabled, logged in to the panel. */
async function staff(role: 'owner' | 'support' | 'viewer' = 'owner') {
  const person = await signup(t.app, { plan: null });
  await asPlatform(t.database.db, (tx) =>
    tx.execute(sql`insert into platform_admins (user_id, role) values (${person.me.user.id}, ${role})`),
  );
  const login = await t.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email: person.me.user.email, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  const bearer = { authorization: `Bearer ${login.json().accessToken}` };

  // Before 2FA nothing but the 2FA setup works.
  const blocked = await t.app.inject({ method: 'GET', url: '/v1/admin/dashboard', headers: bearer });
  expect(blocked.statusCode).toBe(403);
  expect(blocked.json().code).toBe('mfa_required');

  const setup = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/totp/setup', headers: bearer });
  expect(setup.json().uri).toMatch(/^otpauth:\/\/totp\//);
  const secret = setup.json().secret as string;
  const wrong = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/totp/enable', headers: bearer, payload: { code: '000000' } });
  expect(wrong.statusCode).toBe(400);
  const enabled = await t.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/totp/enable',
    headers: bearer,
    payload: { code: currentTotp(secret) },
  });
  expect(enabled.statusCode).toBe(200);
  return {
    person,
    secret,
    admin: api(t.app, { authorization: `Bearer ${enabled.json().accessToken}` }),
    refreshToken: enabled.json().refreshToken as string,
  };
}

describe('Bipaê staff authentication', () => {
  it('requires the second factor on every later login', async () => {
    const { person, secret } = await staff();
    const noCode = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: person.me.user.email, password: PASSWORD } });
    expect(noCode.json().code).toBe('totp_required');
    const badCode = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: person.me.user.email, password: PASSWORD, totp: '123456' } });
    expect(badCode.statusCode).toBe(401);
    const ok = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: person.me.user.email, password: PASSWORD, totp: currentTotp(secret) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().me).toMatchObject({ role: 'owner', totpEnabled: true });
  });

  it('client tokens and non-staff accounts never get into the panel', async () => {
    const client = await signup(t.app);
    const withClientToken = await t.app.inject({ method: 'GET', url: '/v1/admin/dashboard', headers: client.auth });
    expect(withClientToken.statusCode).toBe(401);
    const notStaff = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/login', payload: { email: client.me.user.email, password: PASSWORD } });
    expect(notStaff.statusCode).toBe(401);
    // And a staff token is useless on client routes.
    const { admin } = await staff();
    void admin;
  });

  it('staff tokens are refused on client routes; refresh rotates', async () => {
    const { person, refreshToken } = await staff();
    const refreshed = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/refresh', payload: { refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    const reuse = await t.app.inject({ method: 'POST', url: '/v1/admin/auth/refresh', payload: { refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const onClientRoute = await t.app.inject({
      method: 'GET',
      url: '/v1/products',
      headers: { authorization: `Bearer ${refreshed.json().accessToken}` },
    });
    expect(onClientRoute.statusCode).toBe(401);
    void person;
  });
});

describe('managing clients', () => {
  it('dashboard, list with search, and full client record', async () => {
    const { admin } = await staff();
    const client = await signup(t.app, { businessName: 'Padaria Pão Quente', plan: null });
    const dashboard = (await admin.get('/admin/dashboard')).json();
    expect(dashboard.tenants.active).toBeGreaterThan(0);
    const found = (await admin.get('/admin/tenants?q=p%C3%A3o%20quente')).json();
    expect(found.items.map((x: { id: string }) => x.id)).toContain(client.me.tenant.id);
    expect(found.items[0]).toMatchObject({ planId: 'gratis', owner: client.me.user.email, users: 1 });
    const record = (await admin.get(`/admin/tenants/${client.me.tenant.id}`)).json();
    expect(record.usage).toMatchObject({ companies: 1, stores: 1, users: 1 });
    expect(record.limits.terminals).toBe(2);
    expect(record.members[0].email).toBe(client.me.user.email);
    expect(record.events[0].kind).toBe('created');
  });

  it('plan limits are enforced and a plan change lifts them immediately', async () => {
    const { admin } = await staff();
    const client = await signup(t.app, { plan: null });
    const own = api(t.app, client.auth);
    const store = (await own.get('/stores')).json()[0];
    for (const name of ['Caixa 1', 'Caixa 2']) {
      expect((await own.post('/terminals', { storeId: store.id, name, platform: 'web' })).statusCode).toBe(201);
    }
    const third = await own.post('/terminals', { storeId: store.id, name: 'Caixa 3', platform: 'web' });
    expect(third.statusCode).toBe(403);
    expect(third.json().message).toBe('O plano Grátis permite até 2 caixas. Para ampliar, fale com a gente ou mude de plano em Minha assinatura.');

    const change = await admin.post(`/admin/tenants/${client.me.tenant.id}/plan`, { planId: 'essencial', reason: 'Cliente contratou' });
    expect(change.statusCode).toBe(200);
    expect((await own.post('/terminals', { storeId: store.id, name: 'Caixa 3', platform: 'web' })).statusCode).toBe(201);

    // Special limit just for this client.
    await admin.post(`/admin/tenants/${client.me.tenant.id}/limits`, { overrides: { terminals: 3 }, reason: 'Negociado' });
    expect((await own.post('/terminals', { storeId: store.id, name: 'Caixa 4', platform: 'web' })).statusCode).toBe(403);

    const account = (await own.get('/account')).json();
    expect(account).toMatchObject({ plan: { id: 'essencial' }, limits: { terminals: 3 }, usage: { terminals: 3 } });
    expect(account.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['plan_changed', 'limits_changed']));
  });

  it('suspension blocks the client at once, but sales made offline still upload', async () => {
    const { admin } = await staff();
    const client = await signup(t.app);
    const own = api(t.app, client.auth);
    const store = (await own.get('/stores')).json()[0];
    const terminal = (await own.post('/terminals', { storeId: store.id, name: 'Caixa', platform: 'web' })).json();

    expect((await admin.post(`/admin/tenants/${client.me.tenant.id}/suspend`, { reason: 'Falta de pagamento' })).statusCode).toBe(200);
    const blocked = await own.get('/products');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'account_suspended' });
    expect((await own.get('/account')).json().tenant).toMatchObject({ status: 'suspended', statusReason: 'Falta de pagamento' });
    // Refresh tokens were revoked too.
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: client.refreshToken } })).statusCode).toBe(401);
    // Sync upload is still accepted (no sale is ever lost).
    const sync = await own.post('/sync/events', { terminalId: terminal.id, events: [{ id: 'x' }] });
    expect(sync.statusCode).toBe(200);

    expect((await admin.post(`/admin/tenants/${client.me.tenant.id}/reactivate`, { reason: 'Pagou' })).statusCode).toBe(200);
    expect((await own.get('/products')).statusCode).toBe(200);
  });

  it('an expired trial blocks access until a plan is set', async () => {
    const { admin } = await staff();
    const client = await signup(t.app, { plan: null });
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const trial = await admin.post(`/admin/tenants/${client.me.tenant.id}/plan`, { planId: 'profissional', trialEndsAt: future, reason: 'Teste de 7 dias' });
    expect(trial.json()).toMatchObject({ status: 'trial' });
    await asPlatform(t.database.db, (tx) =>
      tx.execute(sql`update tenants set trial_ends_at = now() - interval '1 day' where id = ${client.me.tenant.id}`),
    );
    const own = api(t.app, client.auth);
    expect((await own.get('/products')).json().code).toBe('account_trial_expired');
    await admin.post(`/admin/tenants/${client.me.tenant.id}/plan`, { planId: 'essencial', reason: 'Assinou' });
    expect((await own.get('/products')).statusCode).toBe(200);
  });

  it('support access is short, read-only by default and audited on both sides', async () => {
    const { admin, person } = await staff();
    const client = await signup(t.app);
    const start = await admin.post(`/admin/tenants/${client.me.tenant.id}/impersonate`, { reason: 'Cliente pediu ajuda com produtos' });
    expect(start.statusCode).toBe(200);
    const support = api(t.app, { authorization: `Bearer ${start.json().accessToken}` });
    expect(start.json()).toMatchObject({ readOnly: true, expiresIn: 1800 });

    expect((await support.get('/products')).statusCode).toBe(200);
    const write = await support.post('/products', { name: 'X', priceCents: 1 });
    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe('read_only');
    expect((await support.get('/auth/me')).json().support).toMatchObject({ readOnly: true });

    const clientAudit = (await api(t.app, client.auth).get('/audit')).json().items;
    expect(clientAudit[0]).toMatchObject({ action: 'support.session_started', data: { suporteBipae: person.me.user.id } });

    // Writable support session: actions are marked with the staff member.
    const rw = await admin.post(`/admin/tenants/${client.me.tenant.id}/impersonate`, { reason: 'Corrigir cadastro', readOnly: false });
    const supportRw = api(t.app, { authorization: `Bearer ${rw.json().accessToken}` });
    expect((await supportRw.post('/products', { name: 'Corrigido pelo suporte', priceCents: 100 })).statusCode).toBe(201);
    const after = (await api(t.app, client.auth).get('/audit')).json().items;
    expect(after[0]).toMatchObject({ action: 'product.created', data: { suporteBipae: person.me.user.id } });

    const platformAudit = (await admin.get(`/admin/audit?tenantId=${client.me.tenant.id}`)).json().items;
    expect(platformAudit.filter((a: { action: string }) => a.action === 'tenant.support_session')).toHaveLength(2);
  });

  it('roles: viewer only reads, support cannot change plans nor write as the client', async () => {
    const viewer = await staff('viewer');
    const support = await staff('support');
    const client = await signup(t.app);
    expect((await viewer.admin.get('/admin/tenants')).statusCode).toBe(200);
    expect((await viewer.admin.post(`/admin/tenants/${client.me.tenant.id}/impersonate`, { reason: 'Olhar' })).statusCode).toBe(403);
    expect((await support.admin.post(`/admin/tenants/${client.me.tenant.id}/plan`, { planId: 'rede', reason: 'x'.repeat(5) })).statusCode).toBe(403);
    expect((await support.admin.post(`/admin/tenants/${client.me.tenant.id}/impersonate`, { reason: 'Ajuda', readOnly: false })).statusCode).toBe(403);
    expect((await support.admin.post(`/admin/tenants/${client.me.tenant.id}/notes`, { note: 'Cliente ligou' })).statusCode).toBe(201);
  });

  it('creates a client on behalf of sales, with a trial', async () => {
    const { admin } = await staff();
    const email = `novo-${Date.now()}@exemplo.com.br`;
    const created = await admin.post('/admin/tenants', {
      businessName: 'Loja Nova',
      ownerName: 'Maria',
      ownerEmail: email,
      password: PASSWORD,
      planId: 'profissional',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });
    expect(created.statusCode).toBe(201);
    const record = (await admin.get(`/admin/tenants/${created.json().id}`)).json();
    expect(record.tenant).toMatchObject({ status: 'trial', planId: 'profissional' });
    const login = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
  });
});

describe('platform settings', () => {
  it('plans, announcements targeted by plan, team and audit chain', async () => {
    const { admin, person } = await staff();
    const plan = await admin.post('/admin/plans', {
      id: 'mercado-plus',
      name: 'Mercado Plus',
      priceCents: 19900,
      limits: { companies: 2, stores: 4, terminals: 8, users: 15, products: null },
      features: ['pos', 'offline'],
    });
    expect(plan.statusCode).toBe(201);
    const plansRes = await admin.get('/admin/plans');
    expect(plansRes.json().map((p: { id: string }) => p.id)).toContain('mercado-plus');

    const everyone = await signup(t.app, { plan: null });
    await admin.post('/admin/announcements', { title: 'Manutenção', body: 'Domingo às 3h', level: 'warning' });
    await admin.post('/admin/announcements', { title: 'Só Rede', body: 'Novidade', planIds: ['rede'] });
    const seenRes = await api(t.app, everyone.auth).get('/announcements');
    const seen = seenRes.json() as { title: string }[];
    expect(seen.map((a) => a.title)).toContain('Manutenção');
    expect(seen.map((a) => a.title)).not.toContain('Só Rede');

    const newcomer = await signup(t.app, { plan: null });
    expect((await admin.post('/admin/admins', { email: newcomer.me.user.email, role: 'support' })).statusCode).toBe(201);
    expect((await admin.patch(`/admin/admins/${person.me.user.id}`, { active: false })).statusCode).toBe(400);
    const people = (await admin.get(`/admin/users?q=${encodeURIComponent(newcomer.me.user.email)}`)).json();
    expect(people[0]).toMatchObject({ staffRole: 'support', clients: [expect.objectContaining({ tenantId: newcomer.me.tenant.id })] });

    expect((await admin.get('/admin/audit/verify')).json().valid).toBe(true);
    await expect(t.database.db.execute(sql`delete from platform_audit_log`)).rejects.toThrow();
    const system = (await admin.get('/admin/system')).json();
    expect(system.migrations.map((m: { name: string }) => m.name)).toContain('0003_platform_saas');
  });
});
