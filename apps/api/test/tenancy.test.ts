import { uuidv7 } from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** Platform (super admin) tables: no RLS, and the client role has no privileges on them. */
const PLATFORM_TABLES = [
  'plans',
  'platform_admins',
  'admin_sessions',
  'platform_audit_log',
  'announcements',
  // Avisos do MercadoFlow: chegam sem cliente; só a plataforma lê (ADR-0015).
  'mercadoflow_webhook_deliveries',
  // Cache do catálogo: dado público de produto, sem informação de cliente (ADR-0015).
  'mercadoflow_catalog_cache',
];

/** Tabelas da plataforma que o cliente pode ler: o catálogo de planos e o cache do catálogo. */
const SHARED_TABLES = ['plans', 'mercadoflow_catalog_cache'];

/** Every table protected by tenant RLS (must match the list in 0001_init.sql). */
const TENANT_TABLES = [
  'roles',
  'sessions',
  'companies',
  'stores',
  'terminals',
  'units',
  'fiscal_profiles',
  'products',
  'product_barcodes',
  'product_components',
  'price_tables',
  'price_table_items',
  'customers',
  'suppliers',
  'audit_log',
  'memberships',
  'sync_events',
  'cash_sessions',
  'cash_movements',
  'sales',
  'sale_items',
  'sale_payments',
  'stock_movements',
  'invites',
  'tenant_events',
];

describe('row-level security (ADR-0003)', () => {
  it('every business table has RLS enabled', async () => {
    const result = await t.database.db.execute(
      sql`select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    );
    const rows = rowsOf<{ relname: string; relrowsecurity: boolean }>(result);
    const unprotected = rows
      .filter(
        (r) =>
          !r.relrowsecurity &&
          r.relname !== 'schema_migrations' &&
          !PLATFORM_TABLES.includes(r.relname),
      )
      .map((r) => r.relname);
    expect(unprotected).toEqual([]);
    for (const table of TENANT_TABLES) {
      expect(rows.find((r) => r.relname === table)?.relrowsecurity).toBe(true);
    }
  });

  it('client code has no access at all to platform tables (no RLS needed there)', async () => {
    const owner = await signup(t.app);
    for (const table of PLATFORM_TABLES.filter((t) => !SHARED_TABLES.includes(t))) {
      await expect(
        withTenant(t.database.db, { tenantId: owner.me.tenant.id }, (tx) =>
          tx.execute(sql.raw(`select 1 from ${table} limit 1`)),
        ),
        table,
      ).rejects.toThrow();
    }
    // The plan catalog is readable (pricing page), but not writable.
    await expect(
      withTenant(t.database.db, { tenantId: owner.me.tenant.id }, (tx) =>
        tx.execute(sql`update plans set price_cents = 0`),
      ),
    ).rejects.toThrow();
    // A client can never change its own status or plan.
    await expect(
      withTenant(t.database.db, { tenantId: owner.me.tenant.id }, (tx) =>
        tx.execute(sql`update tenants set plan_id = 'rede', status = 'active'`),
      ),
    ).rejects.toThrow();
  });

  it('a tenant sees zero rows of another tenant in every table, and cannot write into it', async () => {
    const a = await signup(t.app);
    const b = await signup(t.app);
    const clientA = api(t.app, a.auth);
    // Give tenant A data in most tables.
    const product = await clientA.post('/products', {
      name: 'Café 500g',
      priceCents: 1890,
      barcodes: ['7891000315507'],
    });
    expect(product.statusCode).toBe(201);
    await clientA.post('/customers', { name: 'Cliente de A' });
    await clientA.post('/suppliers', { name: 'Fornecedor de A' });
    await clientA.post('/price-tables', {
      name: 'Atacado',
      items: [{ productId: product.json().id, priceCents: 1700 }],
    });
    const store = (await clientA.get('/stores')).json()[0];
    await clientA.post('/terminals', { storeId: store.id, name: 'Caixa 1', platform: 'web' });

    for (const table of TENANT_TABLES) {
      const seenByB = await withTenant(t.database.db, { tenantId: b.me.tenant.id }, async (tx) =>
        rowsOf<{ tenant_id: string }>(await tx.execute(sql.raw(`select tenant_id from ${table}`))),
      );
      expect(
        seenByB.every((r) => r.tenant_id === b.me.tenant.id),
        `${table} vazou dados de outro tenant`,
      ).toBe(true);

      const seenWithoutScope = await withTenant(
        t.database.db,
        { tenantId: '00000000-0000-0000-0000-000000000000' },
        async (tx) => rowsOf(await tx.execute(sql.raw(`select 1 from ${table}`))),
      );
      expect(seenWithoutScope, `${table} visível sem tenant`).toHaveLength(0);
    }

    // Writing a row tagged with another tenant's id is rejected by the policy.
    await expect(
      withTenant(t.database.db, { tenantId: b.me.tenant.id }, (tx) =>
        tx.execute(
          sql`insert into customers (id, tenant_id, name) values (${uuidv7()}, ${a.me.tenant.id}, 'invasor')`,
        ),
      ),
    ).rejects.toThrow();

    // And through the API, B gets 404 for A's product.
    const clientB = api(t.app, b.auth);
    expect((await clientB.get(`/products/${product.json().id}`)).statusCode).toBe(404);
    expect((await clientB.get('/products')).json().total).toBe(0);
  });

  it('users of another tenant are invisible', async () => {
    const a = await signup(t.app);
    const b = await signup(t.app);
    const users = await withTenant(
      t.database.db,
      { tenantId: b.me.tenant.id, userId: b.me.user.id },
      async (tx) => rowsOf<{ id: string }>(await tx.execute(sql`select id from users`)),
    );
    expect(users.map((u) => u.id)).toEqual([b.me.user.id]);
    expect(users.map((u) => u.id)).not.toContain(a.me.user.id);
  });
});

describe('permissions', () => {
  it('a cashier can read the catalog but not change it, nor see the audit trail', async () => {
    const owner = await signup(t.app);
    const client = api(t.app, owner.auth);
    const roles = (await client.get('/roles')).json() as { id: string; systemKey: string }[];
    const email = `caixa-${Date.now()}@exemplo.com.br`;
    await client.post('/members', {
      name: 'Juliana',
      email,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const cashier = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });

    expect((await cashier.get('/products')).statusCode).toBe(200);
    const denied = await cashier.post('/products', { name: 'X', priceCents: 100 });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toContain('Você não tem permissão');
    expect((await cashier.get('/audit')).statusCode).toBe(403);
    expect((await cashier.get('/members')).statusCode).toBe(403);

    // Deactivating the member cuts access on the next request (permissions are not cached).
    const userId = login.json().me.user.id;
    expect((await client.patch(`/members/${userId}`, { active: false })).statusCode).toBe(200);
    expect((await cashier.get('/products')).statusCode).toBe(401);
  });

  it('changing a price needs its own permission and is audited', async () => {
    const owner = await signup(t.app);
    const client = api(t.app, owner.auth);
    const product = (await client.post('/products', { name: 'Leite 1L', priceCents: 549 })).json();

    const role = (
      await client.post('/roles', {
        name: 'Repositor',
        permissions: ['catalog.read', 'catalog.write'],
      })
    ).json();
    const email = `repositor-${Date.now()}@exemplo.com.br`;
    await client.post('/members', {
      name: 'Repositor',
      email,
      password: 'senha-forte-123',
      roleId: role.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const stocker = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });

    const body = { ...product, priceCents: 499 };
    expect((await stocker.put(`/products/${product.id}`, body)).statusCode).toBe(403);
    expect(
      (await stocker.put(`/products/${product.id}`, { ...product, name: 'Leite integral 1L' }))
        .statusCode,
    ).toBe(200);

    const changed = await client.put(`/products/${product.id}`, body);
    expect(changed.statusCode).toBe(200);
    const audit = (await client.get('/audit')).json().items as { action: string; data: unknown }[];
    expect(audit[0]).toMatchObject({
      action: 'product.price_changed',
      data: { before: 549, after: 499 },
    });
  });

  it('the owner role cannot be edited', async () => {
    const owner = await signup(t.app);
    const client = api(t.app, owner.auth);
    const roles = (await client.get('/roles')).json() as { id: string; systemKey: string }[];
    const res = await client.patch(`/roles/${roles.find((r) => r.systemKey === 'owner')!.id}`, {
      name: 'Dono',
      permissions: ['catalog.read'],
    });
    expect(res.statusCode).toBe(400);
  });
});
