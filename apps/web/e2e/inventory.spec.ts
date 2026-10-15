import { expect, request, test } from '@playwright/test';

/** F4-11: inventário pelo celular, bipando e digitando o total. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');
test.use({ viewport: { width: 390, height: 844 } });

test('conta pelo celular, mostra a diferença e ajusta o estoque ao fechar', async ({ page }) => {
  const email = `lia-inventario-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Empório ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [loja] = await (await api.get('stores', { headers })).json();
  const feijao = await (
    await api.post('products', {
      headers,
      data: { name: 'Feijão 1kg', priceCents: 899, barcodes: ['78900011'] },
    })
  ).json();
  await api.post('stock/adjustments', {
    headers,
    data: { productId: feijao.id, storeId: loja.id, mode: 'count', quantityMilli: 12_000 },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  // No celular o menu rola na horizontal, acima do conteúdo.
  await page.getByRole('link', { name: 'Inventário' }).click();
  await page.getByLabel('Nome da contagem').fill('Corredor 3');
  await page.getByRole('button', { name: 'Começar contagem' }).click();

  const codigo = page.getByLabel('Código de barras ou código interno');
  await codigo.fill('78900011');
  await codigo.press('Enter');
  await expect(page.getByTestId('inventory-last')).toHaveText('Feijão 1kg: 1 contado(s)');
  await codigo.fill('78900011');
  await codigo.press('Enter');
  await expect(page.getByTestId('inventory-last')).toHaveText('Feijão 1kg: 2 contado(s)');

  // Achou mais uma caixa: digita o total de uma vez.
  await page.getByLabel('Como contar').selectOption('set');
  await page.getByLabel('Total contado').fill('10');
  await codigo.fill('78900011');
  await codigo.press('Enter');
  const linha = page.getByRole('list', { name: 'Produtos contados' }).getByRole('listitem');
  await expect(linha).toContainText('Sistema: 12 UN');
  await expect(linha).toContainText('−2');

  await codigo.fill('999');
  await codigo.press('Enter');
  await expect(page.getByTestId('inventory-last')).toHaveText('Código 999 não encontrado.');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Fechar inventário' }).click();
  await expect(page.getByTestId('inventory-last')).toHaveText(
    'Contagem fechada e estoque ajustado.',
  );
  await expect(linha).toContainText('Confere');
  await expect(codigo).toHaveCount(0);
});
