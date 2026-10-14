import { expect, test } from '@playwright/test';

/** F3-06.e: regras de ICMS da empresa, com conferência de conflito e exclusão. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('cadastrar, conferir conflito, editar e excluir uma regra de ICMS', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Lia Dona');
  await page.getByLabel('Nome do negócio').fill(`Adega ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`lia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Lia!' })).toBeVisible();

  await page.getByRole('link', { name: 'Regras de ICMS' }).click();
  await expect(page.getByText('Nenhuma regra de ICMS ainda')).toBeVisible();

  // Valores de exemplo, como o contador cadastraria.
  const nova = async (nome: string, aliquota: string) => {
    await page.getByRole('button', { name: 'Nova regra' }).click();
    await page.getByLabel('Nome da regra').fill(nome);
    await page.getByLabel('NCM', { exact: true }).fill('2203');
    await page.getByLabel('Alíquota do ICMS (%)').fill(aliquota);
    await page.getByLabel('Fonte').fill('Orientação do contador');
    await page.getByRole('button', { name: 'Salvar regra' }).click();
  };
  await nova('Cervejas', '25');
  const linha = page.getByRole('row', { name: /Cervejas/ });
  await expect(linha).toContainText('2203');
  await expect(linha).toContainText('Alíquota 25%');

  // Outra regra para o mesmo NCM no mesmo período é recusada com a explicação.
  await nova('Cervejas de novo', '20');
  await expect(
    page.getByText(
      'As regras "Cervejas" e "Cervejas de novo" valem para os mesmos NCM no mesmo período.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // Editar e excluir.
  await linha.click();
  await page.getByLabel('Alíquota do ICMS (%)').fill('27,5');
  await page.getByRole('button', { name: 'Salvar regra' }).click();
  await expect(linha).toContainText('Alíquota 27,5%');
  await linha.click();
  await page.getByRole('button', { name: 'Excluir regra' }).click();
  await expect(page.getByText('Nenhuma regra de ICMS ainda')).toBeVisible();
});

test('ver a referência do Portal da DIFAL com as linhas defasadas (F3-25)', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Ana Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercearia ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`ana-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Ana!' })).toBeVisible();

  await page.getByRole('link', { name: 'Empresas e lojas' }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('UF').selectOption('MA');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText(/ · MA/)).toBeVisible();

  await page.getByRole('link', { name: 'Regras de ICMS' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Referência: alíquotas por produto de MA no Portal da DIFAL',
    }),
  ).toBeVisible();
  await expect(page.getByText('O portal está desatualizado para MA')).toBeVisible();
  const tabela = page.getByRole('table', {
    name: 'Alíquotas por produto de MA no Portal da DIFAL',
  });
  await expect(tabela.getByText('Defasada').first()).toBeVisible();
  const linhas = await tabela.getByRole('row').count();
  await page.getByLabel('Procurar no portal').fill('regra geral');
  await expect.poll(() => tabela.getByRole('row').count()).toBeLessThan(linhas);
});
