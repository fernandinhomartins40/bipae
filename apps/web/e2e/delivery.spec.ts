import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F5-10: bairro com taxa na retaguarda, venda para entrega no caixa e a entrega até o fim. */
test.skip(() => test.info().project.name !== 'web', 'O caixa é o mesmo nas duas cascas.');

test('delivery: taxa do bairro somada no caixa e a entrega acompanhada', async ({ page }) => {
  const email = `davi-delivery-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Davi Dono',
        businessName: `Pizzaria ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Pizza grande', priceCents: 5900, barcodes: ['7891000100103'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Bairro com a taxa, na retaguarda.
  await abrirNoMenu(page, 'Delivery');
  const bairros = page.getByRole('region', { name: 'Bairros atendidos' });
  await bairros.getByLabel('Bairro').fill('Centro');
  await bairros.getByLabel('Taxa (R$)').fill('6,50');
  await bairros.getByRole('button', { name: 'Adicionar bairro' }).click();
  await expect(bairros.getByRole('row', { name: /Centro/ })).toContainText('R$ 6,50');

  // Venda para entrega no caixa.
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Balcão');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7891000100103');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Entrega', exact: true }).click();
  await expect(page.getByLabel('Bairro da entrega')).toContainText('Centro · R$ 6,50');
  await page.getByLabel('CPF ou CNPJ na nota').fill('123.456.789-09');
  await page.getByLabel('Quem recebe').fill('Carla Cliente');
  await page.getByLabel('Telefone').fill('(11) 98888-7777');
  await page.getByLabel('Rua').fill('Rua das Flores');
  await page.getByLabel('Número').fill('45');
  await page.getByRole('button', { name: /Confirmar entrega/ }).click();
  await expect(page.getByTestId('delivery-fee')).toHaveText('Taxa de entrega: R$ 6,50');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 65,50');
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('sync-status').click();
    const entregas = await (await api.get('deliveries', { headers })).json();
    expect(entregas).toHaveLength(1);
  }).toPass({ timeout: 45_000 });

  // A entrega, até o fim.
  await page.goto('/delivery');
  const entregas = page.getByRole('region', { name: 'Entregas do dia' });
  const linha = entregas.getByRole('row', { name: /Carla Cliente/ });
  await expect(linha).toContainText('(11) 98888-7777');
  await expect(linha).toContainText('Rua das Flores, 45, Centro');
  await expect(linha).toContainText('R$ 65,50');
  await expect(linha).toContainText('A sair');
  await linha.getByRole('button', { name: 'Saiu para entrega' }).click();
  await expect(linha).toContainText('Saiu para entrega');
  await linha.getByRole('button', { name: 'Entregue' }).click();
  await expect(linha).toContainText('Entregue');
});
