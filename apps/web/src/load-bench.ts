import { createStorage, migrateLocal } from '@bipae/local-db';
import { openWasmDatabase } from '@bipae/local-db/wasm';
import { addItem, EMPTY_CART, PdvService, type Cart } from '@bipae/pdv-core';

/**
 * F7-01: teste de carga do caixa no navegador, com o mesmo banco do PDV web (SQLite em
 * WebAssembly, no worker). Página só do servidor de desenvolvimento (carga.html), usada pelo
 * teste E2E. Quantidade de produtos em ?n= (padrão 100 mil).
 */

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
const code = (i: number) => `789${String(i).padStart(10, '0')}`;

async function run() {
  const total = Number(new URLSearchParams(location.search).get('n') ?? 100_000);
  const storage = createStorage(await openWasmDatabase(`carga-${Date.now()}`));
  await migrateLocal(storage);
  const pdv = new PdvService(storage, {
    terminalId: crypto.randomUUID(),
    operatorId: crypto.randomUUID(),
  });
  const now = new Date().toISOString();

  const loadStart = performance.now();
  for (let start = 0; start < total; start += 5000) {
    const batch: Parameters<PdvService['applyCatalog']>[0] = [];
    for (let i = start; i < Math.min(total, start + 5000); i++) {
      batch.push({
        id: crypto.randomUUID(),
        name: `${WORDS[i % 10]} ${BRANDS[Math.floor(i / 10) % 10]} ${SIZES[Math.floor(i / 100) % 10]} ${i}`,
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
  const loadMs = performance.now() - loadStart;
  await pdv.openSession(0);

  const byCode: number[] = [];
  for (let k = 0; k < 100; k++) {
    const t = performance.now();
    await pdv.findByCode(code((k * 7919) % total));
    byCode.push(performance.now() - t);
  }
  const terms = [
    'arroz',
    'cafe bom',
    'leite 1 l',
    'sabao ouro',
    'oleo serra 500',
    'xyz inexistente',
  ];
  const byName: number[] = [];
  for (let round = 0; round < 5; round++) {
    for (const term of terms) {
      const t = performance.now();
      await pdv.search(term);
      byName.push(performance.now() - t);
    }
  }
  const sales: number[] = [];
  for (let k = 0; k < 20; k++) {
    const t = performance.now();
    let cart: Cart = EMPTY_CART;
    for (let j = 0; j < 20; j++) {
      cart = addItem(cart, (await pdv.findByCode(code((k * 1009 + j * 4993) % total)))!, 1000);
    }
    const sum = cart.lines.reduce((s, l) => s + l.unitPriceCents, 0);
    await pdv.completeSale(cart, [{ method: 'cash', receivedCents: sum }], {
      discountLimitPercent: 10,
    });
    sales.push(performance.now() - t);
  }
  const result = {
    products: await pdv.catalogSize(),
    loadSeconds: Math.round(loadMs / 100) / 10,
    codeP95: Math.round(p95(byCode) * 10) / 10,
    searchP95: Math.round(p95(byName) * 10) / 10,
    saleP95: Math.round(p95(sales) * 10) / 10,
  };
  (window as unknown as { __carga: unknown }).__carga = result;
  document.getElementById('resultado')!.textContent = JSON.stringify(result, null, 2);
}

run().catch((error: Error) => {
  (window as unknown as { __carga: unknown }).__carga = { error: error.message };
  document.getElementById('resultado')!.textContent = `Erro: ${error.message}`;
});
