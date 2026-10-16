import { expect, request, test } from '@playwright/test';

/** F6-08.a: a venda com CPF vira histórico na ficha do cliente e entra no Relacionamento. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('venda com CPF aparece na ficha e no Relacionamento', async ({ page }) => {
  const email = `crm-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Empório ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Queijo Minas', priceCents: 3290, barcodes: ['7891000100103'] },
  });
  await api.post('customers', {
    headers,
    data: {
      name: 'Marta Souza',
      taxId: '12345678909',
      email: 'marta@exemplo.com.br',
      marketingConsent: true,
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Venda com o CPF da cliente.
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
  await page.getByRole('button', { name: 'CPF na nota (F6)' }).click();
  await page.getByLabel('CPF ou CNPJ do cliente').fill('12345678909');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();
  await expect(async () => {
    await page.getByTestId('sync-status').click();
    const lista = await (await api.get('crm/customers', { headers })).json();
    expect(lista.items).toHaveLength(1);
  }).toPass({ timeout: 45_000 });

  // Relacionamento: a cliente é nova e aceita ofertas.
  await page.goto('/relacionamento');
  await expect(page.getByRole('button', { name: 'Novos (1)' })).toBeVisible();
  const linha = page.getByRole('row', { name: /Marta Souza/ });
  await expect(linha).toContainText('Novos');
  await expect(linha).toContainText('R$ 32,90');
  await expect(linha).toContainText('Aceita');
  await page.getByRole('button', { name: 'Sumidos (0)' }).click();
  await expect(page.getByText('Já compraram, mas não nos últimos 60 dias.')).toBeVisible();
  await expect(page.getByText('Ninguém por aqui ainda')).toBeVisible();

  // A lista para ofertas sai em CSV, só com quem aceitou.
  await page.getByRole('button', { name: 'Todos' }).click();
  const [arquivo] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Lista para ofertas (CSV)' }).click(),
  ]);
  expect(arquivo.suggestedFilename()).toBe('clientes-ofertas.csv');

  // A ficha da cliente mostra o histórico.
  await page.goto('/clientes');
  await page.getByRole('row', { name: /Marta Souza/ }).click();
  const historico = page.getByRole('region', { name: 'Histórico de compras' });
  await expect(historico).toContainText('R$ 32,90');
  await expect(historico.getByRole('list', { name: 'O que mais compra' })).toContainText(
    'Queijo Minas',
  );
});
