import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F5-02: promoção cadastrada na retaguarda e aplicada pelo caixa. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('leve 3 pague 2 cadastrado na retaguarda vale no caixa', async ({ page }) => {
  const email = `bia-promo-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Bia Dona',
        businessName: `Mercadinho ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Suco de uva 1L', priceCents: 899, barcodes: ['78912342'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await abrirNoMenu(page, 'Promoções');
  await expect(page.getByText('Nenhuma promoção ainda')).toBeVisible();
  await page.getByRole('button', { name: 'Nova promoção' }).click();
  await page.getByLabel('Nome da promoção').fill('Suco: leve 3 pague 2');
  await page.getByLabel('Adicionar produto').fill('suco');
  await page.getByRole('button', { name: 'Suco de uva 1L' }).click();
  await page.getByRole('button', { name: 'Salvar promoção' }).click();
  const linha = page.getByRole('row', { name: /Suco: leve 3 pague 2/ });
  await expect(linha).toContainText('Leve 3 pague 2');
  await expect(linha).toContainText('Valendo');

  // Na edição, o produto aparece pelo nome.
  await linha.click();
  await expect(
    page.getByRole('list', { name: 'Produtos da promoção' }).getByText('Suco de uva 1L'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  await scan(page, '78912342');
  await scan(page, '78912342');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 17,98');
  await scan(page, '78912342');
  // A terceira sai de graça, sem pedir gerente.
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 17,98');
  await expect(page.getByRole('list', { name: 'Promoções' })).toContainText('Suco: leve 3 pague 2');
  await expect(page.getByTestId('promotion-discount')).toHaveText('-R$ 8,99');
});
