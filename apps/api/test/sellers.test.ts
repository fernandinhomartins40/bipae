import type { SalesReport, SellerView, SyncPullResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F8-01: vendedor cadastrado, escolhido no caixa sem internet e visto no relatório. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('vendedores (F8-01)', () => {
  it('cadastra com código único, liga ao usuário e registra na auditoria', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ana = await admin.post('/sellers', { name: 'Ana', code: '7' });
    expect(ana.statusCode).toBe(201);
    const repetido = await admin.post('/sellers', { name: 'Bia', code: '7' });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().message).toBe('O código 7 já é de Ana. Escolha outro.');
    expect((await admin.post('/sellers', { name: 'Bia', code: 'ab' })).statusCode).toBe(400);

    const ligado = await admin.put(`/sellers/${ana.json().id}`, {
      name: 'Ana Souza',
      code: '07',
      userId: dono.me.user.id,
      active: true,
    });
    expect(ligado.json()).toMatchObject({
      name: 'Ana Souza',
      code: '07',
      userName: expect.stringMatching(/^Dono /),
    });
    const outro = await admin.post('/sellers', {
      name: 'Caio',
      code: '8',
      userId: dono.me.user.id,
    });
    expect(outro.statusCode).toBe(409);

    const audit = (await admin.get('/audit?limit=20')).json();
    const actions = (audit.items ?? audit).map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['seller.created', 'seller.updated']));

    // Outra empresa não vê os vendedores desta.
    const vizinho = await signup(t.app);
    expect((await api(t.app, vizinho.auth).get('/sellers')).json()).toEqual([]);
  });

  it('o caixa recebe os vendedores, vende sem internet com um deles e o relatório mostra', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ana = (await admin.post('/sellers', { name: 'Ana', code: '7' })).json() as SellerView;
    await admin.post('/sellers', { name: 'Inativo', code: '9', active: false });
    await admin.post('/products', { name: 'Camiseta', priceCents: 5000, barcodes: ['78900011'] });
    const store = (await admin.get('/stores')).json()[0];
    const terminal = (
      await admin.post('/terminals', { storeId: store.id, name: 'Balcão', platform: 'web' })
    ).json();

    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: terminal.id, operatorId: dono.me.user.id });
    const client = api(t.app, { ...dono.auth, 'x-bipae-terminal': terminal.id });
    let online = true;
    const transport: SyncTransport = {
      async push(id, events: TerminalEvent[]) {
        if (!online) throw new Error('Sem conexão');
        return (await client.post('/sync/events', { terminalId: id, events })).json();
      },
      async pull(cursor, _limit, pricingVersion, fiscalVersion) {
        if (!online) throw new Error('Sem conexão');
        const q = new URLSearchParams({ limit: '50' });
        if (cursor) q.set('cursor', cursor);
        if (pricingVersion) q.set('pricingVersion', pricingVersion);
        if (fiscalVersion) q.set('fiscalVersion', fiscalVersion);
        return (await client.get(`/sync/pull?${q}`)).json() as SyncPullResult;
      },
    };
    const sync = new SyncClient(storage, pdv, transport, terminal.id);
    expect((await sync.sync()).lastError).toBeNull();
    // Só os ativos chegam ao caixa.
    expect((await pdv.sellers()).map((s) => s.name)).toEqual(['Ana']);

    online = false;
    const seller = (await pdv.sellerByCode('07'))!;
    const camiseta = (await pdv.findByCode('78900011'))!;
    await pdv.openSession(0);
    await pdv.completeSale(
      { ...addItem(EMPTY_CART, camiseta, 2000), seller },
      [{ method: 'cash', receivedCents: 10_000 }],
      { discountLimitPercent: 10 },
    );
    await pdv.completeSale(
      addItem(EMPTY_CART, camiseta),
      [{ method: 'pix', receivedCents: 5000 }],
      {
        discountLimitPercent: 10,
      },
    );
    online = true;
    expect((await sync.sync()).lastError).toBeNull();

    const report = (
      await admin.get(`/reports/sales?from=${today()}&to=${today()}&group=seller`)
    ).json() as SalesReport;
    const byLabel = Object.fromEntries(report.rows.map((r) => [r.label, r.revenueCents]));
    expect(byLabel).toEqual({ Ana: 10_000, 'Sem vendedor': 5000 });
    expect(report.rows.find((r) => r.label === 'Ana')?.key).toBe(ana.id);
  });
});
