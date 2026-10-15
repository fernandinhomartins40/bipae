import { expect, request, test } from '@playwright/test';

/** F5-01: etiquetas de gôndola e de balança em PDF. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('gera o PDF das etiquetas de gôndola e de balança', async ({ page }) => {
  const email = `rita-etiq-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Hortifruti ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Feijão preto 1kg', priceCents: 899, barcodes: ['7891000315507'] },
  });
  await api.post('products', {
    headers,
    data: { name: 'Mussarela fatiada', priceCents: 4590, unit: 'KG', isWeighable: true, sku: '17' },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Etiquetas' }).click();

  await page.getByLabel('Adicionar produto').fill('feijão');
  await page.getByRole('button', { name: 'Feijão preto 1kg' }).click();
  await page.getByLabel('Etiquetas de Feijão preto 1kg').fill('6');
  const gondola = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Gerar PDF das etiquetas' }).click();
  expect((await gondola).suggestedFilename()).toBe('bipae-etiquetas-gondola.pdf');

  await page.getByLabel('Tipo de etiqueta').selectOption('scale');
  await page.getByLabel('Adicionar produto').fill('fei');
  await expect(page.getByText('Nenhum produto vendido por peso encontrado.')).toBeVisible();
  await page.getByLabel('Adicionar produto').fill('mussa');
  await page.getByRole('button', { name: 'Mussarela fatiada' }).click();
  await page.getByRole('button', { name: 'Gerar PDF das etiquetas' }).click();
  await expect(page.getByText('Peso inválido em Mussarela fatiada.')).toBeVisible();
  await page.getByLabel('Peso de Mussarela fatiada (kg)').fill('0,350');
  const balanca = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Gerar PDF das etiquetas' }).click();
  const arquivo = await balanca;
  expect(arquivo.suggestedFilename()).toBe('bipae-etiquetas-balanca.pdf');
});
