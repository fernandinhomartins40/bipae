import { expect, test } from '@playwright/test';

/** F4-04: lançar uma conta parcelada e dar baixa. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('conta a pagar em 3 parcelas, baixa da primeira e resumo atualizado', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Leo Dono');
  await page.getByLabel('Nome do negócio').fill(`Padaria ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`leo-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Leo!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Forno novo');
  await page.getByLabel('Valor total').fill('300,00');
  await page.getByLabel('Valor total').blur();
  await page.getByLabel('Primeiro vencimento').fill('2099-03-10');
  await page.getByLabel('Parcelas').fill('3');
  await page.getByRole('button', { name: 'Lançar conta' }).click();

  await expect(page.getByRole('row', { name: /Forno novo \(1\/3\)/ })).toContainText('10/03/2099');
  await expect(page.getByRole('row', { name: /Forno novo \(3\/3\)/ })).toContainText('10/05/2099');
  await expect(page.getByTestId('open-payable')).toHaveText('R$ 300,00');

  await page.getByRole('row', { name: /Forno novo \(1\/3\)/ }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByTestId('open-payable')).toHaveText('R$ 200,00');
  await expect(page.getByRole('row', { name: /Forno novo \(1\/3\)/ })).toHaveCount(0);
});

test('fluxo de caixa mostra a conta paga hoje (F4-05)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Ana Dona');
  await page.getByLabel('Nome do negócio').fill(`Quitanda ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`ana-fluxo-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await page.getByRole('link', { name: 'Contas a pagar e receber' }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByLabel('Descrição').fill('Energia');
  await page.getByLabel('Valor total').fill('150,00');
  await page.getByLabel('Valor total').blur();
  await page.getByRole('button', { name: 'Lançar conta' }).click();
  await page.getByRole('row', { name: /Energia/ }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByRole('row', { name: /Energia/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'Fluxo de caixa' }).click();
  await expect(page.getByTestId('cash-flow-net')).toHaveText('-R$ 150,00');
});
