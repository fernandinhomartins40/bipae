import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F3-20.c: notas emitidas contra o CNPJ da empresa, na tela Compras. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

test('a busca das notas recebidas explica o que falta sem o certificado', async ({ page }) => {
  const email = `loja-dfe-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Mercadinho ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [empresa] = await (await api.get('companies', { headers })).json();
  await api.patch(`companies/${empresa.id}`, {
    headers,
    data: { legalName: 'Mercadinho Bipaê LTDA', taxId: '11.222.333/0001-81', uf: 'SP' },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Compras');
  await expect(
    page.getByRole('heading', { name: 'Notas emitidas para a sua empresa' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Buscar notas agora' }).click();
  await expect(page.getByText(/certificado digital A1/).first()).toBeVisible();
});
