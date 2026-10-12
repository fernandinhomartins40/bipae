import { expect, test, type Page } from '@playwright/test';

/**
 * The same scenarios run against both shells (ADR-0012): "web" (browser routing) and
 * "desktop-ui" (the Tauri frontend with hash routing, here in Chromium; inside the real
 * WebView it runs in CI with tauri-driver).
 */
const isDesktop = () => test.info().project.name === 'desktop-ui';
const go = (page: Page, path: string) => page.goto(isDesktop() ? `/#${path}` : path);
const unique = () => `${test.info().project.name}-${Date.now()}`;
const password = 'senha-forte-123';

test('signup, register a product, find it by barcode, add a terminal, log out and back in', async ({
  page,
}) => {
  const owner = { email: `celia-${unique()}@exemplo.com.br`, password };
  await go(page, '/');
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByRole('link', { name: 'Comece grátis' }).click();

  await page.getByLabel('Seu nome').fill('Célia Andrade');
  await page.getByLabel('Nome do negócio').fill('Bazar da Célia');
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill(owner.password);
  await page.getByLabel('CNPJ ou CPF (opcional)').fill('11222333000181');
  await expect(page.getByLabel('CNPJ ou CPF (opcional)')).toHaveValue('11.222.333/0001-81');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();

  // Ready to use right after signup: no mandatory setup screens.
  await expect(page.getByRole('heading', { name: 'Olá, Célia!' })).toBeVisible();
  if (isDesktop()) {
    await expect(page.getByText('O que funciona neste computador')).toBeVisible();
    // Native drivers are not built yet, and the screen says so instead of pretending.
    await expect(
      page.getByText(
        'O suporte para a gaveta de dinheiro chega numa próxima atualização do Bipaê.',
      ),
    ).toBeVisible();
  } else {
    await expect(page.getByText('O que funciona neste navegador')).toBeVisible();
    // Peripherals ask for the Conector; what is not built yet says so honestly.
    await expect(
      page.getByText('Para usar a gaveta de dinheiro no navegador, instale o Bipaê Conector'),
    ).toBeVisible();
  }
  await expect(
    page.getByText('O suporte para o banco local chega numa próxima atualização do Bipaê.'),
  ).toBeVisible();

  // Product with price in BRL notation and a barcode.
  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await expect(page.getByText('Nenhum produto ainda')).toBeVisible();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Caderno Universitário 10 matérias');
  await page.getByLabel('Preço de venda').fill('24,90');
  await page.getByLabel('Código de barras').fill('7891000315507');
  await page.getByRole('button', { name: 'Salvar' }).click();
  const row = page.getByRole('row', { name: /Caderno Universitário/ });
  await expect(row).toContainText('R$ 24,90');

  // A wrong check digit is explained in Portuguese.
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Produto com código errado');
  await page.getByLabel('Preço de venda').fill('1,00');
  await page.getByLabel('Código de barras').fill('7891000315508');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Dígito verificador do código de barras inválido')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // Search by "beeping" the barcode.
  await page.getByLabel('Buscar produtos').fill('7891000315507');
  await expect(page.getByRole('row', { name: /Caderno Universitário/ })).toBeVisible();
  await page.getByLabel('Buscar produtos').fill('nada-disso');
  await expect(page.getByText('Nada encontrado')).toBeVisible();

  // Each terminal gets its own NFC-e series.
  await page.getByRole('link', { name: 'Caixas', exact: true }).click();
  await page.getByRole('button', { name: 'Novo caixa' }).click();
  await page.getByLabel('Nome do caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar caixa' }).click();
  await expect(page.getByRole('row', { name: /Caixa 1/ })).toContainText(
    isDesktop() ? 'App desktop' : 'Navegador',
  );
  await expect(page.getByRole('row', { name: /Caixa 1/ })).toContainText('1');

  // Audit trail recorded everything and is intact.
  await page.getByRole('link', { name: 'Auditoria', exact: true }).click();
  await expect(page.getByText('Trilha íntegra')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Produto cadastrado' })).toBeVisible();

  // Session survives a reload (refresh token), then log out and back in.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await page.getByLabel('Senha').fill(owner.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Célia!' })).toBeVisible();
});

test('accessibility preferences: high contrast and large font persist', async ({ page }) => {
  await go(page, '/criar-conta');
  await page.getByLabel('Seu nome').fill('Juliana');
  await page.getByLabel('Nome do negócio').fill('Loja da Ju');
  await page.getByLabel('E-mail').fill(`ju-${unique()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await page.getByRole('link', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Alto contraste').check();
  await page.getByLabel('Letras maiores').check();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'large');
});
