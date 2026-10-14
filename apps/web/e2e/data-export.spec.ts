import { expect, test } from '@playwright/test';

/** P-03: o dono baixa os dados da conta (LGPD) em Minha assinatura. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('baixar meus dados num ZIP', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Nina Dona');
  await page.getByLabel('Nome do negócio').fill(`Empório ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`nina-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Nina!' })).toBeVisible();

  await page.getByRole('link', { name: 'Minha assinatura' }).click();
  await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar meus dados (ZIP)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^bipae-dados-\d{4}-\d{2}-\d{2}\.zip$/);
  const bytes = await (await file.createReadStream())?.toArray();
  expect(Buffer.concat(bytes ?? []).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
});
