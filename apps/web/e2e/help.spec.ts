import { expect, request, test } from '@playwright/test';

/** F7-04: central de ajuda dentro do aplicativo. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('procurar na ajuda, abrir o artigo e ir para a tela', async ({ page }) => {
  const email = `ajuda-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Lia Dona',
      businessName: `Mercadinho ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page
    .getByRole('navigation', { name: 'Menu principal' })
    .getByRole('link', { name: 'Ajuda' })
    .click();
  await expect(page.getByRole('heading', { name: 'Ajuda', level: 1 })).toBeVisible();
  await page.getByLabel('O que você quer fazer?').fill('fiado');
  const resultado = page.getByRole('link', { name: /Vender no crediário/ });
  await expect(resultado).toBeVisible();
  await expect(page.getByRole('link', { name: /Programa de fidelidade/ })).toHaveCount(0);
  await resultado.click();

  await expect(page.getByRole('heading', { name: 'Vender no crediário (fiado)' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Limite do crediário' })).toBeVisible();
  await page.getByRole('link', { name: 'Ir para Clientes' }).click();
  await expect(page).toHaveURL(/\/clientes$/);

  await page.goto('/ajuda/nao-existe');
  await expect(page.getByText('Artigo não encontrado')).toBeVisible();
});
