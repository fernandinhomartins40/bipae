import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatform } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
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
  const state = { online: true, pricingSnapshots: 0, fiscalSnapshots: 0 };
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  const impl: SyncTransport = {
    async push(id, events: TerminalEvent[]) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.get(
        `/sync/pull?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      const page = res.json() as SyncPullResult;
      if (page.pricing) state.pricingSnapshots++;
      if (page.fiscal) state.fiscalSnapshots++;
      return page;
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
  return {
    terminal,
    store,
    pdv,
    net: state,
    sync: new SyncClient(storage, pdv, impl, terminal.id),
  };
}

describe('offline sync with two terminals (Adendo 01 §8)', () => {
  it('web and desktop sell the same product offline at the same time and reconcile exactly', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    // Enough products to need several pull pages (limit=2 in the transport).
    const water = (
      await admin.post('/products', { name: 'Água 1,5L', priceCents: 299, barcodes: ['78912342'] })
    ).json();
    for (const name of ['Pão', 'Leite', 'Café'])
      await admin.post('/products', { name, priceCents: 500 });
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
        await d.pdv.completeSale(
          addItem(EMPTY_CART, product, 2000),
          [{ method: 'cash', receivedCents: 1000 }],
          {
            discountLimitPercent: 10,
          },
        );
      }
    }
    const lastWebSale = (await web.pdv.listSales())[0]!;
    await web.pdv.returnItems(
      lastWebSale.id,
      [{ line: 1, quantityMilli: 1000 }],
      'cash',
      'Embalagem furada',
    );
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
      sales.items
        .filter((s: { terminalName: string }) => s.terminalName === name)
        .map((s: { terminalSeq: number }) => s.terminalSeq)
        .sort();
    expect(byTerminal('Tablet')).toEqual([1, 2, 3, 4]);
    expect(byTerminal('Balcão')).toEqual([1, 2, 3]);
    expect(sales.items.find((s: { status: string }) => s.status === 'cancelled')).toBeTruthy();

    // Sensitive actions reached the audit trail with their author.
    const audit = (await admin.get('/audit?limit=100'))
      .json()
      .items.map((e: { action: string }) => e.action);
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
    await d.pdv.completeSale(
      addItem(EMPTY_CART, (await d.pdv.search('bala'))[0]!),
      [{ method: 'pix', receivedCents: 10 }],
      {
        discountLimitPercent: 10,
      },
    );
    const events = await d.pdv.pendingEvents();
    const client = api(t.app, owner.auth);
    for (let i = 0; i < 3; i++) {
      const res = await client.post('/sync/events', { terminalId: d.terminal.id, events });
      expect(res.json()).toEqual({ accepted: events.map((e) => e.id), rejected: [] });
    }
    expect((await admin.get('/sales')).json().total).toBe(1);
    const stock = (await admin.get(`/stock?productId=${product.id}`)).json();
    expect(stock[0].quantityMilli).toBe(-1000);
    expect((await client.get(`/sync/status/${d.terminal.id}`)).json()).toEqual({
      lastDeviceSeq: 2,
      events: 2,
    });
  });

  it('rejects what can never be applied, with a reason, and keeps going', async () => {
    const owner = await signup(t.app);
    const other = await signup(t.app);
    const foreign = (
      await api(t.app, other.auth).post('/products', { name: 'De outra empresa', priceCents: 100 })
    ).json();
    const d = await terminalDevice(owner, 'Caixa', 'web');
    await d.pdv.openSession(0);
    // A tampered terminal tries to sell another tenant's product.
    await d.pdv.completeSale(
      addItem(EMPTY_CART, {
        id: foreign.id,
        name: 'X',
        unit: 'UN',
        priceCents: 100,
        isWeighable: false,
      }),
      [{ method: 'cash', receivedCents: 100 }],
      { discountLimitPercent: 10 },
    );
    await d.pdv.addMovement('supply', 500, 'Troco');
    const status = await d.sync.sync();
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
    expect((await d.pdv.rejectedEvents())[0]?.reason).toBe(
      'A venda tem um produto desconhecido nesta empresa.',
    );
    // The other tenant's stock was not touched.
    expect((await api(t.app, other.auth).get(`/stock?productId=${foreign.id}`)).json()).toEqual([]);
  });

  it('refuses events for a terminal of another business and malformed events', async () => {
    const owner = await signup(t.app);
    const other = await signup(t.app);
    const d = await terminalDevice(other, 'Alheio', 'web');
    await d.pdv.openSession(0);
    const events = await d.pdv.pendingEvents();
    const res = await api(t.app, owner.auth).post('/sync/events', {
      terminalId: d.terminal.id,
      events,
    });
    expect(res.statusCode).toBe(404);

    const own = await terminalDevice(owner, 'Meu', 'web');
    const bad = await api(t.app, owner.auth).post('/sync/events', {
      terminalId: own.terminal.id,
      events: [{ id: '0192a000-0000-7000-8000-000000000000', type: 'sale.completed' }],
    });
    expect(bad.json().rejected[0].reason).toMatch(/^Evento inválido/);

    const mismatch = await api(t.app, { ...owner.auth, 'x-bipae-terminal': d.terminal.id }).post(
      '/sync/events',
      {
        terminalId: own.terminal.id,
        events,
      },
    );
    expect(mismatch.statusCode).toBe(400);
  });

  it('accepts pending sales from an outdated desktop even when an update is required', async () => {
    const strict = await createTestApp({ MIN_CLIENT_VERSION_DESKTOP: '9.0.0' });
    try {
      const owner = await signup(strict.app);
      const store = (await api(strict.app, owner.auth).get('/stores')).json()[0];
      const terminal = (
        await api(strict.app, owner.auth).post('/terminals', {
          storeId: store.id,
          name: 'Velho',
          platform: 'desktop',
        })
      ).json();
      const storage = createStorage(nodeSqliteDriver());
      await migrateLocal(storage);
      const pdv = new PdvService(storage, {
        terminalId: terminal.id,
        operatorId: owner.me.user.id,
      });
      await pdv.openSession(1000);
      const oldClient = { ...owner.auth, 'x-bipae-client': 'desktop/1.0.0' };
      const blocked = await strict.app.inject({
        method: 'GET',
        url: '/v1/products',
        headers: oldClient,
      });
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
    const counted = await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'count',
      quantityMilli: 12_000,
      note: 'Inventário',
    });
    expect(counted.json().quantityMilli).toBe(12_000);
    const same = await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'count',
      quantityMilli: 12_000,
    });
    expect(same.json().quantityMilli).toBe(12_000);
    const adjusted = await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'adjustment',
      quantityMilli: -2_000,
      note: 'Avaria',
    });
    expect(adjusted.json().quantityMilli).toBe(10_000);
    const bad = await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'count',
      quantityMilli: -1,
    });
    expect(bad.statusCode).toBe(400);
    const audit = (await admin.get('/audit')).json().items.map((e: { action: string }) => e.action);
    expect(audit.slice(0, 2)).toEqual(['stock.adjusted', 'stock.counted']);
  });

  it('gives a register its printing context', async () => {
    const owner = await signup(t.app, { taxId: '11222333000181' });
    const d = await terminalDevice(owner, 'Caixa 1', 'desktop');
    const ctx = (
      await api(t.app, owner.auth).get(`/pos/terminals/${d.terminal.id}/context`)
    ).json();
    expect(ctx).toMatchObject({
      taxId: '11222333000181',
      storeName: 'Loja principal',
      terminal: { name: 'Caixa 1' },
    });
    expect((await api(t.app, owner.auth).get('/pos/terminals')).json()).toHaveLength(1);
  });
});

describe('tabelas de preço no caixa sem internet (F1-03)', () => {
  it('tabela da loja, tabela do cliente pelo CPF, mudança de preço e venda offline com o preço da tabela', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const arroz = (
      await admin.post('/products', {
        name: 'Arroz 5kg',
        priceCents: 2890,
        barcodes: ['7891000315507'],
      })
    ).json();
    const tabelaLoja = (
      await admin.post('/price-tables', {
        name: 'Loja Centro',
        items: [{ productId: arroz.id, priceCents: 2700 }],
      })
    ).json();
    const atacado = (
      await admin.post('/price-tables', {
        name: 'Atacado',
        items: [{ productId: arroz.id, priceCents: 2500 }],
      })
    ).json();
    const loja = (await admin.get('/stores')).json()[0];
    await admin.patch(`/stores/${loja.id}`, { priceTableId: tabelaLoja.id });
    await admin.post('/customers', {
      name: 'Bar do Zé',
      taxId: '529.982.247-25',
      priceTableId: atacado.id,
    });

    const caixa = await terminalDevice(owner, 'Caixa tabela', 'web');
    await caixa.sync.sync();
    expect(caixa.net.pricingSnapshots).toBe(1);

    // Sem cliente vale a tabela da loja; com o CPF na venda, vale a tabela do cliente.
    expect((await caixa.pdv.findByCode('7891000315507'))!.priceCents).toBe(2700);
    expect((await caixa.pdv.findByCode('7891000315507', '52998224725'))!.priceCents).toBe(2500);
    expect((await caixa.pdv.findByCode('7891000315507', '11144477735'))!.priceCents).toBe(2700);
    expect((await caixa.pdv.activePriceTable('52998224725'))!.name).toBe('Atacado');
    expect((await caixa.pdv.search('arroz', 5))[0]!.priceCents).toBe(2700);
    expect((await caixa.pdv.pricesFor([arroz.id], '52998224725')).get(arroz.id)).toBe(2500);

    // Nada mudou: o retrato de preços não é enviado de novo.
    await caixa.sync.sync();
    expect(caixa.net.pricingSnapshots).toBe(1);

    // Mudança de preço chega ao caixa na próxima sincronização.
    await admin.put(`/price-tables/${tabelaLoja.id}`, {
      name: 'Loja Centro',
      items: [{ productId: arroz.id, priceCents: 2650 }],
    });
    await caixa.sync.sync();
    expect(caixa.net.pricingSnapshots).toBe(2);
    expect((await caixa.pdv.findByCode('7891000315507'))!.priceCents).toBe(2650);

    // Venda sem internet para o cliente do atacado: o servidor recebe o preço da tabela.
    caixa.net.online = false;
    await caixa.pdv.openSession(0);
    const produto = (await caixa.pdv.findByCode('7891000315507', '52998224725'))!;
    const carrinho = { ...addItem(EMPTY_CART, produto, 2000), customerTaxId: '52998224725' };
    await caixa.pdv.completeSale(carrinho, [{ method: 'pix', receivedCents: 5000 }], {
      discountLimitPercent: 10,
    });
    caixa.net.online = true;
    expect(await caixa.sync.sync()).toMatchObject({ pending: 0, rejected: 0 });
    const vendas = (await admin.get('/sales')).json();
    expect(vendas.items[0]).toMatchObject({ totalCents: 5000 });

    // Sem tabela na loja, volta o preço do cadastro.
    await admin.patch(`/stores/${loja.id}`, { priceTableId: null });
    await caixa.sync.sync();
    expect((await caixa.pdv.findByCode('7891000315507'))!.priceCents).toBe(2890);
  });
});

describe('kits no estoque (F1-04)', () => {
  it('vender um kit baixa os componentes; cancelar e devolver devolvem', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const loja = (await admin.get('/stores')).json()[0];
    const arroz = (await admin.post('/products', { name: 'Arroz 5kg', priceCents: 2890 })).json();
    const feijao = (await admin.post('/products', { name: 'Feijão 1kg', priceCents: 899 })).json();
    for (const [produto, quantidade] of [
      [arroz, 10_000],
      [feijao, 20_000],
    ] as const) {
      await admin.post('/stock/adjustments', {
        productId: produto.id,
        storeId: loja.id,
        mode: 'count',
        quantityMilli: quantidade,
      });
    }
    // Cesta: 1 arroz e 2 feijões.
    const cesta = (
      await admin.post('/products', {
        name: 'Cesta Básica',
        priceCents: 4500,
        barcodes: ['7890000000017'],
        components: [
          { productId: arroz.id, quantity: 1 },
          { productId: feijao.id, quantity: 2 },
        ],
      })
    ).json();
    const estoque = async (id: string) =>
      ((await admin.get(`/stock?productId=${id}`)).json()[0]?.quantityMilli as number) ?? 0;

    const caixa = await terminalDevice(owner, 'Caixa kit', 'web');
    await caixa.sync.sync();
    await caixa.pdv.openSession(0);
    const produto = (await caixa.pdv.findByCode('7890000000017'))!;
    // Três cestas numa venda, uma cesta em outra.
    await caixa.pdv.completeSale(
      addItem(EMPTY_CART, produto, 3000),
      [{ method: 'pix', receivedCents: 13500 }],
      {
        discountLimitPercent: 10,
      },
    );
    const segunda = await caixa.pdv.completeSale(
      addItem(EMPTY_CART, produto, 1000),
      [{ method: 'pix', receivedCents: 4500 }],
      { discountLimitPercent: 10 },
    );
    expect(await caixa.sync.sync()).toMatchObject({ pending: 0, rejected: 0 });
    // 4 cestas: 10 − 4 arroz, 20 − 8 feijão; a cesta não tem estoque próprio.
    expect(await estoque(arroz.id)).toBe(6_000);
    expect(await estoque(feijao.id)).toBe(12_000);
    expect(await estoque(cesta.id)).toBe(0);

    // Cancelar a venda de 1 cesta devolve 1 arroz e 2 feijões.
    await caixa.pdv.cancelSale(segunda.id, 'Cliente desistiu', owner.me.user.id);
    // Devolver 1 das 3 cestas da primeira venda devolve mais 1 arroz e 2 feijões.
    const primeira = (await caixa.pdv.findSaleBySeq(1))!;
    await caixa.pdv.returnItems(
      primeira.id,
      [{ line: 1, quantityMilli: 1000 }],
      'cash',
      'Veio amassada',
    );
    expect(await caixa.sync.sync()).toMatchObject({ pending: 0, rejected: 0 });
    expect(await estoque(arroz.id)).toBe(8_000);
    expect(await estoque(feijao.id)).toBe(16_000);
  });

  it('regras da composição: sem kit dentro de kit e só produtos desta empresa', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const sabao = (await admin.post('/products', { name: 'Sabão', priceCents: 500 })).json();
    const kit = (
      await admin.post('/products', {
        name: 'Kit Limpeza',
        priceCents: 900,
        components: [{ productId: sabao.id, quantity: 2 }],
      })
    ).json();

    const kitDeKit = await admin.post('/products', {
      name: 'Kit grande',
      priceCents: 2000,
      components: [{ productId: kit.id, quantity: 1 }],
    });
    expect(kitDeKit.statusCode).toBe(400);
    expect(kitDeKit.json().message).toBe('Um kit não pode ter outro kit como componente.');

    const virarKit = await admin.put(`/products/${sabao.id}`, {
      ...sabao,
      components: [{ productId: kit.id, quantity: 1 }],
    });
    expect(virarKit.statusCode).toBe(400);

    const outra = await signup(t.app);
    const alheio = (
      await api(t.app, outra.auth).post('/products', { name: 'De outro', priceCents: 100 })
    ).json();
    const deOutraEmpresa = await admin.post('/products', {
      name: 'Kit estranho',
      priceCents: 100,
      components: [{ productId: alheio.id, quantity: 1 }],
    });
    expect(deOutraEmpresa.statusCode).toBe(400);
    expect(deOutraEmpresa.json().message).toBe('Um dos componentes do kit não existe.');
  });
});

describe('dados fiscais no caixa (F3-06.d2)', () => {
  it('o caixa recebe a UF e o regime da empresa e os perfis fiscais, e só de novo quando mudam', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, uf: 'SP', taxRegime: 'real' });
    const perfil = (
      await admin.post('/fiscal-profiles', {
        name: 'Revenda Lucro Real',
        origem: 0,
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        cstIcms: '00',
        cstPisCofins: '01',
        cClassTrib: '000001',
      })
    ).json();
    expect(perfil.data.cstPisCofins).toBe('01');

    const caixa = await terminalDevice(dono, 'Caixa fiscal', 'web');
    // Caixa novo, antes de sincronizar: não sabe nada e não inventa.
    expect((await caixa.pdv.fiscalContext()).company).toEqual({ uf: null, taxRegime: null });

    await caixa.sync.sync();
    expect(caixa.net.fiscalSnapshots).toBe(1);
    const contexto = await caixa.pdv.fiscalContext();
    expect(contexto.company).toEqual({ uf: 'SP', taxRegime: 'real' });
    expect(contexto.profiles.get(perfil.id)).toEqual({
      cfopInterna: '5102',
      cfopInterestadual: '6102',
      csosn: null,
      cstIcms: '00',
      cstPisCofins: '01',
      cClassTrib: '000001',
    });

    // Nada mudou: o retrato fiscal não vem de novo.
    await caixa.sync.sync();
    expect(caixa.net.fiscalSnapshots).toBe(1);

    // Mudou o regime da empresa: chega na próxima sincronização.
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, uf: 'SP', taxRegime: 'presumido' });
    await caixa.sync.sync();
    expect(caixa.net.fiscalSnapshots).toBe(2);
    expect((await caixa.pdv.fiscalContext()).company.taxRegime).toBe('presumido');

    // Mudou um perfil: também.
    await admin.put(`/fiscal-profiles/${perfil.id}`, {
      name: 'Revenda Lucro Real',
      origem: 0,
      cfopInterna: '5405',
      cfopInterestadual: '6102',
      cstIcms: '60',
      cstPisCofins: '04',
      cClassTrib: '000001',
    });
    await caixa.sync.sync();
    expect(caixa.net.fiscalSnapshots).toBe(3);
    expect((await caixa.pdv.fiscalContext()).profiles.get(perfil.id)).toMatchObject({ cfopInterna: '5405', cstIcms: '60' });
  });

  it('recusa CST de PIS/COFINS que não existe', async () => {
    const admin = api(t.app, (await signup(t.app)).auth);
    const res = await admin.post('/fiscal-profiles', {
      name: 'CST errado',
      origem: 0,
      cfopInterna: '5102',
      cfopInterestadual: '6102',
      cstIcms: '00',
      cstPisCofins: '10',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('O CST de PIS/COFINS 10 não existe.');
  });
});

describe('impostos da venda gravados e conferidos no servidor (F3-06.d3)', () => {
  const perfilReal = {
    name: 'Revenda Lucro Real',
    origem: 0,
    cfopInterna: '5102',
    cfopInterestadual: '6102',
    cstIcms: '00',
    cstPisCofins: '01',
    cClassTrib: '000001',
  };
  const gravado = async (saleId: string) => {
    const linhas = await asPlatform(t.database.db, async (tx) =>
      rowsOf<{ taxes: Record<string, unknown> | null; tax_check: string | null }>(
        await tx.execute(
          sql`select i.taxes, s.tax_check from sales s join sale_items i on i.sale_id = s.id
              where s.id = ${saleId} order by i.line`,
        ),
      ),
    );
    return { itens: linhas.map((l) => l.taxes), conferencia: linhas[0]?.tax_check ?? null };
  };

  it('venda sem internet leva os impostos; o servidor grava e a conta dele bate', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, uf: 'SP', taxRegime: 'real' });
    const perfil = (await admin.post('/fiscal-profiles', perfilReal)).json();
    const arroz = (
      await admin.post('/products', {
        name: 'Arroz 5kg',
        priceCents: 10_000,
        barcodes: ['7891000315507'],
        fiscalProfileId: perfil.id,
      })
    ).json();

    const caixa = await terminalDevice(dono, 'Caixa impostos', 'web');
    await caixa.sync.sync();
    caixa.net.online = false;
    await caixa.pdv.openSession(0);
    const produto = (await caixa.pdv.findByCode('7891000315507'))!;
    const venda = await caixa.pdv.completeSale(
      addItem(EMPTY_CART, produto),
      [{ method: 'pix', receivedCents: 10_000 }],
      { discountLimitPercent: 10 },
    );
    expect(venda.items[0]!.taxes).toMatchObject({ crt: 3, icmsCents: 1800, complete: true });

    caixa.net.online = true;
    await caixa.sync.sync();
    const noServidor = await gravado(venda.id);
    expect(noServidor.itens[0]).toMatchObject({ crt: 3, cfop: '5102', icmsCents: 1800, pisCents: 135, cofinsCents: 623 });
    expect(noServidor.conferencia).toBe('ok');
    expect(arroz.fiscalProfileId).toBe(perfil.id);
  });

  it('se o cadastro mudou e o caixa ainda não sabia, a venda entra e fica marcada como divergente', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, uf: 'SP', taxRegime: 'real' });
    const perfil = (await admin.post('/fiscal-profiles', perfilReal)).json();
    await admin.post('/products', {
      name: 'Feijão 1kg',
      priceCents: 10_000,
      barcodes: ['78912342'],
      fiscalProfileId: perfil.id,
    });

    const caixa = await terminalDevice(dono, 'Caixa defasado', 'web');
    await caixa.sync.sync();
    caixa.net.online = false;
    // Enquanto o caixa está sem internet, a empresa muda de regime na retaguarda.
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, uf: 'SP', taxRegime: 'presumido' });
    await caixa.pdv.openSession(0);
    const venda = await caixa.pdv.completeSale(
      addItem(EMPTY_CART, (await caixa.pdv.findByCode('78912342'))!),
      [{ method: 'pix', receivedCents: 10_000 }],
      { discountLimitPercent: 10 },
    );

    caixa.net.online = true;
    const estado = await caixa.sync.sync();
    // A venda não é recusada: o cliente já levou a mercadoria.
    expect(estado.rejected).toBe(0);
    expect(estado.pending).toBe(0);
    const noServidor = await gravado(venda.id);
    // Fica gravado o que o caixa calculou (regime antigo), com o sinal de divergência.
    expect(noServidor.itens[0]).toMatchObject({ pisCents: 135 });
    expect(noServidor.conferencia).toBe('divergente');
  });

  it('empresa que não configurou a parte fiscal: venda sem impostos e sem conferência', async () => {
    const dono = await signup(t.app);
    await api(t.app, dono.auth).post('/products', { name: 'Pão', priceCents: 500, barcodes: ['96385074'] });
    const caixa = await terminalDevice(dono, 'Caixa simples', 'web');
    await caixa.sync.sync();
    await caixa.pdv.openSession(0);
    const venda = await caixa.pdv.completeSale(
      addItem(EMPTY_CART, (await caixa.pdv.findByCode('96385074'))!),
      [{ method: 'cash', receivedCents: 500 }],
      { discountLimitPercent: 10 },
    );
    await caixa.sync.sync();
    expect(await gravado(venda.id)).toEqual({ itens: [null], conferencia: null });
  });
});
