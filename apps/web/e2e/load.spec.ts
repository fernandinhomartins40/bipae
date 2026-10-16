import { expect, test } from '@playwright/test';

/**
 * F7-01: teste de carga no navegador, com o banco do PDV web (SQLite WebAssembly no worker) e
 * 100 mil produtos. Metas: busca em menos de 100 ms e venda em menos de 1 s (p95).
 */
test.skip(
  () => test.info().project.name !== 'web',
  'O banco do navegador é o mesmo nas duas cascas.',
);

test('100 mil produtos no navegador: busca e venda dentro das metas', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/carga.html?n=100000');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __carga?: unknown }).__carga), {
      timeout: 540_000,
      intervals: [1000],
    })
    .toBeTruthy();
  const r = (await page.evaluate(() => (window as unknown as { __carga: unknown }).__carga)) as {
    error?: string;
    products: number;
    loadSeconds: number;
    codeP95: number;
    searchP95: number;
    saleP95: number;
  };
  console.log(`F7-01 navegador: ${JSON.stringify(r)}`);
  expect(r.error).toBeUndefined();
  expect(r.products).toBe(100_000);
  expect(r.codeP95).toBeLessThan(100);
  expect(r.searchP95).toBeLessThan(100);
  expect(r.saleP95).toBeLessThan(1000);
  // A primeira carga do catálogo inteiro (primeira sincronização do caixa) não pode voltar a levar minutos.
  expect(r.loadSeconds).toBeLessThan(120);
});
