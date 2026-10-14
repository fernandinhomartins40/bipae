import { expect, request, test } from '@playwright/test';

/** F4-01: montar, salvar, enviar e cancelar um pedido de compra. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('pedido de compra do rascunho ao envio e ao cancelamento', async ({ page }) => {
  const email = `rui-compras-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rui Dono',
        businessName: `Mercearia ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('suppliers', {
    headers,
    data: { name: 'Distribuidora Boa', taxId: '11.444.777/0001-61' },
  });
  await api.post('products', {
    headers,
    data: { name: 'Arroz 5kg', priceCents: 2890, costCents: 2100 },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Pedidos de compra' }).click();
  await expect(page.getByText('Nenhum pedido ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Novo pedido' }).click();
  await page.getByLabel('Fornecedor', { exact: true }).selectOption({ label: 'Distribuidora Boa' });
  await page.getByLabel('Adicionar produto').fill('arroz');
  await page.getByRole('button', { name: /Arroz 5kg/ }).click();
  await page.getByLabel('Quantidade de Arroz 5kg (UN)').fill('10');
  // Custo vem do cadastro: 10 × R$ 21,00.
  await expect(page.getByTestId('order-total')).toHaveText('Total: R$ 210,00');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();

  const linha = page.getByRole('row', { name: /Distribuidora Boa/ });
  await expect(linha).toContainText('Rascunho');
  await expect(linha).toContainText('R$ 210,00');

  await linha.click();
  await page.getByRole('button', { name: 'Salvar e enviar' }).click();
  await expect(page.getByRole('row', { name: /Distribuidora Boa/ })).toContainText('Enviado');

  await page.getByRole('row', { name: /Distribuidora Boa/ }).click();
  await expect(page.getByRole('button', { name: 'Salvar rascunho' })).toHaveCount(0);
  await page.getByLabel('Motivo do cancelamento').fill('Fornecedor sem estoque');
  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await expect(page.getByRole('row', { name: /Distribuidora Boa/ })).toContainText('Cancelado');
});
