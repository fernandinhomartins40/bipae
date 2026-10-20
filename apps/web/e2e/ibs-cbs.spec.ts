import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F4-13: apuração gerencial do IBS e da CBS por empresa e mês. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('Simples vai no DAS; com a opção pelo regime regular, mostra a apuração e a fase de teste', async ({
  page,
}) => {
  const email = `ana-ibs-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Ana Dona',
      businessName: `Quitanda ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar' }).first().click();
  await page.getByLabel('Regime tributário').selectOption({ label: 'Simples Nacional' });
  await page.getByRole('button', { name: 'Salvar empresa' }).click();

  await abrirNoMenu(page, 'Apuração de IBS e CBS');
  await page.getByLabel('Mês').fill('2026-10');
  await expect(
    page.getByText('Pelo Simples Nacional, o IBS e a CBS são recolhidos no DAS'),
  ).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar' }).first().click();
  await page.getByLabel('Apura o IBS e a CBS pelo regime regular').check();
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByRole('button', { name: 'Salvar empresa' })).toHaveCount(0);

  await abrirNoMenu(page, 'Apuração de IBS e CBS');
  await page.getByLabel('Mês').fill('2026-10');
  await expect(page.getByText('Fase de teste')).toBeVisible();
  await expect(page.getByTestId('IBS-saldo')).toHaveText('R$ 0,00');
  await expect(page.getByTestId('CBS-saldo')).toHaveText('R$ 0,00');
});
