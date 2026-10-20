import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F1-04: kits (composição no cadastro) e, depois, variações. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

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
  // Grade em matriz (F5-12.a): tamanho nas linhas, cor nas colunas, preço e estoque em cada uma.
  // Com 2 valores em cada atributo, dá para trocar linhas e colunas.
  await page.getByRole('button', { name: 'Trocar linhas e colunas' }).click();
  const grade = page.getByRole('table', { name: /Grade: Tamanho × Cor/ });
  await expect(grade.getByRole('rowheader')).toHaveText(['P', 'M']);
  await expect(grade.getByRole('columnheader', { name: 'Preto' })).toBeVisible();
  await expect(page.getByLabel('Preço P / Azul')).toHaveValue('49,90');
  await expect(page.getByLabel('Estoque M / Preto')).toHaveText('Estoque: 0');
  await page.getByRole('button', { name: 'Trocar linhas e colunas' }).click();
  await expect(page.getByRole('table', { name: /Grade: Cor × Tamanho/ })).toBeVisible();

  // Acrescentar o tamanho G só cria as 2 que faltam.
  await page.getByLabel('Valores de Tamanho').fill('P, M, G');
  await page.getByLabel('Valores de Cor').fill('Azul, Preto');
  await page.getByRole('button', { name: 'Gerar 2 variações' }).click();
  await expect(page.getByText('2 variações criadas.')).toBeVisible();
  await expect(grade.getByRole('rowheader')).toHaveText(['P', 'M', 'G']);

  // O preço de uma variação muda na própria grade.
  await page.getByLabel('Preço G / Preto').fill('59,90');
  await page.getByLabel('Preço G / Preto').blur();
  await page.getByRole('button', { name: 'Salvar preços da grade' }).click();
  await expect(page.getByText('1 preço alterado.')).toBeVisible();

  // As variações aparecem na lista de produtos.
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('row', { name: /Camiseta Básica — G \/ Preto/ })).toContainText(
    'R$ 59,90',
  );
});

test('no caixa aparecem as variações e não o modelo; o kit é vendido como um item', async ({
  page,
}) => {
  // Dados preparados direto pela API, para o teste focar no caixa.
  const email = `tati-caixa-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Tati Dona',
        businessName: `Boutique ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const modelo = await (
    await api.post('products', { headers, data: { name: 'Camiseta Básica', priceCents: 4990 } })
  ).json();
  for (const tamanho of ['P', 'M']) {
    await api.post('products', {
      headers,
      data: {
        name: `Camiseta Básica — ${tamanho}`,
        priceCents: 4990,
        parentId: modelo.id,
        attributes: { Tamanho: tamanho },
      },
    });
  }
  const meia = await (
    await api.post('products', { headers, data: { name: 'Meia Esportiva', priceCents: 1500 } })
  ).json();
  await api.post('products', {
    headers,
    data: {
      name: 'Kit Treino',
      priceCents: 5900,
      barcodes: ['7890000000048'],
      components: [{ productId: meia.id, quantity: 2 }],
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Abrir o caixa');
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0,00');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();

  const bipar = page.getByLabel('Bipe o código ou digite o nome do produto');
  await bipar.fill('camiseta');
  await bipar.press('Enter');
  const resultados = page.getByRole('list', { name: 'Resultados da busca' });
  await expect(resultados.getByRole('listitem')).toHaveCount(2);
  await expect(resultados).toContainText('Camiseta Básica — P');
  await expect(resultados).toContainText('Camiseta Básica — M');
  await resultados.getByRole('button', { name: /Camiseta Básica — M/ }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 49,90');

  // O kit entra como um item só, pelo preço do kit.
  await bipar.fill('7890000000048');
  await bipar.press('Enter');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 108,90');
  await api.dispose();
});
