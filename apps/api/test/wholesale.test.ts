import type { SyncPullResult } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LabelsService } from '../src/modules/catalog/labels.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-03: atacarejo (preço de atacado a partir de uma quantidade). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('atacarejo (F5-03)', () => {
  it('cadastra o preço de atacado, audita, manda ao caixa e põe na etiqueta', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const terminal = api(t.app, { ...dono.auth, 'x-bipae-terminal': terminalId });

    const base = { name: 'Leite integral 1L', priceCents: 549 };
    const ruim = async (wholesale: unknown, extra: object = {}) =>
      (await admin.post('/products', { ...base, wholesale, ...extra })).json().message;
    expect(await ruim({ minQuantityMilli: 12_000, priceCents: 549 })).toBe(
      'O preço de atacado precisa ser menor que o preço de venda.',
    );
    expect(await ruim({ minQuantityMilli: 12_500, priceCents: 489 })).toBe(
      'A quantidade do atacado precisa ser inteira para produto vendido por unidade.',
    );
    expect(await ruim({ minQuantityMilli: 1000, priceCents: 489 })).toContain(
      'O atacado começa em pelo menos 2 unidades',
    );

    const leite = (
      await admin.post('/products', {
        ...base,
        wholesale: { minQuantityMilli: 12_000, priceCents: 489 },
      })
    ).json();
    expect(leite.wholesale).toEqual({ minQuantityMilli: 12_000, priceCents: 489 });

    const retrato = (await terminal.get('/sync/pull?limit=50')).json() as SyncPullResult;
    expect(retrato.pricing!.promotions).toEqual([
      {
        id: leite.id,
        name: 'Atacado: Leite integral 1L',
        startsOn: '2000-01-01',
        endsOn: null,
        rule: {
          kind: 'quantity_tier',
          productIds: [leite.id],
          tiers: [{ minQuantityMilli: 12_000, unitPriceCents: 489 }],
        },
      },
    ]);

    // Mudar o atacado é mudança de preço: entra na auditoria e muda o retrato do caixa.
    await admin.put(`/products/${leite.id}`, {
      ...leite,
      wholesale: { minQuantityMilli: 6000, priceCents: 499 },
    });
    const [registro] = (await admin.get('/audit?action=product.price_changed')).json().items;
    expect(registro.data).toMatchObject({
      wholesaleBefore: { minQuantityMilli: 12_000, priceCents: 489 },
      wholesaleAfter: { minQuantityMilli: 6000, priceCents: 499 },
    });
    const depois = (
      await terminal.get(`/sync/pull?limit=50&pricingVersion=${retrato.pricing!.version}`)
    ).json() as SyncPullResult;
    expect(depois.pricing!.promotions![0]!.rule).toMatchObject({
      tiers: [{ minQuantityMilli: 6000, unitPriceCents: 499 }],
    });

    const [etiqueta] = await t.app.get(LabelsService).build(
      {
        tenantId: dono.me.tenant.id,
        userId: dono.me.user.id,
        permissions: dono.me.permissions,
        storeIds: null,
      } as never,
      { kind: 'shelf', items: [{ productId: leite.id, copies: 1 }] },
    );
    expect(etiqueta!.details.join(' | ')).toMatch(/Atacado: a partir de 6 UN, R\$\s4,99 cada/);

    // Tirar o atacado tira do caixa.
    await admin.put(`/products/${leite.id}`, { ...leite, wholesale: null });
    const sem = (
      await terminal.get(`/sync/pull?limit=50&pricingVersion=${depois.pricing!.version}`)
    ).json() as SyncPullResult;
    expect(sem.pricing!.promotions).toEqual([]);
  });
});
