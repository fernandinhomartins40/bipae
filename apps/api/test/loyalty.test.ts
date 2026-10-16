import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-08.b: fidelidade — pontos nas vendas com CPF e resgate no caixa. */

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

const CPF = '12345678909';

describe('fidelidade (F6-08.b)', () => {
  it('ganha nas compras, usa no caixa, e cancelamento e devolução acertam o saldo', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Vinho Tinto',
      priceCents: 10_000,
      barcodes: ['7891000100103'],
    });
    const cliente = (await admin.post('/customers', { name: 'Ana Lima', taxId: CPF })).json();

    expect((await admin.get('/loyalty/program')).json()).toEqual({ program: null });
    // 1 ponto a cada R$ 1,00; cada ponto vale R$ 0,05; mínimo de 100 pontos; vence em 6 meses.
    const programa = {
      active: true,
      centsPerPoint: 100,
      pointValueCents: 5,
      expiryMonths: 6,
      minRedeemPoints: 100,
    };
    expect((await admin.put('/loyalty/program', programa)).json()).toEqual(programa);
    expect(
      (await admin.put('/loyalty/program', { ...programa, centsPerPoint: 0 })).statusCode,
    ).toBe(400);

    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const vinho = (await pdv.findByCode('7891000100103'))!;
    const options = { discountLimitPercent: 10 };

    // Duas garrafas com CPF: R$ 200,00 = 200 pontos.
    const primeira = await pdv.completeSale(
      { ...addItem(EMPTY_CART, vinho, 2000), customerTaxId: CPF },
      [{ method: 'pix', receivedCents: 20_000 }],
      options,
    );
    await sync.sync();
    await sync.sync();
    expect((await admin.get(`/loyalty/customers/${cliente.id}`)).json()).toMatchObject({
      hasTaxId: true,
      points: 200,
      valueCents: 1000,
    });
    // O caixa recebeu o saldo no retrato.
    expect(await pdv.loyaltyFor(CPF)).toMatchObject({ points: 200 });

    // Usa 150 pontos (R$ 7,50) numa garrafa: paga R$ 92,50 e ganha 92 pontos.
    const comPontos = await pdv.completeSale(
      {
        ...addItem(EMPTY_CART, vinho, 1000),
        customerTaxId: CPF,
        loyalty: { points: 150, discountCents: 750 },
      },
      [{ method: 'pix', receivedCents: 9250 }],
      options,
    );
    expect(comPontos.totalCents).toBe(9250);
    await sync.sync();
    await sync.sync();
    const extrato = (await admin.get(`/loyalty/customers/${cliente.id}`)).json();
    expect(extrato.points).toBe(200 - 150 + 92);
    expect(
      extrato.entries.map((e: { kind: string; points: number }) => [e.kind, e.points]),
    ).toEqual([
      ['earn', 92],
      ['redeem', -150],
      ['earn', 200],
    ]);

    // Cancelar a venda com pontos: devolve os 150 e tira os 92.
    await pdv.cancelSale(comPontos.id, 'Cliente desistiu da compra', dono.me.user.id);
    await sync.sync();
    expect((await admin.get(`/loyalty/customers/${cliente.id}`)).json().points).toBe(200);

    // Devolver uma das duas garrafas da primeira venda: tira 100 pontos.
    await pdv.returnItems(
      primeira.id,
      [{ line: 1, quantityMilli: 1000 }],
      'cash',
      'Garrafa quebrada',
    );
    await sync.sync();
    expect((await admin.get(`/loyalty/customers/${cliente.id}`)).json().points).toBe(100);

    // O programa mudado fica na auditoria.
    const auditoria = JSON.stringify(
      (await admin.get('/audit?action=loyalty.program_saved')).json(),
    );
    expect(auditoria).toContain('loyalty.program_saved');
  });

  it('dois caixas sem internet usando os mesmos pontos: a venda passa e a diferença vai para a auditoria', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Queijo',
      priceCents: 20_000,
      barcodes: ['7891000100103'],
    });
    await admin.post('/customers', { name: 'Ana Lima', taxId: CPF });
    await admin.put('/loyalty/program', {
      active: true,
      centsPerPoint: 100,
      pointValueCents: 5,
      expiryMonths: 6,
      minRedeemPoints: 100,
    });
    const abrir = async (nome: string) => {
      const caixa = (
        await admin.post('/terminals', { storeId: loja.id, name: nome, platform: 'web' })
      ).json();
      const storage = createStorage(nodeSqliteDriver());
      await migrateLocal(storage);
      const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
      const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
      await sync.sync();
      await pdv.openSession(0);
      return { pdv, sync };
    };
    const a = await abrir('Caixa A');
    const queijo = (await a.pdv.findByCode('7891000100103'))!;
    await a.pdv.completeSale(
      { ...addItem(EMPTY_CART, queijo, 1000), customerTaxId: CPF },
      [{ method: 'pix', receivedCents: 20_000 }],
      { discountLimitPercent: 10 },
    );
    await a.sync.sync();
    const b = await abrir('Caixa B');
    await a.sync.sync();
    // Os dois caixas acham que a cliente tem 200 pontos e usam os 200, cada um sem internet.
    for (const c of [a, b]) {
      expect((await c.pdv.loyaltyFor(CPF)).points).toBe(200);
      await c.pdv.completeSale(
        {
          ...addItem(EMPTY_CART, queijo, 1000),
          customerTaxId: CPF,
          loyalty: { points: 200, discountCents: 1000 },
        },
        [{ method: 'pix', receivedCents: 19_000 }],
        { discountLimitPercent: 10 },
      );
    }
    expect((await a.sync.sync()).lastError).toBeNull();
    expect((await b.sync.sync()).lastError).toBeNull();
    const vendas = (await admin.get('/sales')).json();
    expect(vendas.items ?? vendas).toHaveLength(3);
    const auditoria = JSON.stringify((await admin.get('/audit?action=loyalty.overdrawn')).json());
    expect(auditoria).toContain('"usedPoints":200');
  });
});
