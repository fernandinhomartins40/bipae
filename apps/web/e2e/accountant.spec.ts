import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * F4-14.a: o pacote do mês para o contador sai da retaguarda como ZIP. O conteúdo (XML das
 * notas, cancelamentos, inutilizações e resumo) é testado na API contra a SEFAZ simulada.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('baixa o pacote do mês para o contador', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Célia Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`celia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Célia!' })).toBeVisible();

  await abrirNoMenu(page, 'Arquivos para o contador');
  await expect(page.getByRole('heading', { name: 'Arquivos para o contador' })).toBeVisible();
  await page.getByLabel('Mês').fill('2026-09');
  const [arquivo] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Baixar pacote do mês' }).click(),
  ]);
  expect(arquivo.suggestedFilename()).toBe('bipae-contador-2026-09.zip');
  const zip = readFileSync((await arquivo.path())!);
  // Assinatura do ZIP e o resumo dentro.
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.toString('latin1')).toContain('resumo.csv');
});
