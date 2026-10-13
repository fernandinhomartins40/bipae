import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;
let client: ReturnType<typeof api>;
let ownerCtx: Awaited<ReturnType<typeof signup>>;

beforeAll(async () => {
  t = await createTestApp();
  ownerCtx = await signup(t.app);
  client = api(t.app, ownerCtx.auth);
});
afterAll(async () => {
  await t.close();
});

describe('products', () => {
  it('creates, searches by name/barcode/SKU and updates', async () => {
    const created = await client.post('/products', {
      name: 'Arroz Tipo 1 5kg',
      sku: 'ARZ5',
      barcodes: ['7891000315507'],
      priceCents: 2890,
      costCents: 2100,
      ncm: '10063021',
    });
    expect(created.statusCode).toBe(201);
    const product = created.json();
    expect(product).toMatchObject({ unit: 'UN', active: true, barcodes: ['7891000315507'] });

    for (const q of ['arroz', '7891000315507', 'ARZ5']) {
      const found = (await client.get(`/products?q=${encodeURIComponent(q)}`)).json();
      expect(
        found.items.map((p: { id: string }) => p.id),
        q,
      ).toContain(product.id);
    }
    expect((await client.get('/products?q=inexistente')).json().total).toBe(0);

    const updated = await client.put(`/products/${product.id}`, {
      ...product,
      name: 'Arroz Agulhinha 5kg',
      barcodes: ['7891000315507', '96385074'],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().barcodes).toEqual(['7891000315507', '96385074']);
  });

  it('rejects duplicate barcode with a clear message', async () => {
    await client.post('/products', { name: 'Feijão 1kg', priceCents: 899, barcodes: ['78912342'] });
    const dup = await client.post('/products', {
      name: 'Outro',
      priceCents: 100,
      barcodes: ['78912342'],
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toBe('Este código de barras já está em outro produto.');
  });

  it('rejects an invalid GTIN check digit', async () => {
    const res = await client.post('/products', {
      name: 'X',
      priceCents: 100,
      barcodes: ['7891000315508'],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Dígito verificador do código de barras inválido');
  });

  it('supports weighable items, variants and kits', async () => {
    const banana = (
      await client.post('/products', {
        name: 'Banana prata',
        unit: 'KG',
        priceCents: 699,
        isWeighable: true,
      })
    ).json();
    expect(banana.isWeighable).toBe(true);

    const parent = (await client.post('/products', { name: 'Camiseta', priceCents: 4990 })).json();
    const variant = (
      await client.post('/products', {
        name: 'Camiseta Azul M',
        priceCents: 4990,
        parentId: parent.id,
        attributes: { cor: 'Azul', tamanho: 'M' },
      })
    ).json();
    expect(variant).toMatchObject({ parentId: parent.id, attributes: { cor: 'Azul' } });

    const kit = (
      await client.post('/products', {
        name: 'Kit café da manhã',
        priceCents: 2500,
        components: [
          { productId: banana.id, quantity: 0.5 },
          { productId: variant.id, quantity: 1 },
        ],
      })
    ).json();
    expect(kit.components).toEqual(
      expect.arrayContaining([{ productId: banana.id, quantity: 0.5 }]),
    );
    const self = await client.put(`/products/${kit.id}`, {
      ...kit,
      components: [{ productId: kit.id, quantity: 1 }],
    });
    expect(self.statusCode).toBe(400);
  });

  it('requires a known unit', async () => {
    const res = await client.post('/products', { name: 'X', priceCents: 1, unit: 'ZZ' });
    expect(res.statusCode).toBe(409);
    expect((await client.post('/units', { code: 'ZZ', description: 'Teste' })).statusCode).toBe(
      201,
    );
    expect(
      (await client.post('/products', { name: 'X', priceCents: 1, unit: 'ZZ' })).statusCode,
    ).toBe(201);
  });
});

describe('fiscal profiles and price tables', () => {
  it('stores fiscal profile data (no calculation yet)', async () => {
    const res = await client.post('/fiscal-profiles', {
      name: 'Bebidas ST',
      cfopInterna: '5405',
      csosn: '500',
      cClassTrib: '000001',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ cfopInterna: '5405', csosn: '500' });
    const bad = await client.post('/fiscal-profiles', { name: 'X', cfopInterna: '54' });
    expect(bad.statusCode).toBe(400);
  });

  it('saves and replaces price table items', async () => {
    const p = (await client.post('/products', { name: 'Óleo 900ml', priceCents: 799 })).json();
    const table = (
      await client.post('/price-tables', {
        name: 'Atacarejo',
        items: [{ productId: p.id, priceCents: 699 }],
      })
    ).json();
    await client.put(`/price-tables/${table.id}`, {
      name: 'Atacarejo',
      items: [{ productId: p.id, priceCents: 649 }],
    });
    const tables = (await client.get('/price-tables')).json();
    // Items carry the product name and regular price, so screens need not load the catalog.
    expect(tables.find((x: { id: string }) => x.id === table.id).items).toEqual([
      { productId: p.id, priceCents: 649, name: 'Óleo 900ml', basePriceCents: 799 },
    ]);
  });
});

describe('customers and suppliers', () => {
  it('validates CPF/CNPJ and records marketing consent separately (LGPD)', async () => {
    const bad = await client.post('/customers', { name: 'Ana', taxId: '111.111.111-11' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toBe('CPF ou CNPJ inválido');

    const customer = (
      await client.post('/customers', {
        name: 'Ana Souza',
        taxId: '123.456.789-09',
        phone: '(11) 98765-4321',
      })
    ).json();
    expect(customer).toMatchObject({ taxId: '12345678909', marketingConsent: false });

    await client.put(`/customers/${customer.id}`, { ...customer, marketingConsent: true });
    const audit = (await client.get('/audit')).json().items as { action: string }[];
    expect(audit[0]?.action).toBe('customer.marketing_consent_changed');

    const byCpf = (await client.get('/customers?q=123.456.789-09')).json();
    expect(byCpf.items[0].id).toBe(customer.id);

    const dup = await client.post('/customers', { name: 'Outra', taxId: '12345678909' });
    expect(dup.statusCode).toBe(409);
  });

  it('manages suppliers with alphanumeric CNPJ', async () => {
    const res = await client.post('/suppliers', {
      name: 'Distribuidora Nova',
      taxId: '12.ABC.345/01DE-35',
      address: {
        cep: '01001-000',
        street: 'Praça da Sé',
        number: '1',
        district: 'Sé',
        city: 'São Paulo',
        uf: 'SP',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().taxId).toBe('12ABC34501DE35');
    expect(res.json().marketingConsent).toBeUndefined();
  });
});

describe('terminals and NFC-e series (ADR-0012)', () => {
  it('allocates an exclusive series per terminal and never reuses it', async () => {
    const store = (await client.get('/stores')).json()[0];
    const web = (
      await client.post('/terminals', { storeId: store.id, name: 'Tablet', platform: 'web' })
    ).json();
    const desk = (
      await client.post('/terminals', { storeId: store.id, name: 'Balcão', platform: 'desktop' })
    ).json();
    expect([web.nfceSeries, desk.nfceSeries]).toEqual([1, 2]);

    expect((await client.post(`/terminals/${web.id}/revoke`)).json().status).toBe('revoked');
    const next = (
      await client.post('/terminals', { storeId: store.id, name: 'Caixa 3', platform: 'web' })
    ).json();
    expect(next.nfceSeries).toBe(3);
  });

  it('terminals cannot be deleted at the database level', async () => {
    const store = (await client.get('/stores')).json()[0];
    const terminal = (
      await client.post('/terminals', { storeId: store.id, name: 'X', platform: 'web' })
    ).json();
    const { withTenant } = await import('../src/db/client');
    await expect(
      withTenant(t.database.db, { tenantId: ownerCtx.me.tenant.id }, (tx) =>
        tx.execute(sql`delete from terminals where id = ${terminal.id}`),
      ),
    ).rejects.toThrow();
  });
});

describe('audit trail (ADR-0010)', () => {
  it('is a valid hash chain and is immutable', async () => {
    const verify = (await client.get('/audit/verify')).json();
    expect(verify.valid).toBe(true);
    expect(verify.entries).toBeGreaterThan(5);

    // Not even the database owner can rewrite history.
    await expect(
      t.database.db.execute(sql`update audit_log set action = 'adulterado'`),
    ).rejects.toThrow();
    await expect(t.database.db.execute(sql`delete from audit_log`)).rejects.toThrow();
  });

  it('detects tampering if the trigger is bypassed', async () => {
    await t.database.db.execute(sql`alter table audit_log disable trigger audit_log_no_update`);
    await t.database.db.execute(
      sql`update audit_log set data = '{"before":1,"after":2}' where seq = 2 and tenant_id = ${ownerCtx.me.tenant.id}`,
    );
    await t.database.db.execute(sql`alter table audit_log enable trigger audit_log_no_update`);
    const verify = (await client.get('/audit/verify')).json();
    expect(verify).toMatchObject({ valid: false, brokenAt: 2 });
  });
});
