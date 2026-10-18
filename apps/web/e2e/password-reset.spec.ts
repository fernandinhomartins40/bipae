import { expect, test } from '@playwright/test';

/** P-04.b: recuperar senha. Sem o provedor de e-mail (E11), o login não oferece o que não entrega. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('sem e-mail ligado, não há "Esqueci a senha"; link vencido explica o que fazer', async ({
  page,
}) => {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Esqueci a senha' })).toHaveCount(0);

  await page.goto('/redefinir-senha?codigo=link-que-nao-existe-mais-0123456789');
  await page.getByLabel('Senha nova', { exact: true }).fill('senha-nova-forte-1');
  await page.getByLabel('Repita a senha nova').fill('senha-nova-forte-1');
  await page.getByRole('button', { name: 'Criar senha nova' }).click();
  await expect(page.getByText(/expirou ou já foi usado/)).toBeVisible();

  await page.getByLabel('Repita a senha nova').fill('outra');
  await page.getByRole('button', { name: 'Criar senha nova' }).click();
  await expect(page.getByText('As duas senhas precisam ser iguais.')).toBeVisible();
});

test('link de confirmação do e-mail vencido explica o que fazer (P-04.c)', async ({ page }) => {
  await page.goto('/confirmar-email?codigo=link-que-nao-existe-mais-0123456789');
  await expect(page.getByRole('heading', { name: 'Confirmar e-mail' })).toBeVisible();
  await expect(page.getByText(/expirou ou já foi usado/)).toBeVisible();
});

test('link de descadastro inválido explica; a página pede um clique (F6-08.c)', async ({
  page,
}) => {
  await page.goto('/descadastro?codigo=link-que-nao-existe-mais-0123456789');
  await expect(page.getByRole('heading', { name: 'Não receber mais ofertas' })).toBeVisible();
  await page.getByRole('button', { name: 'Não quero mais receber' }).click();
  await expect(page.getByText('Este link de descadastro não vale.')).toBeVisible();
});
