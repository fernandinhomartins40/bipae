import type { SyncPullResult } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-02.b: cadastro de promoções e envio ao caixa no retrato de preços. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('promoções (F5-02.b)', () => {
  it('cadastra com auditoria, valida a regra e manda as ativas para o caixa', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const terminal = api(t.app, { ...dono.auth, 'x-bipae-terminal': terminalId });
    const suco = (await admin.post('/products', { name: 'Suco uva', priceCents: 899 })).json();
    const banana = (
      await admin.post('/products', {
        name: 'Banana',
        priceCents: 699,
        unit: 'KG',
        isWeighable: true,
      })
    ).json();

    const retrato = async (version?: string) =>
      (
        await terminal.get(`/sync/pull?limit=50${version ? `&pricingVersion=${version}` : ''}`)
      ).json() as SyncPullResult;
    const antes = (await retrato()).pricing!;
    expect(antes.promotions).toEqual([]);

    const leve3 = await admin.post('/promotions', {
      name: 'Leve 3 pague 2 nos sucos',
      startsOn: '2026-10-01',
      rule: { kind: 'buy_x_pay_y', productIds: [suco.id], buy: 3, pay: 2 },
    });
    expect(leve3.statusCode).toBe(201);
    expect(leve3.json()).toMatchObject({ active: true, endsOn: null });

    // Regras inválidas, com mensagem para a pessoa.
    const ruim = async (rule: unknown, extra: object = {}) =>
      (
        await admin.post('/promotions', {
          name: 'Ruim',
          startsOn: '2026-10-01',
          rule,
          ...extra,
        })
      ).json().message;
    expect(await ruim({ kind: 'buy_x_pay_y', productIds: [suco.id], buy: 3, pay: 3 })).toContain(
      'Quem leva precisa pagar menos do que leva',
    );
    expect(
      await ruim({
        kind: 'combo',
        items: [{ productId: suco.id, quantityMilli: 1000 }],
        priceCents: 100,
      }),
    ).toContain('O combo precisa de pelo menos dois produtos');
    expect(
      await ruim(
        { kind: 'buy_x_pay_y', productIds: [suco.id], buy: 3, pay: 2 },
        { endsOn: '2026-09-01' },
      ),
    ).toContain('O fim precisa ser depois do início');
    expect(await ruim({ kind: 'buy_x_pay_y', productIds: [banana.id], buy: 3, pay: 2 })).toBe(
      'Banana é vendido por peso: só entra em promoção por faixa de quantidade.',
    );
    expect(
      (
        await admin.post('/promotions', {
          name: 'Faixa da banana',
          startsOn: '2026-10-01',
          rule: {
            kind: 'quantity_tier',
            productIds: [banana.id],
            tiers: [{ minQuantityMilli: 2000, unitPriceCents: 599 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    // O caixa recebe as duas, e a versão muda.
    const depois = (await retrato(antes.version)).pricing!;
    expect(depois.version).not.toBe(antes.version);
    expect(depois.promotions!.map((p) => p.name).sort()).toEqual([
      'Faixa da banana',
      'Leve 3 pague 2 nos sucos',
    ]);
    // Sem mudança, o caixa não recebe o retrato de novo.
    expect((await retrato(depois.version)).pricing).toBeUndefined();

    // Desligar tira do caixa e fica na auditoria.
    const desligada = await admin.put(`/promotions/${leve3.json().id}`, {
      name: 'Leve 3 pague 2 nos sucos',
      startsOn: '2026-10-01',
      active: false,
      rule: { kind: 'buy_x_pay_y', productIds: [suco.id], buy: 3, pay: 2 },
    });
    expect(desligada.json().active).toBe(false);
    const ultimo = (await retrato(depois.version)).pricing!;
    expect(ultimo.promotions!.map((p) => p.name)).toEqual(['Faixa da banana']);
    const trilha = JSON.stringify((await admin.get('/audit?action=promotion.updated')).json());
    expect(trilha).toContain('"active":false');
    const lista = (await admin.get('/promotions')).json();
    expect(lista).toHaveLength(2);
    expect(lista.find((p: { name: string }) => p.name === 'Faixa da banana').products).toEqual([
      { id: banana.id, name: 'Banana' },
    ]);
    expect(leve3.json().products).toEqual([{ id: suco.id, name: 'Suco uva' }]);
  });
});
