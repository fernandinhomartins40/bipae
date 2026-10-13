import { expect, test, type Page } from '@playwright/test';

/** F1-04: kits (composição no cadastro) e, depois, variações. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name }).click();

async function novoProduto(page: Page, nome: string, preco: string) {
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill(nome);
  await page.getByLabel('Preço de venda').fill(preco);
}

test('montar um kit no cadastro do produto', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Lia Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercearia ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`lia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Lia!' })).toBeVisible();

  await menu(page, 'Produtos');
  for (const [nome, preco] of [
    ['Arroz 5kg', '28,90'],
    ['Feijão 1kg', '8,99'],
  ]) {
    await novoProduto(page, nome!, preco!);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('row', { name: new RegExp(nome!) })).toBeVisible();
  }

  // A cesta: 1 arroz e 2 feijões.
  await novoProduto(page, 'Cesta Básica', '45,00');
  await page.getByLabel('Este produto é um kit').check();
  await page.getByLabel('Adicionar item ao kit').fill('arroz');
  await page.getByRole('button', { name: /Arroz 5kg/ }).click();
  await page.getByLabel('Adicionar item ao kit').fill('feij');
  await page.getByRole('button', { name: /Feijão 1kg/ }).click();
  await page.getByLabel('Quantidade de Feijão 1kg no kit').fill('2');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('row', { name: /Cesta Básica/ })).toBeVisible();

  // Ao reabrir, a composição continua lá.
  await page.getByRole('row', { name: /Cesta Básica/ }).click();
  await expect(page.getByLabel('Este produto é um kit')).toBeChecked();
  await expect(page.getByLabel('Quantidade de Arroz 5kg no kit')).toHaveValue('1');
  await expect(page.getByLabel('Quantidade de Feijão 1kg no kit')).toHaveValue('2');

  // Um kit não aparece como opção para entrar em outro kit.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await novoProduto(page, 'Kit Festa', '99,00');
  await page.getByLabel('Este produto é um kit').check();
  await page.getByLabel('Adicionar item ao kit').fill('cesta');
  await expect(page.getByText('Nenhum produto encontrado.')).toBeVisible();
});

test('gerar a grade de variações de um modelo', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Tati Dona');
  await page.getByLabel('Nome do negócio').fill(`Boutique ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`tati-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Tati!' })).toBeVisible();

  await menu(page, 'Produtos');
  await novoProduto(page, 'Camiseta Básica', '49,90');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('row', { name: /Camiseta Básica/ }).click();

  // 2 tamanhos × 2 cores = 4 variações.
  await page.getByLabel('Valores de Tamanho').fill('P, M');
  await page.getByLabel('Valores de Cor').fill('Azul, Preto');
  await page.getByRole('button', { name: 'Gerar 4 variações' }).click();
  await expect(page.getByText('4 variações criadas.')).toBeVisible();
  const lista = page.getByRole('list', { name: 'Variações deste produto' });
  await expect(lista.getByRole('listitem')).toHaveCount(4);
  await expect(lista).toContainText('Camiseta Básica — P / Azul');
  await expect(lista).toContainText('R$ 49,90');

  // Acrescentar o tamanho G só cria as 2 que faltam.
  await page.getByLabel('Valores de Tamanho').fill('P, M, G');
  await page.getByLabel('Valores de Cor').fill('Azul, Preto');
  await page.getByRole('button', { name: 'Gerar 2 variações' }).click();
  await expect(page.getByText('2 variações criadas.')).toBeVisible();
  await expect(lista.getByRole('listitem')).toHaveCount(6);

  // As variações aparecem na lista de produtos.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('row', { name: /Camiseta Básica — G \/ Preto/ })).toBeVisible();
});
