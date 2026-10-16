import { uuidv7 } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { addItem, discountNeedsAuthorization, EMPTY_CART, setSaleDiscount, totals } from './cart';
import { PdvService } from './service';

/** F6-08.b: pontos de fidelidade usados como desconto no caixa, sem internet. */

const CPF = '52998224725';
const program = {
  active: true,
  centsPerPoint: 100,
  pointValueCents: 5,
  expiryMonths: 6,
  minRedeemPoints: 100,
};

let pdv: PdvService;
let storage: ReturnType<typeof createStorage>;

beforeEach(async () => {
  storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  pdv = new PdvService(storage, { terminalId: uuidv7(), operatorId: uuidv7() });
});

const pricing = (points: number, active = true) => ({
  version: 'v1',
  storePriceTableId: null,
  tables: [],
  customers: [],
  loyalty: { program: { ...program, active }, balances: [{ taxId: CPF, points }] },
});

describe('fidelidade no caixa (F6-08.b)', () => {
  const item = { id: uuidv7(), name: 'Vinho', unit: 'UN', priceCents: 4000, isWeighable: false };

  it('o desconto dos pontos entra no rateio e não conta no limite do operador', () => {
    const cart = {
      ...addItem(EMPTY_CART, item, 2000),
      loyalty: { points: 400, discountCents: 2000 },
    };
    const t = totals(cart);
    expect(t).toMatchObject({ loyaltyDiscountCents: 2000, discountCents: 2000, totalCents: 6000 });
    expect(t.items[0]!.discountCents).toBe(2000);
    // R$ 20,00 de pontos numa venda de R$ 80,00 (25%) não pede gerente; desconto manual pede.
    expect(discountNeedsAuthorization(cart, 10)).toBe(false);
    expect(discountNeedsAuthorization(setSaleDiscount(cart, 2000), 10)).toBe(true);
    // Pontos nunca deixam o total negativo.
    expect(totals({ ...cart, loyalty: { points: 2000, discountCents: 10_000 } }).totalCents).toBe(
      0,
    );
  });

  it('usa o saldo do retrato menos o que o caixa já usou, e manda os pontos no evento', async () => {
    await pdv.applyCatalog([
      {
        id: item.id,
        name: item.name,
        sku: null,
        unit: 'UN',
        priceCents: 4000,
        isWeighable: false,
        active: true,
        ncm: null,
        cest: null,
        fiscalProfileId: null,
        parentId: null,
        barcodes: ['7891000100103'],
        updatedAt: new Date().toISOString(),
      },
    ]);
    await pdv.applyPricing(pricing(500));
    await pdv.openSession(0);
    const vinho = (await pdv.findByCode('7891000100103'))!;
    expect(await pdv.loyaltyFor(CPF)).toEqual({ program, points: 500 });
    expect((await pdv.loyaltyFor('11144477735')).points).toBe(0);

    const options = { discountLimitPercent: 10 };
    const cart = {
      ...addItem(EMPTY_CART, vinho, 1000),
      customerTaxId: CPF,
      loyalty: { points: 300, discountCents: 1500 },
    };
    const venda = await pdv.completeSale(cart, [{ method: 'pix', receivedCents: 2500 }], options);
    expect(venda.totalCents).toBe(2500);
    const [evento] = await storage.query<{ payload: string }>(
      "SELECT payload FROM outbox WHERE type = 'sale.completed'",
    );
    expect(JSON.parse(evento!.payload).payload.loyalty).toEqual({
      points: 300,
      discountCents: 1500,
    });
    // Sem internet, o caixa desconta o que já usou.
    expect((await pdv.loyaltyFor(CPF)).points).toBe(200);

    // Mais pontos do que tem, abaixo do mínimo, sem CPF ou com a conta errada: recusado.
    await expect(
      pdv.completeSale(
        { ...cart, loyalty: { points: 300, discountCents: 1500 } },
        [{ method: 'pix', receivedCents: 2500 }],
        options,
      ),
    ).rejects.toThrow('só 200 pontos');
    await expect(
      pdv.completeSale(
        { ...cart, loyalty: { points: 50, discountCents: 250 } },
        [{ method: 'pix', receivedCents: 3750 }],
        options,
      ),
    ).rejects.toThrow('mínimo para usar é de 100 pontos');
    await expect(
      pdv.completeSale(
        { ...cart, customerTaxId: null, loyalty: { points: 100, discountCents: 500 } },
        [{ method: 'pix', receivedCents: 3500 }],
        options,
      ),
    ).rejects.toThrow('informe o CPF');
    await expect(
      pdv.completeSale(
        { ...cart, loyalty: { points: 100, discountCents: 900 } },
        [{ method: 'pix', receivedCents: 3100 }],
        options,
      ),
    ).rejects.toThrow('não confere');

    // Programa desligado: nada de pontos.
    await pdv.applyPricing(pricing(500, false));
    expect((await pdv.loyaltyFor(CPF)).points).toBe(0);
    await expect(
      pdv.completeSale(
        { ...cart, loyalty: { points: 100, discountCents: 500 } },
        [{ method: 'pix', receivedCents: 3500 }],
        options,
      ),
    ).rejects.toThrow('desligado');
  });
});
