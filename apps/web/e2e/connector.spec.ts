import { expect, test } from '@playwright/test';

/**
 * Adendo 01 §8: the web register uses peripherals through the Bipaê Conector, here the
 * simulator (real protocol and WebSocket, simulated printer, drawer and scale).
 */
test.skip(() => test.info().project.name !== 'web', 'O Conector atende o caixa do navegador.');

const state = async () => (await fetch('http://127.0.0.1:47811/state')).json() as Promise<{
  prints: number;
  drawerOpenings: number;
}>;

test('pair with the Conector, print, read the scale and open the drawer after a cash sale', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rafael');
  await page.getByLabel('Nome do negócio').fill('Mercadinho');
  await page.getByLabel('E-mail').fill(`conector-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();

  // Before pairing, the home screen explains how to get the drawer working.
  await expect(page.getByText('Para usar a gaveta de dinheiro no navegador, instale o Bipaê Conector')).toBeVisible();

  await page.getByRole('link', { name: 'Periféricos' }).click();
  await page.getByLabel('Código mostrado no Bipaê Conector').fill('000000');
  await page.getByRole('button', { name: 'Parear este navegador' }).click();
  await expect(page.getByText('Código incorreto')).toBeVisible();
  await page.getByLabel('Código mostrado no Bipaê Conector').fill('123456');
  await page.getByRole('button', { name: 'Parear este navegador' }).click();
  await expect(page.getByText('Pareado!')).toBeVisible();

  const before = await state();
  await page.getByRole('button', { name: 'Imprimir teste' }).click();
  await expect(page.getByText('Página de teste enviada para a impressora.')).toBeVisible();
  await page.getByRole('button', { name: 'Ler balança' }).click();
  await expect(page.getByText('Peso lido: 1,250 kg')).toBeVisible();
  expect((await state()).prints).toBe(before.prints + 1);

  // A cash sale on the register opens the drawer through the Conector.
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Pão de queijo');
  await page.getByLabel('Preço de venda').fill('5,00');
  await page.getByLabel('Código de barras').fill('78912342');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill('78912342');
  await input.press('Enter');
  await page.keyboard.press('F10');
  await page.getByRole('button', { name: 'R$ 5,00' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  await expect.poll(async () => (await state()).drawerOpenings).toBe(before.drawerOpenings + 1);

  // And the receipt goes to the thermal printer as ESC/POS.
  await page.getByRole('button', { name: /Imprimir comprovante da venda nº 1/ }).click();
  await expect.poll(async () => (await state()).prints).toBe(before.prints + 2);
});
