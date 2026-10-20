import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

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
  await abrirNoMenu(page, 'Pedidos de compra');
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

test('entrada da mercadoria conferida por bipagem (F4-02)', async ({ page }) => {
  const email = `ivo-entrada-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Ivo Dono',
        businessName: `Atacado ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const fornecedor = await (
    await api.post('suppliers', {
      headers,
      data: { name: 'Laticínios Sul', taxId: '11.444.777/0001-61' },
    })
  ).json();
  const leite = await (
    await api.post('products', {
      headers,
      data: { name: 'Leite 1L', priceCents: 549, costCents: 400, barcodes: ['7891000100103'] },
    })
  ).json();
  const [loja] = await (await api.get('stores', { headers })).json();
  const pedido = await (
    await api.post('purchase-orders', {
      headers,
      data: {
        storeId: loja.id,
        supplierId: fornecedor.id,
        items: [{ productId: leite.id, quantityMilli: 3000, unitCostCents: 400 }],
      },
    })
  ).json();
  await api.post(`purchase-orders/${pedido.id}/send`, { headers });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await abrirNoMenu(page, 'Pedidos de compra');
  await page.getByRole('row', { name: /Laticínios Sul/ }).click();

  const bipe = page.getByLabel('Bipe o produto que chegou');
  for (let i = 0; i < 2; i++) {
    await bipe.fill('7891000100103');
    await bipe.press('Enter');
  }
  await expect(page.getByLabel('Chegou de Leite 1L')).toHaveValue('2');
  await bipe.fill('123');
  await bipe.press('Enter');
  await expect(page.getByText('O código 123 não está neste pedido.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar entrada no estoque' }).click();

  await expect(page.getByRole('row', { name: /Laticínios Sul/ })).toContainText('Recebido');
  await page.getByRole('row', { name: /Laticínios Sul/ }).click();
  await expect(page.getByText('Leite 1L: chegou 2 de 3 UN')).toBeVisible();
});
