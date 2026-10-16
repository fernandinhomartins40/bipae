import { expect, request, test } from '@playwright/test';

/** F5-11: ficha técnica no cadastro do produto, com o custo da composição e a margem. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('ficha técnica: o prato mostra o custo dos insumos e a margem', async ({ page }) => {
  const email = `rita-ficha-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Pizzaria ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  for (const [name, costCents] of [
    ['Queijo mussarela', 3990],
    ['Farinha de trigo', 450],
  ] as const) {
    await api.post('products', {
      headers,
      data: { name, unit: 'KG', isWeighable: true, priceCents: 1, costCents, ingredient: true },
    });
  }

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Pizza mussarela');
  await page.getByLabel('Preço de venda').fill('59,00');
  await page.getByLabel('Preço de venda').blur();
  await page.getByLabel('Este produto é um kit ou um prato com ficha técnica').check();
  const adicionar = page.getByLabel('Adicionar item ao kit');
  await adicionar.fill('queijo');
  await page
    .getByRole('list', { name: 'Produtos para o kit' })
    .getByText('Queijo mussarela')
    .click();
  await adicionar.fill('farinha');
  await page
    .getByRole('list', { name: 'Produtos para o kit' })
    .getByText('Farinha de trigo')
    .click();
  await page.getByLabel('Quantidade de Queijo mussarela no kit (KG)').fill('0,25');
  await page.getByLabel('Quantidade de Farinha de trigo no kit (KG)').fill('0,3');
  // 250 g a R$ 39,90/kg + 300 g a R$ 4,50/kg = R$ 11,33; margem de 80,8% sobre R$ 59,00.
  await expect(page.getByTestId('recipe-cost')).toHaveText(
    'Custo da composição: R$ 11,33 · margem de 80,8% sobre o preço',
  );
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('row', { name: /Pizza mussarela/ })).toBeVisible();
});
