import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F6-07: sem a chave do provedor de IA (E13), o assistente diz que falta configurar. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('assistente sem provedor: "Falta configurar" e nada de IA no cadastro do produto', async ({
  page,
}) => {
  const email = `ia-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rui Dono',
        businessName: `Mercadinho ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  await api.post('products', {
    headers: { authorization: `Bearer ${conta.accessToken}` },
    data: { name: 'Cerveja Pilsen lata 350 ml', priceCents: 499 },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await abrirNoMenu(page, 'Assistente');
  await expect(page.getByRole('heading', { name: 'Assistente', level: 1 })).toBeVisible();
  await expect(page.getByText('Falta configurar')).toBeVisible();
  await expect(page.getByLabel('Sua pergunta')).toHaveCount(0);

  await page.goto('/produtos');
  await page.getByRole('row', { name: /Cerveja Pilsen/ }).click();
  await expect(page.getByLabel('NCM', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sugerir com IA' })).toHaveCount(0);
});
