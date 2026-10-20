import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F4-03: formar o preço no cadastro do produto. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('margem, impostos e despesas viram o preço sugerido, e o preço vai para o campo', async ({
  page,
}) => {
  const email = `bia-preco-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Bia Dona',
        businessName: `Empório ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Café 500g', priceCents: 1890, costCents: 2100 },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await abrirNoMenu(page, 'Produtos');
  await page.getByRole('row', { name: /Café 500g/ }).click();

  const quadro = page.getByRole('region', { name: 'Formar preço' });
  await quadro.getByLabel('Margem (%)').fill('20');
  await quadro.getByLabel(/Impostos da venda|Alíquota do DAS/).fill('8');
  await quadro.getByLabel('Despesas (%)').fill('2');
  // 21,00 ÷ (1 − 0,30) = 30,00
  await expect(quadro.getByTestId('suggested-price')).toContainText('Preço sugerido: R$ 30,00');
  await quadro.getByRole('button', { name: 'Usar este preço' }).click();
  await expect(page.getByLabel('Preço de venda')).toHaveValue('30,00');
});
