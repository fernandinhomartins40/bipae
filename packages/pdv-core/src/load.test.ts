import { uuidv7, type SyncPullResult } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { addItem, EMPTY_CART, type Cart } from './cart';
import { PdvService } from './service';

/**
 * F7-01: teste de carga do caixa com 100 mil produtos no banco local. Metas do PRD: busca em
 * menos de 100 ms e venda em menos de 1 s, medidas no percentil 95.
 */

const TOTAL = 100_000;
const WORDS = [
  'Arroz',
  'Feijão',
  'Café',
  'Açúcar',
  'Leite',
  'Óleo',
  'Macarrão',
  'Biscoito',
  'Sabão',
  'Detergente',
  'Refrigerante',
  'Suco',
  'Cerveja',
  'Água',
  'Queijo',
  'Presunto',
  'Iogurte',
  'Manteiga',
  'Farinha',
  'Molho',
];
const BRANDS = [
  'Bom Dia',
  'Sol',
  'Primavera',
  'Ouro',
  'Real',
  'Tropical',
  'Serra',
  'Vale',
  'Mar',
  'Campo',
];
const SIZES = [
  '200 g',
  '500 g',
  '1 kg',
  '2 kg',
  '350 ml',
  '1 L',
  '2 L',
  '5 kg',
  'caixa com 12',
  'pacote',
];

const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
};
const time = async (fn: () => Promise<unknown>) => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};
const code = (i: number) => `789${String(i).padStart(10, '0')}`;

let pdv: PdvService;

beforeAll(async () => {
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  pdv = new PdvService(storage, { terminalId: uuidv7(), operatorId: uuidv7() });
  const now = new Date().toISOString();
  for (let start = 0; start < TOTAL; start += 10_000) {
    const batch: SyncPullResult['products'] = [];
    for (let i = start; i < start + 10_000; i++) {
      batch.push({
        id: uuidv7(),
        name: `${WORDS[i % 20]} ${BRANDS[Math.floor(i / 20) % 10]} ${SIZES[Math.floor(i / 200) % 10]} ${i}`,
        sku: `SKU${i}`,
        unit: 'UN',
        priceCents: 100 + (i % 5000),
        isWeighable: false,
        active: true,
        ncm: '19053100',
        cest: null,
        fiscalProfileId: null,
        parentId: null,
        barcodes: [code(i)],
        updatedAt: now,
      });
    }
    await pdv.applyCatalog(batch);
  }
  await pdv.openSession(0);
}, 300_000);

describe('carga do caixa com 100 mil produtos (F7-01)', () => {
  it('tem os 100 mil produtos', async () => {
    expect(await pdv.catalogSize()).toBe(TOTAL);
  });

  it('código de barras e busca por nome em menos de 100 ms (p95)', async () => {
    const byCode: number[] = [];
    for (let k = 0; k < 200; k++) {
      const i = (k * 7919) % TOTAL;
      byCode.push(await time(async () => expect(await pdv.findByCode(code(i))).not.toBeNull()));
    }
    const terms = [
      'arroz',
      'cafe bom',
      'leite 1 l',
      'sabao ouro',
      'refri',
      'queijo serra 500',
      'agua mar',
      'feijao campo 1 kg',
      'molho',
      'cerveja tropical 350',
      'biscoito 99999',
      'xyz inexistente',
    ];
    const byName: number[] = [];
    for (let round = 0; round < 10; round++) {
      for (const term of terms) byName.push(await time(() => pdv.search(term)));
    }
    console.log(
      `F7-01 · código p95 ${p95(byCode).toFixed(1)} ms · nome p95 ${p95(byName).toFixed(1)} ms`,
    );
    expect(p95(byCode)).toBeLessThan(100);
    expect(p95(byName)).toBeLessThan(100);
  });

  it('venda de 20 itens em menos de 1 s (p95)', async () => {
    const sales: number[] = [];
    for (let k = 0; k < 30; k++) {
      sales.push(
        await time(async () => {
          let cart: Cart = EMPTY_CART;
          for (let j = 0; j < 20; j++) {
            const product = (await pdv.findByCode(code((k * 1009 + j * 4993) % TOTAL)))!;
            cart = addItem(cart, product, 1000);
          }
          const total = cart.lines.reduce((s, l) => s + l.unitPriceCents, 0);
          await pdv.completeSale(cart, [{ method: 'cash', receivedCents: total }], {
            discountLimitPercent: 10,
          });
        }),
      );
    }
    console.log(`F7-01 · venda de 20 itens p95 ${p95(sales).toFixed(1)} ms`);
    expect(p95(sales)).toBeLessThan(1000);
  });
});
