import AxeBuilder from '@axe-core/playwright';
import { expect, request, test } from '@playwright/test';
import { settleAnimations } from './animations';

/** F8-06: o caixa no celular e no tablet, sem rolagem lateral, com o Receber ao alcance. */
test.skip(() => test.info().project.name !== 'web', 'A largura de celular é do navegador.');
test.use({ viewport: { width: 390, height: 844 } });

test('vende no celular pelo Receber da barra de baixo, sem rolagem lateral', async ({ page }) => {
  const email = `lia-celular-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Mercearia ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  await api.post('products', {
    headers: { authorization: `Bearer ${conta.accessToken}` },
    data: { name: 'Arroz Tipo 1 5kg', priceCents: 2890, barcodes: ['78912342'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Celular');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill('2*78912342');
  await input.press('Enter');
  const barra = page.getByRole('region', { name: 'Total e pagamento' });
  await expect(barra).toContainText('1 item');
  await expect(page.getByTestId('pdv-total-mobile')).toHaveText('R$ 57,80');
  // O item aparece na lista (no tablet ela ficava sem altura).
  await expect(page.getByRole('region', { name: 'Itens da venda' })).toContainText('Arroz');

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const sobra = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sobra, `rolagem lateral em ${width}px`).toBeLessThanOrEqual(0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  // WCAG 2.2 AA no caixa do celular, como nas outras telas (F7-03).
  await settleAnimations(page);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await barra.getByRole('button', { name: 'Receber', exact: true }).click();
  await page.getByLabel('Valor recebido (R$)').fill('60,00');
  await page.getByRole('button', { name: 'Adicionar dinheiro' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída. Troco: R$ 2,20.')).toBeVisible();
  await expect(barra.getByRole('button', { name: 'Receber', exact: true })).toBeDisabled();
});
