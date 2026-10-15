import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-11: inventário pelo celular. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('inventário (F4-11)', () => {
  it('conta bipando e digitando, mostra a diferença e ajusta só o que foi contado', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    const arroz = (
      await admin.post('/products', { name: 'Arroz', priceCents: 2890, barcodes: ['78912342'] })
    ).json();
    const banana = (
      await admin.post('/products', {
        name: 'Banana',
        priceCents: 699,
        unit: 'KG',
        isWeighable: true,
        sku: 'BAN',
      })
    ).json();
    const leite = (await admin.post('/products', { name: 'Leite', priceCents: 549 })).json();
    for (const [p, q] of [
      [arroz, 10_000],
      [banana, 5000],
      [leite, 7000],
    ] as const) {
      await admin.post('/stock/adjustments', {
        productId: p.id,
        storeId: loja.id,
        mode: 'count',
        quantityMilli: q,
      });
    }

    const inv = (await admin.post('/inventories', { storeId: loja.id, name: 'Outubro' })).json();
    expect((await admin.post('/inventories', { storeId: loja.id, name: 'Outra' })).statusCode).toBe(
      409,
    );
    // Dois bipes do arroz, e a balança diz 4,250 kg de banana (pelo código interno).
    await admin.post(`/inventories/${inv.id}/counts`, {
      code: '78912342',
      mode: 'add',
      quantityMilli: 1000,
    });
    const segundo = await admin.post(`/inventories/${inv.id}/counts`, {
      code: '78912342',
      mode: 'add',
      quantityMilli: 1000,
    });
    expect(segundo.json()).toMatchObject({ productName: 'Arroz', countedMilli: 2000 });
    await admin.post(`/inventories/${inv.id}/counts`, {
      code: 'BAN',
      mode: 'set',
      quantityMilli: 4250,
    });
    expect(
      (
        await admin.post(`/inventories/${inv.id}/counts`, {
          productId: arroz.id,
          mode: 'add',
          quantityMilli: 500,
        })
      ).json().message,
    ).toBe('Arroz é contado por unidade inteira.');
    expect(
      (
        await admin.post(`/inventories/${inv.id}/counts`, {
          code: '000',
          mode: 'add',
          quantityMilli: 1000,
        })
      ).statusCode,
    ).toBe(404);

    const aberto = (await admin.get(`/inventories/${inv.id}`)).json();
    expect(aberto.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: 'Arroz', countedMilli: 2000, systemMilli: 10_000 }),
        expect.objectContaining({ productName: 'Banana', countedMilli: 4250, systemMilli: 5000 }),
      ]),
    );

    const fechado = (await admin.post(`/inventories/${inv.id}/close`)).json();
    expect(fechado.status).toBe('closed');
    const saldo = async (id: string) =>
      (await admin.get(`/stock?productId=${id}`)).json()[0]?.quantityMilli;
    expect(await saldo(arroz.id)).toBe(2000);
    expect(await saldo(banana.id)).toBe(4250);
    // O leite não foi contado: não muda.
    expect(await saldo(leite.id)).toBe(7000);
    expect(
      (
        await admin.post(`/inventories/${inv.id}/counts`, {
          code: '78912342',
          mode: 'add',
          quantityMilli: 1000,
        })
      ).statusCode,
    ).toBe(409);
    const trilha = JSON.stringify((await admin.get('/audit?action=inventory.closed')).json());
    expect(trilha).toContain('"adjusted":2');
  });
});
