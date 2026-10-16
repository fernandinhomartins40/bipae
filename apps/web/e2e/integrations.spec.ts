import { expect, request, test, type Page } from '@playwright/test';

/** F6-01.a: chave da API pública criada na retaguarda, usada por outro sistema e revogada. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name }).click();

test('criar a chave, usar na API pública e revogar', async ({ page }) => {
  const email = `api-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Bruno Dono',
      businessName: `Loja Online ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Integrações (API)');
  await expect(page.getByText('Nenhuma chave ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Nova chave' }).click();
  await page.getByLabel('Nome da chave').fill('Loja virtual');
  await expect(page.getByLabel('Ler produtos, preços, estoque e vendas')).toBeChecked();
  await page.getByRole('button', { name: 'Criar chave' }).click();

  const chave = (await page.getByLabel('Chave de API criada').textContent())!.trim();
  expect(chave).toMatch(/^bpk_/);
  const parceiro = await request.newContext({
    baseURL: 'http://localhost:3334/v1/',
    extraHTTPHeaders: { authorization: `Bearer ${chave}` },
  });
  const eu = await parceiro.get('public/me');
  expect(eu.status()).toBe(200);
  expect(await eu.json()).toMatchObject({ apiKey: { name: 'Loja virtual' } });

  await page.getByRole('button', { name: 'Já guardei' }).click();
  await expect(page.getByLabel('Chave de API criada')).toHaveCount(0);
  const linha = page.getByRole('row', { name: /Loja virtual/ });
  await linha.getByRole('button', { name: 'Revogar Loja virtual' }).click();
  await expect(linha.getByText('Revogada')).toBeVisible();
  expect((await parceiro.get('public/me')).status()).toBe(401);
});
