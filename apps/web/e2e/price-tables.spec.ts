import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F1-03: tabelas de preço nas telas e no caixa. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

async function newShop(page: Page) {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rosa Dona');
  await page.getByLabel('Nome do negócio').fill(`Atacarejo ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rosa-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rosa!' })).toBeVisible();
}

test('criar uma tabela de preço e usá-la na loja e num cliente', async ({ page }) => {
  await newShop(page);
  await menu(page, 'Produtos');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Óleo de Soja 900 ml');
  await page.getByLabel('Preço de venda').fill('8,49');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('row', { name: /Óleo de Soja/ })).toBeVisible();

  // A tabela.
  await menu(page, 'Tabelas de preço');
  await page.getByRole('button', { name: 'Nova tabela' }).click();
  await page.getByLabel('Nome da tabela').fill('Atacado');
  await page.getByLabel('Adicionar produto').fill('óleo');
  await page.getByRole('button', { name: /Óleo de Soja 900 ml/ }).click();
  await expect(page.getByText('Preço normal: R$ 8,49')).toBeVisible();
  await page.getByLabel('Preço de Óleo de Soja 900 ml nesta tabela').fill('7,29');
  await page.getByRole('button', { name: 'Salvar tabela' }).click();
  await expect(page.getByRole('row', { name: /Atacado/ })).toContainText('1 produto');

  // Ao editar, o preço especial continua lá.
  await page.getByRole('row', { name: /Atacado/ }).click();
  await expect(page.getByLabel('Preço de Óleo de Soja 900 ml nesta tabela')).toHaveValue('7,29');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // A loja.
  await menu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar a loja Loja principal' }).click();
  await page.getByLabel('Tabela de preço da loja').selectOption({ label: 'Atacado' });
  await page.getByRole('button', { name: 'Salvar loja' }).click();
  await expect(page.getByRole('button', { name: 'Editar a loja Loja principal' })).toContainText(
    'Atacado',
  );

  // Um cliente.
  await menu(page, 'Clientes');
  await page.getByRole('button', { name: 'Novo cliente' }).click();
  await page.getByLabel('Nome').first().fill('Bar do Toninho');
  await page.getByLabel('Tabela de preço').selectOption({ label: 'Atacado' });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.getByRole('row', { name: /Bar do Toninho/ }).click();
  await expect(page.getByLabel('Tabela de preço').locator('option:checked')).toHaveText('Atacado');
});

test('no caixa vale a tabela da loja e, com o CPF do cliente, a tabela dele', async ({ page }) => {
  // Dados preparados direto pela API, para o teste focar no caixa.
  const email = `rosa-caixa-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rosa Dona',
        businessName: `Atacarejo ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const arroz = await (
    await api.post('products', {
      headers,
      data: { name: 'Arroz 5kg', priceCents: 2890, barcodes: ['7891000315507'] },
    })
  ).json();
  const tabelaLoja = await (
    await api.post('price-tables', {
      headers,
      data: { name: 'Loja Centro', items: [{ productId: arroz.id, priceCents: 2700 }] },
    })
  ).json();
  const atacado = await (
    await api.post('price-tables', {
      headers,
      data: { name: 'Atacado', items: [{ productId: arroz.id, priceCents: 2500 }] },
    })
  ).json();
  const [loja] = await (await api.get('stores', { headers })).json();
  await api.patch(`stores/${loja.id}`, { headers, data: { priceTableId: tabelaLoja.id } });
  await api.post('customers', {
    headers,
    data: { name: 'Bar do Zé', taxId: '529.982.247-25', priceTableId: atacado.id },
  });

  // Entra e abre o caixa.
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

  // Sem cliente: preço da tabela da loja.
  const bipar = page.getByLabel('Bipe o código ou digite o nome do produto');
  await bipar.fill('7891000315507');
  await bipar.press('Enter');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 27,00');
  await expect(page.getByTestId('price-table')).toHaveText('Preços da tabela Loja Centro');

  // Com o CPF do cliente do atacado, o carrinho é recalculado com a tabela dele.
  await page.keyboard.press('F6');
  await page.getByLabel('CPF ou CNPJ do cliente').fill('52998224725');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 25,00');
  await expect(page.getByTestId('price-table')).toHaveText('Preços da tabela Atacado');

  // Itens bipados depois do CPF já entram com o preço do cliente.
  await bipar.fill('7891000315507');
  await bipar.press('Enter');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 50,00');

  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  await api.dispose();
});
