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
