import { expect, request, test, type Page } from '@playwright/test';

/** F5-03: atacarejo, do cadastro do produto ao caixa. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('preço de atacado a partir de 6 unidades vale no caixa', async ({ page }) => {
  const email = `teo-atacado-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Téo Dono',
      businessName: `Atacarejo ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Óleo de soja 900ml');
  await page.getByLabel('Preço de venda').fill('7,99');
  await page.getByLabel('Código de barras').fill('78912342');
  await page.getByLabel('Atacado a partir de').fill('6');
  await page.getByRole('button', { name: 'Salvar' }).click();
  // Só a quantidade, sem o preço: a tela avisa.
  await expect(
    page.getByText('Para o atacado, informe o preço e a partir de quantas unidades'),
  ).toBeVisible();
  await page.getByLabel('Preço de atacado (opcional)').fill('6,99');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('row', { name: /Óleo de soja 900ml/ })).toBeVisible();

  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  await scan(page, '5*78912342');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 39,95');
  await scan(page, '78912342');
  // Na sexta, todas saem a R$ 6,99: 6 × 6,99 = 41,94.
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 41,94');
  await expect(page.getByRole('list', { name: 'Promoções' })).toContainText(
    'Atacado: Óleo de soja 900ml',
  );
});
