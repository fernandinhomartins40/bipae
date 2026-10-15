import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { notaDoFornecedor } from './support/supplier-nfe';

/** F5-04.b: a compra pelo XML dá entrada nos lotes que o fornecedor informou (grupo rastro). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('lotes na compra pelo XML (F5-04.b)', () => {
  it('lê o rastro, converte pelo fator e não trava com lote de validade diferente', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'SP',
    });
    const [loja] = (await admin.get('/stores')).json();
    const agua = (
      await admin.post('/products', {
        name: 'Água 500 ml',
        priceCents: 300,
        barcodes: ['7891000100103'],
        tracksLot: true,
      })
    ).json();
    // Um lote "L1" já existe com outra validade.
    await admin.post('/stock/lots', {
      storeId: loja.id,
      productId: agua.id,
      lotCode: 'L1',
      expiresOn: '2027-01-31',
      quantityMilli: 2000,
    });

    // O item 2 (água, 24 un) vem com dois lotes: L1 (validade nova) e L2.
    const xml = await notaDoFornecedor(3001, {}, (x) => {
      const fim = x.indexOf('</prod>', x.indexOf('Água mineral 500 ml'));
      return (
        x.slice(0, fim) +
        '<rastro><nLote>L1</nLote><qLote>10.000</qLote><dFab>2026-09-01</dFab><dVal>2027-06-30</dVal></rastro>' +
        '<rastro><nLote>L2</nLote><qLote>14.000</qLote><dFab>2026-09-20</dFab><dVal>2027-07-31</dVal></rastro>' +
        x.slice(fim)
      );
    });
    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: agua.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);

    const lotes = (await admin.get(`/stock/lots?productId=${agua.id}`)).json() as {
      lotCode: string;
      expiresOn: string;
      quantityMilli: number;
    }[];
    expect(lotes.map((l) => [l.lotCode, l.expiresOn, l.quantityMilli])).toEqual([
      ['L1', '2027-01-31', 2000],
      ['L1 (val. 30/06/2027)', '2027-06-30', 10_000],
      ['L2', '2027-07-31', 14_000],
    ]);
    // O produto sem controle de lote (refrigerante) não ganhou lote.
    const refri = (await admin.get('/products?q=Refrigerante')).json().items[0];
    expect((await admin.get(`/stock/lots?productId=${refri.id}`)).json()).toEqual([]);
  });
});
