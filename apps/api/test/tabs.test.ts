import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-07: as comandas do caixa chegam ao servidor para o garçom e a cozinha. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function transport(auth: Record<string, string>, terminalId: string): SyncTransport {
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  return {
    async push(id, events: TerminalEvent[]) {
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      const res = await client.get(
        `/sync/pull?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      return res.json() as SyncPullResult;
    },
  };
}

describe('comandas no servidor (F5-07)', () => {
  it('abre, recebe as rodadas, fecha paga e cancela com auditoria', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [store] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Cerveja 600 ml',
      priceCents: 1200,
      barcodes: ['7891149101009'],
    });
    const caixa = (
      await admin.post('/terminals', { storeId: store.id, name: 'Bar', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const cerveja = (await pdv.findByCode('7891149101009'))!;

    const mesa = await pdv.openTab('Mesa 3');
    await pdv.saveTab(addItem(mesa, cerveja, 2000));
    const balcao = await pdv.openTab('Balcão 1');
    await pdv.saveTab(addItem(balcao, cerveja, 1000));
    expect((await sync.sync()).lastError).toBeNull();

    const abertas = (await admin.get('/tabs')).json();
    expect(abertas).toEqual([
      expect.objectContaining({
        label: 'Mesa 3',
        status: 'open',
        storeId: store.id,
        totalCents: 2400,
        items: [expect.objectContaining({ name: 'Cerveja 600 ml', quantityMilli: 2000 })],
      }),
      expect.objectContaining({ label: 'Balcão 1', totalCents: 1200 }),
    ]);

    // Segunda rodada da mesa e a conta fechada; o balcão é cancelado.
    const conta = addItem(await pdv.loadTab(mesa.tabId!), cerveja, 1000);
    await pdv.saveTab(conta);
    const venda = await pdv.completeSale(
      await pdv.loadTab(mesa.tabId!),
      [{ method: 'pix', receivedCents: 3600 }],
      { discountLimitPercent: 10 },
    );
    await pdv.cancelTab(balcao.tabId!, 'Cliente desistiu');
    expect((await sync.sync()).lastError).toBeNull();

    expect((await admin.get('/tabs')).json()).toEqual([]);
    const pagas = (await admin.get('/tabs?status=paid')).json();
    expect(pagas).toEqual([
      expect.objectContaining({ label: 'Mesa 3', totalCents: 3600, saleId: venda.id }),
    ]);
    const canceladas = (await admin.get('/tabs?status=cancelled')).json();
    expect(canceladas).toEqual([
      expect.objectContaining({ label: 'Balcão 1', cancelReason: 'Cliente desistiu' }),
    ]);
    expect(JSON.stringify((await admin.get('/audit')).json())).toContain('tab.cancelled');
    expect((await admin.get('/tabs?status=outra')).statusCode).toBe(422);
  });
});

describe('tela da cozinha (F5-09)', () => {
  it('cada rodada manda à cozinha só o que é novo; pronto, entregue e cancelado', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [store] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Cerveja 600 ml',
      priceCents: 1200,
      barcodes: ['7891149101009'],
    });
    await admin.post('/products', {
      name: 'Porção de fritas',
      priceCents: 3500,
      barcodes: ['7891000053508'],
      kitchen: true,
    });
    const caixa = (
      await admin.post('/terminals', { storeId: store.id, name: 'Bar', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const cerveja = (await pdv.findByCode('7891149101009'))!;
    const porcao = (await pdv.findByCode('7891000053508'))!;
    const fila = async () => (await admin.get('/kitchen/tickets')).json();

    // Rodada 1: duas porções e uma cerveja; só a porção vai para a cozinha.
    const mesa = await pdv.openTab('Mesa 9');
    await pdv.saveTab(addItem(addItem(mesa, porcao, 2000), cerveja, 1000));
    await sync.sync();
    const [primeiro] = await fila();
    expect(await fila()).toHaveLength(1);
    expect(primeiro).toMatchObject({
      tabLabel: 'Mesa 9',
      name: 'Porção de fritas',
      quantityMilli: 2000,
      status: 'pending',
    });

    // Rodada 2: mais uma porção na mesma linha; vai só a que é nova.
    const rodada = await pdv.loadTab(mesa.tabId!);
    rodada.lines = rodada.lines.map((l) =>
      l.productId === porcao.id ? { ...l, quantityMilli: 3000 } : l,
    );
    await pdv.saveTab(rodada);
    await sync.sync();
    const depois = await fila();
    expect(depois.map((x: { quantityMilli: number }) => x.quantityMilli)).toEqual([2000, 1000]);

    expect((await admin.post(`/kitchen/tickets/${primeiro.id}/ready`)).json().status).toBe('ready');
    expect((await admin.post(`/kitchen/tickets/${primeiro.id}/ready`)).statusCode).toBe(409);
    expect((await admin.post(`/kitchen/tickets/${primeiro.id}/delivered`)).json().status).toBe(
      'delivered',
    );

    // Comanda cancelada: o que estava na fila sai.
    await pdv.cancelTab(mesa.tabId!, 'Cliente foi embora');
    await sync.sync();
    const final = await fila();
    expect(final.map((x: { status: string }) => x.status)).toEqual(['delivered']);
  });
});
