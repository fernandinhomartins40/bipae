import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allocateFefo, fefoOrder } from '../src/modules/stock/lots.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-04.a: lote e validade, com a venda saindo pelo lote que vence primeiro (FEFO). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const lote = (id: string, expiresOn: string | null, quantityMilli: number, ms = 0) => ({
  id,
  expiresOn,
  quantityMilli,
  createdAt: new Date(1_700_000_000_000 + ms),
});

describe('ordem FEFO', () => {
  it('dentro da validade primeiro (do que vence antes), depois sem validade, por último vencidos', () => {
    const lotes = [
      lote('vencido', '2026-10-01', 5),
      lote('sem-data', null, 5),
      lote('dezembro', '2026-12-01', 5),
      lote('novembro', '2026-11-01', 5),
      lote('sem-data-antigo', null, 5, -1000),
    ];
    expect(fefoOrder(lotes, '2026-10-15').map((l) => l.id)).toEqual([
      'novembro',
      'dezembro',
      'sem-data-antigo',
      'sem-data',
      'vencido',
    ]);
  });

  it('reparte a quantidade entre os lotes e diz o que ficou sem lote', () => {
    expect(
      allocateFefo(
        [lote('a', '2026-11-01', 3000), lote('b', '2026-12-01', 2000)],
        4000,
        '2026-10-15',
      ),
    ).toEqual({
      taken: [
        { lotId: 'a', milli: 3000 },
        { lotId: 'b', milli: 1000 },
      ],
      missingMilli: 0,
    });
    expect(allocateFefo([lote('a', null, 1000)], 3000, '2026-10-15').missingMilli).toBe(2000);
  });
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

describe('lotes na loja (F5-04.a)', () => {
  it('entrada, venda pelo lote que vence primeiro, devolução, cancelamento, descarte e recall', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    const iogurte = (
      await admin.post('/products', {
        name: 'Iogurte morango',
        priceCents: 399,
        barcodes: ['78912342'],
      })
    ).json();
    const entrada = (lotCode: string, expiresOn: string, quantityMilli: number, extra = {}) =>
      admin.post('/stock/lots', {
        storeId: loja.id,
        productId: iogurte.id,
        lotCode,
        expiresOn,
        quantityMilli,
        addsStock: true,
        ...extra,
      });

    // Sem o controle de lote ligado no produto, a tela explica o que fazer.
    expect((await entrada('L1', '2099-01-10', 3000)).json().message).toBe(
      'Ative "controla lote e validade" no cadastro de Iogurte morango antes de informar o lote.',
    );
    await admin.put(`/products/${iogurte.id}`, { ...iogurte, tracksLot: true });
    expect((await entrada('L-JAN', '2099-01-10', 3000)).statusCode).toBe(201);
    expect((await entrada('L-FEV', '2099-02-10', 5000)).statusCode).toBe(201);
    expect((await entrada('L-FEV', '2099-03-01', 1000)).statusCode).toBe(409);
    expect((await entrada('L-X', '2099-02-10', 1500)).statusCode).toBe(422);
    // Só identificar estoque que já existe não soma no estoque do produto.
    expect((await entrada('L-VELHO', '2020-01-01', 2000, { addsStock: false })).statusCode).toBe(
      201,
    );
    const saldo = async () =>
      (await admin.get(`/stock?productId=${iogurte.id}`)).json()[0]?.quantityMilli;
    expect(await saldo()).toBe(8000);

    // O caixa vende 4: sai 3 do lote de janeiro e 1 do de fevereiro; o vencido fica.
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const produto = (await pdv.findByCode('78912342'))!;
    const venda = await pdv.completeSale(
      addItem(EMPTY_CART, produto, 4000),
      [{ method: 'cash', receivedCents: 2000 }],
      { discountLimitPercent: 10 },
    );
    const outra = await pdv.completeSale(
      addItem(EMPTY_CART, produto, 1000),
      [{ method: 'cash', receivedCents: 500 }],
      { discountLimitPercent: 10 },
    );
    expect((await sync.sync()).lastError).toBeNull();

    const lotes = async () =>
      Object.fromEntries(
        (
          (await admin.get(`/stock/lots?productId=${iogurte.id}`)).json() as {
            lotCode: string;
            quantityMilli: number;
          }[]
        ).map((l) => [l.lotCode, l.quantityMilli]),
      );
    expect(await lotes()).toEqual({ 'L-FEV': 3000, 'L-VELHO': 2000 });

    // Devolução de 2 da primeira venda volta ao lote de onde saíram por último (fevereiro, depois janeiro).
    await pdv.returnItems(venda.id, [{ line: 1, quantityMilli: 2000 }], 'cash', 'Cliente desistiu');
    // A segunda venda é cancelada: a unidade volta ao lote de fevereiro.
    await pdv.cancelSale(outra.id, 'Erro no caixa', null);
    expect((await sync.sync()).lastError).toBeNull();
    expect(await lotes()).toEqual({ 'L-JAN': 1000, 'L-FEV': 5000, 'L-VELHO': 2000 });

    // Recall: quem levou o lote de janeiro (líquido: 3 − 1 devolvido = 2).
    const lista = (await admin.get(`/stock/lots?productId=${iogurte.id}`)).json() as {
      id: string;
      lotCode: string;
    }[];
    const jan = lista.find((l) => l.lotCode === 'L-JAN')!;
    const recall = (await admin.get(`/stock/lots/${jan.id}/sales`)).json();
    expect(recall).toEqual([expect.objectContaining({ saleId: venda.id, quantityMilli: 2000 })]);

    // Vencendo em até 30 dias (inclui o vencido), e o descarte vai para a auditoria.
    const vencendo = (await admin.get('/stock/lots?days=30')).json();
    expect(vencendo.map((l: { lotCode: string }) => l.lotCode)).toEqual(['L-VELHO']);
    expect(vencendo[0].daysLeft).toBeLessThan(0);
    const antes = await saldo();
    const descarte = await admin.post(`/stock/lots/${vencendo[0].id}/discard`, {
      quantityMilli: 2000,
      reason: 'Vencido',
    });
    expect(descarte.json().quantityMilli).toBe(0);
    expect(await saldo()).toBe(antes - 2000);
    expect(
      (
        await admin.post(`/stock/lots/${vencendo[0].id}/discard`, {
          quantityMilli: 1000,
          reason: 'x',
        })
      ).statusCode,
    ).toBe(400);
    const trilha = JSON.stringify((await admin.get('/audit?action=stock.lot_discarded')).json());
    expect(trilha).toContain('Vencido');
  });
});
