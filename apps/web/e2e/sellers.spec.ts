import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F8-01: vendedor cadastrado na retaguarda, escolhido no caixa sem internet, visto no relatório. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

async function scan(page: Page, text: string) {
  const input = page.getByLabel('Bipe o código ou digite o nome do produto');
  await input.fill(text);
  await input.press('Enter');
}

test('o caixa escolhe o vendedor pelo código e o relatório mostra as vendas dele', async ({
  page,
  context,
}) => {
  const email = `rita-vendedores-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Boutique ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Vestido floral', priceCents: 12_000, barcodes: ['78900035'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Retaguarda: o código sugerido já vem preenchido.
  await abrirNoMenu(page, 'Vendedores');
  await expect(page.getByText('Nenhum vendedor ainda')).toBeVisible();
  await page.getByRole('button', { name: 'Cadastrar o primeiro vendedor' }).click();
  await page.getByLabel('Nome do vendedor').fill('Júlia Moraes');
  await expect(page.getByLabel('Código no caixa')).toHaveValue('1');
  await page.getByLabel('Código no caixa').fill('15');
  await page.getByLabel('Comissão (%)').fill('5');
  await page.getByRole('button', { name: 'Salvar vendedor' }).click();
  await expect(page.getByRole('row', { name: /Júlia Moraes/ })).toContainText('Ativo');
  await expect(page.getByRole('row', { name: /Júlia Moraes/ })).toContainText('5%');

  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Sem internet, o vendedor vem do último retrato.
  await context.setOffline(true);
  await scan(page, '78900035');
  await page.getByRole('button', { name: 'Vendedor' }).click();
  await page.getByLabel('Código ou nome do vendedor').fill('15');
  await page.getByLabel('Código ou nome do vendedor').press('Enter');
  await expect(page.getByTestId('cart-seller')).toHaveText('Vendedor: Júlia Moraes (15)');
  await page.keyboard.press('F10');
  await page.getByLabel('Valor recebido (R$)').fill('120,00');
  await page.getByRole('button', { name: 'Adicionar dinheiro' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  // A venda seguinte começa sem vendedor.
  await expect(page.getByTestId('cart-seller')).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar', {
    timeout: 30_000,
  });
  await page.goto('/');
  await abrirNoMenu(page, 'Relatórios');
  await page
    .getByRole('group', { name: 'Agrupar por' })
    .getByRole('button', { name: 'Vendedor', exact: true })
    .click();
  await expect(page.getByRole('row', { name: /Júlia Moraes/ })).toContainText('R$ 120,00');

  // Comissão: 5% sobre R$ 120,00 pagos.
  await abrirNoMenu(page, 'Comissões');
  await expect(page.getByTestId('commission-total')).toHaveText('R$ 6,00');
  await expect(page.getByRole('row', { name: /Júlia Moraes/ })).toContainText('R$ 120,00');

  // Exceção por categoria aparece na lista e pode ser encerrada.
  await page.getByLabel('Categoria', { exact: true }).fill('Vestidos');
  await page.getByLabel('Comissão da exceção (%)').fill('8');
  await page.getByRole('button', { name: 'Salvar exceção' }).click();
  const excecoes = page.getByRole('list', { name: 'Exceções de comissão' });
  await expect(excecoes).toContainText('Categoria Vestidos · 8%');
  await excecoes.getByRole('button', { name: 'Encerrar' }).click();
  await expect(page.getByText('Nenhuma exceção: vale o % de cada vendedor.')).toBeVisible();
});
