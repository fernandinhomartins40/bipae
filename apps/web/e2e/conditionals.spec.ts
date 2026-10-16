import { expect, request, test, type Page } from '@playwright/test';

/** F5-12.b: venda condicional na retaguarda; o que o cliente fica vai ao caixa como comanda. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name }).click();

test('o cliente leva peças, devolve uma e o que ficou vai ao caixa', async ({ page }) => {
  const email = `loja-cond-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Ateliê ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [loja] = await (await api.get('stores', { headers })).json();
  for (const [name, priceCents] of [
    ['Vestido Floral — M', 18_990],
    ['Blusa Seda — P', 9_990],
  ] as const) {
    const p = await (await api.post('products', { headers, data: { name, priceCents } })).json();
    await api.post('stock/adjustments', {
      headers,
      data: { productId: p.id, storeId: loja.id, mode: 'adjustment', quantityMilli: 3000 },
    });
  }
  await api.post('customers', { headers, data: { name: 'Joana Prado', taxId: '12345678909' } });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Condicional');
  await expect(page.getByText('Nenhum condicional ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Novo condicional' }).click();
  const gaveta = page.getByRole('dialog');
  await gaveta.getByLabel('Cliente').fill('Joana');
  await gaveta.getByRole('button', { name: 'Joana Prado' }).click();
  await expect(gaveta.getByText('Cliente: Joana Prado')).toBeVisible();
  // O aviso da nota de remessa (Ajuste SINIEF 02/18) aparece, sem prometer o que não existe.
  await expect(gaveta.getByText(/CFOP 5\.912/)).toBeVisible();
  for (const peca of ['Vestido', 'Blusa']) {
    await gaveta.getByLabel('Adicionar peça').fill(peca);
    await gaveta.getByRole('button', { name: new RegExp(peca) }).click();
  }
  await gaveta.getByRole('button', { name: 'Registrar a saída' }).click();

  const linha = page.getByRole('row', { name: /Joana Prado/ });
  await expect(linha).toContainText('Com o cliente');
  await expect(linha).toContainText('R$ 289,80');

  // Volta: ficou com o vestido, devolveu a blusa.
  await linha.click();
  await page.getByLabel('Ficou com Vestido Floral — M (UN)').fill('1');
  await page.getByRole('button', { name: 'Registrar a volta' }).click();
  await expect(
    page.getByText('O que Joana Prado ficou foi para o caixa como a comanda "Condicional 1".', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Joana Prado/ })).toContainText('Fechado');

  // O pedido está na fila do caixa da loja, como os do garçom.
  const pedidos = await (await api.get('tabs/orders', { headers })).json();
  expect(pedidos).toEqual([
    expect.objectContaining({
      label: 'Condicional 1',
      status: 'pending',
      items: [expect.objectContaining({ name: 'Vestido Floral — M', quantityMilli: 1000 })],
    }),
  ]);
});
