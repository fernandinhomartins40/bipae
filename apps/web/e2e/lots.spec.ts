import { expect, request, test } from '@playwright/test';

/** F5-04.c: lote e validade na retaguarda. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('informa lotes, vê o vencido no aviso e descarta', async ({ page }) => {
  const email = `rosa-lotes-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rosa Dona',
        businessName: `Farmácia ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', { headers, data: { name: 'Dipirona 500mg', priceCents: 890 } });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Liga o controle de lote no cadastro do produto.
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('row', { name: /Dipirona 500mg/ }).click();
  await page.getByLabel('Controla lote e validade').check();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Lote e validade' }).click();
  await expect(page.getByText('Nada vencendo')).toBeVisible();

  const informar = async (lote: string, validade: string, quantidade: string) => {
    await page.getByRole('button', { name: 'Informar lote' }).click();
    await page.getByLabel('Produto do lote').fill('dipirona');
    await page.getByRole('button', { name: /Dipirona 500mg/ }).click();
    await page.getByLabel('Número do lote').fill(lote);
    await page.getByLabel('Validade').fill(validade);
    await page.getByLabel(/^Quantidade/).fill(quantidade);
    await page.getByRole('button', { name: 'Salvar lote' }).click();
    await expect(page.getByRole('button', { name: 'Salvar lote' })).toHaveCount(0);
  };
  await informar('VENC-01', '2020-05-31', '10');
  await informar('BOM-02', '2099-12-31', '30');

  // Só o vencido aparece no aviso.
  const aviso = page.getByRole('table', { name: 'Lotes vencendo e vencidos' });
  await expect(aviso.getByRole('row', { name: /VENC-01/ })).toContainText('Vencido há');
  await expect(aviso.getByRole('row', { name: /BOM-02/ })).toHaveCount(0);

  // Os dois lotes do produto, e o descarte do vencido.
  await page.getByLabel('Produto', { exact: true }).fill('dipirona');
  await page.getByRole('button', { name: /Dipirona 500mg/ }).click();
  const doProduto = page.getByRole('table', { name: 'Lotes de Dipirona 500mg' });
  await expect(doProduto.getByRole('row')).toHaveCount(3);
  await aviso.getByRole('row', { name: /VENC-01/ }).click();
  await expect(page.getByText('Nenhuma venda saiu deste lote.')).toBeVisible();
  await expect(page.getByLabel('Motivo do descarte')).toHaveValue('Vencido');
  await page.getByRole('button', { name: 'Descartar do estoque' }).click();
  await expect(page.getByText('Nada vencendo')).toBeVisible();
  await expect(doProduto.getByRole('row')).toHaveCount(2);
});
