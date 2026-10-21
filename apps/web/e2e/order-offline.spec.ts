import { expect, request, test } from '@playwright/test';

/** F8-04: o vendedor monta o pedido sem internet; ele sai sozinho quando a rede volta. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');
test.use({ viewport: { width: 390, height: 844 } });

test('pedido feito sem internet fica no celular e chega uma vez só quando a rede volta', async ({
  page,
  context,
}) => {
  const email = `vera-offline-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Vera Dona',
        businessName: `Loja ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', { headers, data: { name: 'Blusa de lã', priceCents: 7990 } });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Vera!' })).toBeVisible();
  await page.goto('/garcom');
  await expect(page.getByTestId('device-ready')).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await page.getByLabel('Mesa, comanda ou nome do cliente').fill('Cliente Rosa');
  await page.getByLabel('Buscar produto').fill('blusa la');
  await page.getByRole('list', { name: 'Produtos encontrados' }).getByText('Blusa de lã').click();
  await page.getByRole('button', { name: /Mandar pedido/ }).click();
  await expect(
    page.getByText(/Sem internet: o pedido de Cliente Rosa ficou guardado/),
  ).toBeVisible();
  const guardados = page.getByRole('region', { name: 'Guardados no celular' });
  await expect(guardados).toContainText('Esperando internet');

  await context.setOffline(false);
  await expect(guardados).toHaveCount(0, { timeout: 30_000 });
  const pedidos = await (await api.get('tabs/orders', { headers })).json();
  expect(pedidos.filter((o: { label: string }) => o.label === 'Cliente Rosa')).toHaveLength(1);
});
