import { expect, test } from '@playwright/test';

/** F1-02: perfis fiscais (lista, criar, editar) e vínculo com o produto. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('criar um perfil fiscal e escolher no cadastro do produto', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Paulo Dono');
  await page.getByLabel('Nome do negócio').fill(`Adega ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`paulo-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Paulo!' })).toBeVisible();

  await page.getByRole('link', { name: 'Perfis fiscais' }).click();
  await expect(page.getByText('O cálculo dos impostos chega com a emissão de NFC-e')).toBeVisible();
  // The signup already creates a default profile.
  await expect(page.getByRole('cell', { name: 'Revenda — Simples Nacional' })).toBeVisible();

  await page.getByRole('button', { name: 'Novo perfil' }).click();
  await page.getByLabel('Nome do perfil').fill('Bebidas com ST');
  await page.getByLabel('CFOP dentro do estado').fill('540');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('CFOP deve ter 4 dígitos')).toBeVisible();
  await page.getByLabel('CFOP dentro do estado').fill('5405');
  await page.getByLabel('CSOSN').fill('500');
  await page.getByLabel('cClassTrib (IBS/CBS) — opcional').fill('000001');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  const row = page.getByRole('row', { name: /Bebidas com ST/ });
  await expect(row).toContainText('5405 / 6102');
  await expect(row).toContainText('CSOSN 500');
  await expect(row).toContainText('000001');

  // Edit: switch to the normal regime (CST instead of CSOSN).
  await row.click();
  await page.getByLabel('Regime da empresa').selectOption('normal');
  await page.getByLabel('CST do ICMS').fill('60');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('row', { name: /Bebidas com ST/ })).toContainText('CST 60');

  // Link it to a product.
  await page.getByRole('link', { name: 'Produtos' }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Cerveja Lata 350 ml');
  await page.getByLabel('Preço de venda').fill('4,99');
  await page.getByLabel('Perfil fiscal').selectOption({ label: 'Bebidas com ST' });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('row', { name: /Cerveja Lata 350 ml/ }).click();
  await expect(page.getByLabel('Perfil fiscal')).toHaveValue(/[0-9a-f-]{36}/);
  await expect(page.getByLabel('Perfil fiscal').locator('option:checked')).toHaveText(
    'Bebidas com ST',
  );
});
