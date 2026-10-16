import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localToday } from '../src/modules/sales/conditionals.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-12.b: venda condicional — as peças saem para o cliente e o que ele fica vai ao caixa. */

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

describe('venda condicional (F5-12.b)', () => {
  it('leva, devolve parte, e o que ficou chega ao caixa como comanda', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [store] = (await admin.get('/stores')).json();
    const camisa = (
      await admin.post('/products', {
        name: 'Camisa Linho — M',
        priceCents: 15_990,
        barcodes: ['7891000100103'],
      })
    ).json();
    const calca = (
      await admin.post('/products', { name: 'Calça Sarja — 40', priceCents: 19_990 })
    ).json();
    for (const p of [camisa, calca]) {
      await admin.post('/stock/adjustments', {
        productId: p.id,
        storeId: store.id,
        mode: 'adjustment',
        quantityMilli: 5000,
      });
    }
    const cliente = (
      await admin.post('/customers', { name: 'Marina Souza', taxId: '12345678909' })
    ).json();
    const saldo = async (productId: string) =>
      (await admin.get(`/stock?productId=${productId}`))
        .json()
        .reduce((s: number, r: { quantityMilli: number }) => s + r.quantityMilli, 0);

    // Prazo além dos 60 dias do Ajuste SINIEF 02/18 é recusado.
    const longe = await admin.post('/conditionals', {
      storeId: store.id,
      customerId: cliente.id,
      dueOn: addDays(localToday(), 61),
      items: [{ productId: camisa.id, quantityMilli: 1000 }],
    });
    expect(longe.statusCode).toBe(422);
    expect(longe.json().message).toContain('60 dias');
    const fracionado = await admin.post('/conditionals', {
      storeId: store.id,
      customerId: cliente.id,
      items: [{ productId: camisa.id, quantityMilli: 1500 }],
    });
    expect(fracionado.statusCode).toBe(422);

    const criado = await admin.post('/conditionals', {
      storeId: store.id,
      customerId: cliente.id,
      note: 'Provar para o casamento',
      items: [
        { productId: camisa.id, quantityMilli: 2000 },
        { productId: calca.id, quantityMilli: 1000 },
      ],
    });
    expect(criado.statusCode).toBe(201);
    const cond = criado.json();
    expect(cond).toMatchObject({
      number: 1,
      status: 'open',
      customerName: 'Marina Souza',
      dueOn: addDays(localToday(), 60),
      overdue: false,
      totalCents: 2 * 15_990 + 19_990,
    });
    // As peças saíram do estoque.
    expect(await saldo(camisa.id)).toBe(3000);
    expect(await saldo(calca.id)).toBe(4000);

    // Não dá para ficar com mais do que levou.
    const demais = await admin.post(`/conditionals/${cond.id}/close`, {
      items: [{ productId: camisa.id, keptMilli: 3000 }],
    });
    expect(demais.statusCode).toBe(422);

    // Volta: ficou com uma camisa; a outra camisa e a calça voltaram.
    const fechado = await admin.post(`/conditionals/${cond.id}/close`, {
      items: [{ productId: camisa.id, keptMilli: 1000 }],
    });
    expect(fechado.statusCode).toBe(201);
    expect(fechado.json()).toMatchObject({ status: 'closed' });
    expect(fechado.json().tabOrderId).toBeTruthy();
    // Tudo voltou ao estoque; a venda no caixa é que baixa a camisa que ficou.
    expect(await saldo(camisa.id)).toBe(5000);
    expect(await saldo(calca.id)).toBe(5000);
    const deNovo = await admin.post(`/conditionals/${cond.id}/close`, { items: [] });
    expect(deNovo.statusCode).toBe(409);

    // O caixa da loja pega o pedido e abre a comanda "Condicional 1" com a camisa.
    const caixa = (
      await admin.post('/terminals', { storeId: store.id, name: 'Caixa 1', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    await sync.sync();
    await sync.sync();
    const comandas = (await pdv.listTabs()).map((x) => [x.label, x.items, x.totalCents]);
    expect(comandas).toEqual([['Condicional 1', 1, 15_990]]);

    // Cancelar devolve tudo; a auditoria registra cada passo.
    const outro = (
      await admin.post('/conditionals', {
        storeId: store.id,
        customerId: cliente.id,
        items: [{ productId: calca.id, quantityMilli: 2000 }],
      })
    ).json();
    expect(outro.number).toBe(2);
    expect(await saldo(calca.id)).toBe(3000);
    const cancelado = await admin.post(`/conditionals/${outro.id}/cancel`, {});
    expect(cancelado.json()).toMatchObject({ status: 'cancelled', tabOrderId: null });
    expect(await saldo(calca.id)).toBe(5000);

    expect((await admin.get('/conditionals?status=open')).json()).toEqual([]);
    expect((await admin.get('/conditionals')).json()).toHaveLength(2);
    const auditoria = JSON.stringify((await admin.get('/audit?entity=conditional')).json());
    for (const acao of ['conditional.created', 'conditional.closed', 'conditional.cancelled']) {
      expect(auditoria).toContain(acao);
    }

    // Outra empresa não vê o condicional.
    const outraConta = api(t.app, (await signup(t.app)).auth);
    expect((await outraConta.get('/conditionals')).json()).toEqual([]);
    expect((await outraConta.get(`/conditionals/${cond.id}`)).statusCode).toBe(404);
  });
});
