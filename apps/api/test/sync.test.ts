import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** HTTP transport over the in-process API, with a switch to simulate losing the internet. */
function transport(auth: Record<string, string>, terminalId: string) {
  const state = { online: true };
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  const impl: SyncTransport = {
    async push(id, events: TerminalEvent[]) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.get(`/sync/pull?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      return res.json() as SyncPullResult;
    },
  };
  return { impl, state };
}

async function terminalDevice(
  owner: Awaited<ReturnType<typeof signup>>,
  name: string,
  platform: 'web' | 'desktop',
) {
  const admin = api(t.app, owner.auth);
  const store = (await admin.get('/stores')).json()[0];
  const terminal = (await admin.post('/terminals', { storeId: store.id, name, platform })).json();
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  const pdv = new PdvService(storage, { terminalId: terminal.id, operatorId: owner.me.user.id });
  const { impl, state } = transport(owner.auth, terminal.id);
  return { terminal, store, pdv, net: state, sync: new SyncClient(storage, pdv, impl, terminal.id) };
}

describe('offline sync with two terminals (Adendo 01 §8)', () => {
  it('web and desktop sell the same product offline at the same time and reconcile exactly', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    // Enough products to need several pull pages (limit=2 in the transport).
    const water = (await admin.post('/products', { name: 'Água 1,5L', priceCents: 299, barcodes: ['78912342'] })).json();
    for (const name of ['Pão', 'Leite', 'Café']) await admin.post('/products', { name, priceCents: 500 });
    await admin.post('/stock/adjustments', {
      productId: water.id,
      storeId: (await admin.get('/stores')).json()[0].id,
      mode: 'count',
      quantityMilli: 100_000,
    });

    const web = await terminalDevice(owner, 'Tablet', 'web');
    const desktop = await terminalDevice(owner, 'Balcão', 'desktop');
    expect(web.terminal.nfceSeries).not.toBe(desktop.terminal.nfceSeries);

    // Both download the catalog, then the internet goes down.
    for (const d of [web, desktop]) {
      expect((await d.sync.sync()).lastError).toBeNull();
      expect(await d.pdv.catalogSize()).toBe(4);
      d.net.online = false;
    }

    // Selling offline, interleaved, on both registers.
    const product = (await web.pdv.findByCode('78912342'))!;
    for (const d of [web, desktop]) await d.pdv.openSession(5000);
    for (let i = 0; i < 3; i++) {
      for (const d of [web, desktop]) {
        await d.pdv.completeSale(addItem(EMPTY_CART, product, 2000), [{ method: 'cash', receivedCents: 1000 }], {
          discountLimitPercent: 10,
        });
      }
    }
    const lastWebSale = (await web.pdv.listSales())[0]!;
    await web.pdv.returnItems(lastWebSale.id, [{ line: 1, quantityMilli: 1000 }], 'cash', 'Embalagem furada');
    const firstDesktopSale = (await desktop.pdv.findSaleBySeq(1))!;
    await desktop.pdv.cancelSale(firstDesktopSale.id, 'Cliente desistiu', owner.me.user.id);
    expect((await web.sync.sync()).pending).toBe(5);

    // Internet is back.
    for (const d of [web, desktop]) {
      d.net.online = true;
      expect(await d.sync.sync()).toMatchObject({ pending: 0, rejected: 0, lastError: null });
    }

    // Stock: 100 − 6 sales × 2 + 1 returned + 2 from the cancelled sale = 91, with no conflict.
    const stock = (await admin.get(`/stock?productId=${water.id}`)).json();
    expect(stock[0].quantityMilli).toBe(91_000);

    // Sales: same sequence numbers on both terminals, never colliding (distinct series).
    const sales = (await admin.get('/sales?limit=50')).json();
    expect(sales.total).toBe(7);
    const byTerminal = (name: string) =>
      sales.items.filter((s: { terminalName: string }) => s.terminalName === name).map((s: { terminalSeq: number }) => s.terminalSeq).sort();
    expect(byTerminal('Tablet')).toEqual([1, 2, 3, 4]);
    expect(byTerminal('Balcão')).toEqual([1, 2, 3]);
    expect(sales.items.find((s: { status: string }) => s.status === 'cancelled')).toBeTruthy();

    // Sensitive actions reached the audit trail with their author.
    const audit = (await admin.get('/audit?limit=100')).json().items.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['sale.cancelled', 'sale.returned']));
    expect((await admin.get('/audit/verify')).json().valid).toBe(true);
  });

  it('re-sending the same events is harmless (idempotent)', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Bala', priceCents: 10 })).json();
    const d = await terminalDevice(owner, 'Caixa', 'web');
    await d.sync.sync();
    await d.pdv.openSession(0);
    await d.pdv.completeSale(addItem(EMPTY_CART, (await d.pdv.search('bala'))[0]!), [{ method: 'pix', receivedCents: 10 }], {
      discountLimitPercent: 10,
    });
    const events = await d.pdv.pendingEvents();
    const client = api(t.app, owner.auth);
    for (let i = 0; i < 3; i++) {
      const res = await client.post('/sync/events', { terminalId: d.terminal.id, events });
      expect(res.json()).toEqual({ accepted: events.map((e) => e.id), rejected: [] });
    }
    expect((await admin.get('/sales')).json().total).toBe(1);
    const stock = (await admin.get(`/stock?productId=${product.id}`)).json();
    expect(stock[0].quantityMilli).toBe(-1000);
    expect((await client.get(`/sync/status/${d.terminal.id}`)).json()).toEqual({ lastDeviceSeq: 2, events: 2 });
  });

  it('rejects what can never be applied, with a reason, and keeps going', async () => {
    const owner = await signup(t.app);
    const other = await signup(t.app);
    const foreign = (await api(t.app, other.auth).post('/products', { name: 'De outra empresa', priceCents: 100 })).json();
    const d = await terminalDevice(owner, 'Caixa', 'web');
    await d.pdv.openSession(0);
    // A tampered terminal tries to sell another tenant's product.
    await d.pdv.completeSale(
      addItem(EMPTY_CART, { id: foreign.id, name: 'X', unit: 'UN', priceCents: 100, isWeighable: false }),
      [{ method: 'cash', receivedCents: 100 }],
      { discountLimitPercent: 10 },
    );
    await d.pdv.addMovement('supply', 500, 'Troco');
    const status = await d.sync.sync();
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
    expect((await d.pdv.rejectedEvents())[0]?.reason).toBe('A venda tem um produto desconhecido nesta empresa.');
    // The other tenant's stock was not touched.
    expect((await api(t.app, other.auth).get(`/stock?productId=${foreign.id}`)).json()).toEqual([]);
  });

  it('refuses events for a terminal of another business and malformed events', async () => {
    const owner = await signup(t.app);
    const other = await signup(t.app);
    const d = await terminalDevice(other, 'Alheio', 'web');
    await d.pdv.openSession(0);
    const events = await d.pdv.pendingEvents();
    const res = await api(t.app, owner.auth).post('/sync/events', { terminalId: d.terminal.id, events });
    expect(res.statusCode).toBe(404);

    const own = await terminalDevice(owner, 'Meu', 'web');
    const bad = await api(t.app, owner.auth).post('/sync/events', {
      terminalId: own.terminal.id,
      events: [{ id: '0192a000-0000-7000-8000-000000000000', type: 'sale.completed' }],
    });
    expect(bad.json().rejected[0].reason).toMatch(/^Evento inválido/);

    const mismatch = await api(t.app, { ...owner.auth, 'x-bipae-terminal': d.terminal.id }).post('/sync/events', {
      terminalId: own.terminal.id,
      events,
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it('accepts pending sales from an outdated desktop even when an update is required', async () => {
    const strict = await createTestApp({ MIN_CLIENT_VERSION_DESKTOP: '9.0.0' });
    try {
      const owner = await signup(strict.app);
      const store = (await api(strict.app, owner.auth).get('/stores')).json()[0];
      const terminal = (await api(strict.app, owner.auth).post('/terminals', { storeId: store.id, name: 'Velho', platform: 'desktop' })).json();
      const storage = createStorage(nodeSqliteDriver());
      await migrateLocal(storage);
      const pdv = new PdvService(storage, { terminalId: terminal.id, operatorId: owner.me.user.id });
      await pdv.openSession(1000);
      const oldClient = { ...owner.auth, 'x-bipae-client': 'desktop/1.0.0' };
      const blocked = await strict.app.inject({ method: 'GET', url: '/v1/products', headers: oldClient });
      expect(blocked.statusCode).toBe(426);
      const pushed = await strict.app.inject({
        method: 'POST',
        url: '/v1/sync/events',
        headers: oldClient,
        payload: { terminalId: terminal.id, events: await pdv.pendingEvents() },
      });
      expect(pushed.statusCode).toBe(200);
      expect(pushed.json().accepted).toHaveLength(1);
    } finally {
      await strict.close();
    }
  });
});

describe('supervisor authorization', () => {
  it('approves only people with the permission in this business', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string }[];
    const cashierEmail = `caixa-auth-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Operadora',
      email: cashierEmail,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });
    const ok = await admin.post('/auth/authorize', {
      email: owner.me.user.email,
      password: 'senha-forte-123',
      permission: 'pos.sale.cancel',
    });
    expect(ok.json()).toEqual({ userId: owner.me.user.id, name: expect.any(String) });
    const cashier = await admin.post('/auth/authorize', {
      email: cashierEmail,
      password: 'senha-forte-123',
      permission: 'pos.sale.cancel',
    });
    expect(cashier.statusCode).toBe(403);
    const wrong = await admin.post('/auth/authorize', {
      email: owner.me.user.email,
      password: 'errada',
      permission: 'pos.sale.cancel',
    });
    expect(wrong.statusCode).toBe(401);
    const otherBusiness = await signup(t.app);
    const outsider = await admin.post('/auth/authorize', {
      email: otherBusiness.me.user.email,
      password: 'senha-forte-123',
      permission: 'pos.sale.cancel',
    });
    expect(outsider.statusCode).toBe(403);
  });
});

describe('stock adjustments', () => {
  it('counts and adjusts with audit', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const p = (await admin.post('/products', { name: 'Arroz', priceCents: 2890 })).json();
    const store = (await admin.get('/stores')).json()[0];
    const counted = await admin.post('/stock/adjustments', { productId: p.id, storeId: store.id, mode: 'count', quantityMilli: 12_000, note: 'Inventário' });
    expect(counted.json().quantityMilli).toBe(12_000);
    const same = await admin.post('/stock/adjustments', { productId: p.id, storeId: store.id, mode: 'count', quantityMilli: 12_000 });
    expect(same.json().quantityMilli).toBe(12_000);
    const adjusted = await admin.post('/stock/adjustments', { productId: p.id, storeId: store.id, mode: 'adjustment', quantityMilli: -2_000, note: 'Avaria' });
    expect(adjusted.json().quantityMilli).toBe(10_000);
    const bad = await admin.post('/stock/adjustments', { productId: p.id, storeId: store.id, mode: 'count', quantityMilli: -1 });
    expect(bad.statusCode).toBe(400);
    const audit = (await admin.get('/audit')).json().items.map((e: { action: string }) => e.action);
    expect(audit.slice(0, 2)).toEqual(['stock.adjusted', 'stock.counted']);
  });

  it('gives a register its printing context', async () => {
    const owner = await signup(t.app, { taxId: '11222333000181' });
    const d = await terminalDevice(owner, 'Caixa 1', 'desktop');
    const ctx = (await api(t.app, owner.auth).get(`/pos/terminals/${d.terminal.id}/context`)).json();
    expect(ctx).toMatchObject({ taxId: '11222333000181', storeName: 'Loja principal', terminal: { name: 'Caixa 1' } });
    expect((await api(t.app, owner.auth).get('/pos/terminals')).json()).toHaveLength(1);
  });
});
