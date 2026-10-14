import { expect, test } from '@playwright/test';

/**
 * MF-04: tela "MercadoFlow". As respostas da API do Bipaê são simuladas aqui; a conversa com o
 * MercadoFlow (criar conta, vínculo, desconto) é testada na API com um MercadoFlow simulado.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('criar a conta MercadoFlow pela loja e ver o desconto', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Maria Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  const email = `maria-${Date.now()}@exemplo.com.br`;
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Maria!' })).toBeVisible();

  let criada = false;
  let pedido: Record<string, unknown> | null = null;
  const loja = (ativa: boolean) => ({
    storeId: '00000000-0000-7000-8000-000000000001',
    storeName: 'Loja Centro',
    status: ativa ? 'ATIVA' : null,
    marketId: ativa ? 'mk_1' : null,
    scopes: ativa ? ['sales:write', 'confere:use'] : [],
    createdVia: ativa ? 'ACCOUNT' : null,
    connectUrl: null,
    connectedAt: null,
    lastError: null,
    customerActive: ativa ? true : null,
    discount: ativa ? { active: true, partner: 'Bipae', percent: 20 } : null,
  });
  await page.route('**/v1/mercadoflow', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        termsUrl: null,
        publicUrl: 'https://mercadoflow.com',
        stores: [loja(criada)],
        queue: { pending: 0, sent: 3, rejected: 0 },
        errors: [],
      },
    }),
  );
  await page.route('**/v1/mercadoflow/accounts', async (route) => {
    pedido = route.request().postDataJSON() as Record<string, unknown>;
    if (!pedido.acceptTerms) {
      return route.fulfill({
        status: 400,
        json: {
          statusCode: 400,
          code: 'validation',
          message: 'Para criar a conta, marque a autorização e o aceite dos termos do MercadoFlow',
        },
      });
    }
    criada = true;
    return route.fulfill({ status: 201, json: { status: 'CRIADA', email } });
  });

  await page.getByRole('link', { name: 'MercadoFlow' }).click();
  await expect(
    page.getByText('Clientes Bipaê têm desconto no plano do MercadoFlow.'),
  ).toBeVisible();
  await expect(page.getByText('Sem vínculo')).toBeVisible();
  await page.getByRole('button', { name: 'Criar minha conta MercadoFlow' }).click();
  await page.getByLabel('Telefone com DDD').fill('(41) 99999-0000');
  await page.getByRole('button', { name: 'Criar a conta' }).click();
  await expect(
    page.getByText('Para criar a conta, marque a autorização e o aceite dos termos do MercadoFlow'),
  ).toBeVisible();

  await page.getByLabel(/Autorizo a criação da conta no MercadoFlow/).check();
  await page.getByRole('button', { name: 'Criar a conta' }).click();
  await expect(
    page.getByText(
      `Conta criada! Enviamos para ${email} o link para criar a senha do MercadoFlow.`,
    ),
  ).toBeVisible();
  expect(pedido).toMatchObject({ phone: '(41) 99999-0000', acceptTerms: true });
  await expect(page.getByText('Vinculada')).toBeVisible();
  await expect(
    page.getByText('Desconto de cliente Bipaê: 20% no plano do MercadoFlow.'),
  ).toBeVisible();
  await expect(page.getByText('0 na fila · 3 enviados · 0 recusados')).toBeVisible();
});
