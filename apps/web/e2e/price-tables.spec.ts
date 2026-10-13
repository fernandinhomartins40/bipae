import { expect, test, type Page } from '@playwright/test';

/** F1-03: tabelas de preço (telas) e, na F1-03.d, o caixa usando os preços. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name }).click();

async function newShop(page: Page) {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rosa Dona');
  await page.getByLabel('Nome do negócio').fill(`Atacarejo ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rosa-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rosa!' })).toBeVisible();
}

test('criar uma tabela de preço e usá-la na loja e num cliente', async ({ page }) => {
  await newShop(page);
  await menu(page, 'Produtos');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Óleo de Soja 900 ml');
  await page.getByLabel('Preço de venda').fill('8,49');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('row', { name: /Óleo de Soja/ })).toBeVisible();

  // The table.
  await menu(page, 'Tabelas de preço');
  await page.getByRole('button', { name: 'Nova tabela' }).click();
  await page.getByLabel('Nome da tabela').fill('Atacado');
  await page.getByLabel('Adicionar produto').fill('óleo');
  await page.getByRole('button', { name: /Óleo de Soja 900 ml/ }).click();
  await expect(page.getByText('Preço normal: R$ 8,49')).toBeVisible();
  await page.getByLabel('Preço de Óleo de Soja 900 ml nesta tabela').fill('7,29');
  await page.getByRole('button', { name: 'Salvar tabela' }).click();
  await expect(page.getByRole('row', { name: /Atacado/ })).toContainText('1 produto');

  // Editing keeps the special price.
  await page.getByRole('row', { name: /Atacado/ }).click();
  await expect(page.getByLabel('Preço de Óleo de Soja 900 ml nesta tabela')).toHaveValue('7,29');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // The store.
  await menu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar a loja Loja principal' }).click();
  await page.getByLabel('Tabela de preço da loja').selectOption({ label: 'Atacado' });
  await page.getByRole('button', { name: 'Salvar loja' }).click();
  await expect(page.getByRole('button', { name: 'Editar a loja Loja principal' })).toContainText(
    'Atacado',
  );

  // A customer.
  await menu(page, 'Clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  await page.getByLabel('Nome').first().fill('Bar do Toninho');
  await page.getByLabel('Tabela de preço').selectOption({ label: 'Atacado' });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('row', { name: /Bar do Toninho/ }).click();
  await expect(page.getByLabel('Tabela de preço').locator('option:checked')).toHaveText('Atacado');
});
