import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-12: transferência entre lojas. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('transferência entre lojas (F4-12)', () => {
  it('envia (sai da origem), recebe com diferença (entra no destino) e cancela devolvendo', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [matriz] = (await admin.get('/stores')).json();
    const empresa = (await admin.get('/companies')).json()[0];
    const filial = (
      await admin.post('/stores', { companyId: empresa.id, name: 'Filial Centro' })
    ).json();
    expect(filial.id).toBeTruthy();
    const arroz = (await admin.post('/products', { name: 'Arroz', priceCents: 2890 })).json();
    const queijo = (
      await admin.post('/products', {
        name: 'Queijo',
        priceCents: 4990,
        unit: 'KG',
        isWeighable: true,
      })
    ).json();
    for (const [p, q] of [
      [arroz, 20_000],
      [queijo, 3000],
    ] as const) {
      await admin.post('/stock/adjustments', {
        productId: p.id,
        storeId: matriz.id,
        mode: 'count',
        quantityMilli: q,
      });
    }
    const saldo = async (productId: string, storeId: string) =>
      (await admin.get(`/stock?productId=${productId}`))
        .json()
        .find((s: { storeId: string }) => s.storeId === storeId)?.quantityMilli ?? 0;

    expect(
      (
        await admin.post('/stock/transfers', {
          fromStoreId: matriz.id,
          toStoreId: matriz.id,
          items: [{ productId: arroz.id, quantityMilli: 1000 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await admin.post('/stock/transfers', {
          fromStoreId: matriz.id,
          toStoreId: filial.id,
          items: [{ productId: arroz.id, quantityMilli: 1500 }],
        })
      ).json().message,
    ).toBe('Arroz vai por unidade inteira.');

    const enviada = (
      await admin.post('/stock/transfers', {
        fromStoreId: matriz.id,
        toStoreId: filial.id,
        note: 'Reposição',
        items: [
          { productId: arroz.id, quantityMilli: 5000 },
          { productId: queijo.id, quantityMilli: 1250 },
        ],
      })
    ).json();
    expect(enviada).toMatchObject({
      status: 'in_transit',
      fromStoreName: matriz.name,
      toStoreName: 'Filial Centro',
      needsInvoice: false,
    });
    // Em trânsito: já saiu da matriz e ainda não entrou na filial.
    expect(await saldo(arroz.id, matriz.id)).toBe(15_000);
    expect(await saldo(arroz.id, filial.id)).toBe(0);

    // Chegaram só 4 arrozes; o queijo veio inteiro.
    const recebida = (
      await admin.post(`/stock/transfers/${enviada.id}/receive`, {
        items: [{ productId: arroz.id, receivedMilli: 4000 }],
      })
    ).json();
    expect(recebida.status).toBe('received');
    expect(recebida.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productName: 'Arroz', quantityMilli: 5000, receivedMilli: 4000 }),
        expect.objectContaining({ productName: 'Queijo', receivedMilli: 1250 }),
      ]),
    );
    expect(await saldo(arroz.id, filial.id)).toBe(4000);
    expect(await saldo(queijo.id, filial.id)).toBe(1250);
    expect(await saldo(queijo.id, matriz.id)).toBe(1750);
    expect((await admin.post(`/stock/transfers/${enviada.id}/receive`, {})).statusCode).toBe(409);
    const trilha = JSON.stringify(
      (await admin.get('/audit?action=stock.transfer_received')).json(),
    );
    expect(trilha).toContain('"sent":5000');
    expect(trilha).toContain('"received":4000');

    // Cancelar antes de receber devolve à origem.
    const outra = (
      await admin.post('/stock/transfers', {
        fromStoreId: matriz.id,
        toStoreId: filial.id,
        items: [{ productId: arroz.id, quantityMilli: 2000 }],
      })
    ).json();
    expect(await saldo(arroz.id, matriz.id)).toBe(13_000);
    expect(
      (await admin.post(`/stock/transfers/${outra.id}/cancel`, { reason: '' })).statusCode,
    ).toBe(400);
    const cancelada = (
      await admin.post(`/stock/transfers/${outra.id}/cancel`, { reason: 'Caminhão quebrou' })
    ).json();
    expect(cancelada).toMatchObject({ status: 'cancelled', cancelReason: 'Caminhão quebrou' });
    expect(await saldo(arroz.id, matriz.id)).toBe(15_000);
    expect((await admin.post(`/stock/transfers/${outra.id}/receive`, {})).statusCode).toBe(409);

    const lista = (await admin.get('/stock/transfers')).json();
    expect(lista.map((x: { status: string }) => x.status)).toEqual(['cancelled', 'received']);
  });

  it('entre empresas de CNPJs diferentes marca que precisa de NF-e de transferência', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [matriz] = (await admin.get('/stores')).json();
    const outra = await admin.post('/companies', { legalName: 'Outra Empresa Ltda' });
    expect(outra.statusCode).toBe(201);
    const loja = (
      await admin.post('/stores', { companyId: outra.json().id, name: 'Loja da Outra' })
    ).json();
    const cafe = (await admin.post('/products', { name: 'Café', priceCents: 1990 })).json();
    const tr = (
      await admin.post('/stock/transfers', {
        fromStoreId: matriz.id,
        toStoreId: loja.id,
        items: [{ productId: cafe.id, quantityMilli: 3000 }],
      })
    ).json();
    expect(tr.needsInvoice).toBe(true);
  });
});
