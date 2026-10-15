import { uuidv7, type PricingSnapshot } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import type { Promotion } from '@bipae/promotions';
import { describe, expect, it } from 'vitest';
import {
  addItem,
  discountNeedsAuthorization,
  EMPTY_CART,
  setLineDiscount,
  setSaleDiscount,
  totals,
} from './cart';
import { localDay, withPromotions } from './promotions';
import { PdvService } from './service';

const suco = { id: uuidv7(), name: 'Suco uva', unit: 'UN', priceCents: 900, isWeighable: false };
const leve3: Promotion = {
  id: uuidv7(),
  name: 'Leve 3 pague 2',
  startsOn: '2026-01-01',
  endsOn: null,
  rule: { kind: 'buy_x_pay_y', productIds: [suco.id], buy: 3, pay: 2 },
};

describe('carrinho com promoção (F5-02.c)', () => {
  it('o desconto da promoção entra no item e no total, fora do limite do operador', () => {
    const cart = withPromotions(addItem(EMPTY_CART, suco, 3000), [leve3], '2026-10-15');
    expect(cart.appliedPromotions).toEqual([
      { promotionId: leve3.id, name: 'Leve 3 pague 2', discountCents: 900 },
    ]);
    const t = totals(cart);
    expect(t).toMatchObject({
      subtotalCents: 2700,
      promotionDiscountCents: 900,
      itemDiscountCents: 900,
      totalCents: 1800,
    });
    expect(t.items[0]).toMatchObject({ discountCents: 900, totalCents: 1800 });
    // 33% de desconto, mas é promoção: não pede gerente com limite de 10%.
    expect(discountNeedsAuthorization(cart, 10)).toBe(false);
  });

  it('item com desconto do operador fica fora; sem promoção, os campos somem', () => {
    const manual = setLineDiscount(addItem(EMPTY_CART, suco, 3000), 1, 100);
    const cart = withPromotions(manual, [leve3], '2026-10-15');
    expect(cart.appliedPromotions).toEqual([]);
    expect(totals(cart).totalCents).toBe(2600);
    const limpo = withPromotions(cart, [], '2026-10-15');
    expect(limpo.promotionDiscounts).toBeUndefined();
    expect(limpo.appliedPromotions).toBeUndefined();
  });

  it('desconto na venda dado antes da promoção nunca deixa o total negativo', () => {
    const base = setSaleDiscount(addItem(EMPTY_CART, suco, 3000), 2500);
    const cart = withPromotions(base, [leve3], '2026-10-15');
    const t = totals(cart);
    expect(t.totalCents).toBe(0);
    expect(t.saleDiscountCents).toBe(1800);
    expect(t.items[0]!.totalCents).toBe(0);
  });
});

describe('caixa sem internet aplica a promoção do retrato (F5-02.c)', () => {
  it('guarda as promoções e a venda leva o desconto e a lista no evento', async () => {
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, {
      terminalId: uuidv7(),
      operatorId: uuidv7(),
      now: () => new Date(2026, 9, 15, 10),
    });
    expect(await pdv.promotions()).toEqual([]);
    const pricing: PricingSnapshot = {
      version: 'v1',
      storePriceTableId: null,
      tables: [],
      customers: [],
      promotions: [leve3],
    };
    await pdv.applyPricing(pricing);
    expect(await pdv.promotions()).toEqual([leve3]);

    const cart = addItem(EMPTY_CART, suco, 3000);
    expect(totals(await pdv.priceWithPromotions(cart)).totalCents).toBe(1800);

    await pdv.openSession(0);
    // A tela mandou o carrinho sem a promoção: a venda refaz a conta com as do caixa.
    const sale = await pdv.completeSale(cart, [{ method: 'cash', receivedCents: 2000 }], {
      discountLimitPercent: 10,
    });
    expect(sale).toMatchObject({ totalCents: 1800, discountCents: 900 });
    const event = (await pdv.pendingEvents()).find((e) => e.type === 'sale.completed')!;
    expect(event.payload).toMatchObject({
      totalCents: 1800,
      promotions: [{ promotionId: leve3.id, discountCents: 900 }],
    });

    // Sem promoção no retrato, a venda não leva o campo.
    await pdv.applyPricing({ ...pricing, version: 'v2', promotions: undefined });
    await pdv.completeSale(
      addItem(EMPTY_CART, suco, 1000),
      [{ method: 'cash', receivedCents: 900 }],
      { discountLimitPercent: 10 },
    );
    const ultimo = (await pdv.pendingEvents()).filter((e) => e.type === 'sale.completed').at(-1)!;
    expect(ultimo.payload).not.toHaveProperty('promotions');
  });
});

describe('dia do caixa', () => {
  it('usa o relógio local, com zero à esquerda', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
