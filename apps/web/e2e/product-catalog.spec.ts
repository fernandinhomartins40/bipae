import { expect, test } from '@playwright/test';

/**
 * MF-02: cadastro de produto preenchido pelo catálogo. As respostas do catálogo são simuladas
 * aqui (a conversa real com o MercadoFlow é testada na API); o produto é salvo de verdade.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const ACUCAR = {
  gtin: '7891910000197',
  found: true,
  description: 'Açúcar União Refinado 1kg',
  brand: 'União',
  manufacturer: 'Camil',
  department: 'Mercearia',
  category: 'Açúcar e Adoçantes > Açúcar',
  unit: 'UN',
  weighable: false,
  packageDescription: '1 kg',
  content: { quantity: '1', unit: 'KG', packs: 1 },
  ncm: '17019900',
  ncmConfidence: 0.92,
  cest: null,
  packs: [{ packGtin: '17891910000194', unitsPerPack: 10 }],
  source: 'TESTE',
};

test('buscar no catálogo pelo nome preenche o cadastro; o usuário confere e salva', async ({
  page,
}) => {
  await page.route('**/product-catalog/status', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/product-catalog/search**', (route) =>
    route.fulfill({ json: { items: [{ ...ACUCAR, ncm: undefined, packs: undefined }] } }),
  );
  await page.route('**/product-catalog/products/**', (route) => route.fulfill({ json: ACUCAR }));

  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rosa Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rosa-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rosa!' })).toBeVisible();

  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Buscar no catálogo').fill('acucar uniao');
  await page.getByRole('button', { name: /Açúcar União Refinado 1kg/ }).click();

  await expect(page.getByText('Preenchido pelo catálogo')).toBeVisible();
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Açúcar União Refinado 1kg');
  await expect(page.getByLabel('Código de barras')).toHaveValue('7891910000197');
  await expect(page.getByLabel('NCM', { exact: true })).toHaveValue('17019900');
  await expect(
    page.getByText(
      'Marca União · Fabricante Camil · Mercearia · 1 kg · Caixa 17891910000194 com 10',
    ),
  ).toBeVisible();

  // O catálogo não define preço: sem ele, não salva.
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Informe o preço de venda')).toBeVisible();
  await page.getByLabel('Preço de venda').fill('5,99');
  await page.getByLabel('Preço de venda').blur();
  await page.getByRole('button', { name: 'Salvar' }).click();

  const linha = page.getByRole('row', { name: /Açúcar União Refinado 1kg/ });
  await expect(linha).toContainText('R$ 5,99');
  // Os dados do catálogo ficaram guardados no produto.
  await linha.click();
  await expect(
    page.getByText(
      'Marca União · Fabricante Camil · Mercearia · 1 kg · Caixa 17891910000194 com 10',
    ),
  ).toBeVisible();
});
