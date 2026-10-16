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
    lastSalesSyncAt: null,
    salesPausedUntil: null,
    autoApply: { prices: false, promotions: false },
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

test('card do Tino no painel inicial abre as decisões no MercadoFlow (MF-10)', async ({ page }) => {
  await page.route('**/v1/mercadoflow/decisions', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        stores: [
          {
            storeId: '00000000-0000-7000-8000-000000000001',
            storeName: 'Loja Centro',
            status: 'ok',
            total: 7,
            byActionType: { COMPRAR: 4, PRECIFICAR: 3 },
            expectedImpactCents: 123450,
            lockedByPlan: false,
            url: 'https://mercadoflow.com/app/decisoes',
            items: [
              {
                id: 'd1',
                actionType: 'COMPRAR',
                title: 'Comprar arroz antes de acabar',
                rationale: 'Gira 30 por semana e restam 8',
                gtin: '7891000315507',
                productName: 'Arroz 5kg',
                expectedImpactCents: 21010,
                url: 'https://mercadoflow.com/app/decisoes/d1',
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Joana Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`joana-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Joana!' })).toBeVisible();

  const card = page.getByRole('region', { name: 'Tino: Loja Centro' });
  await expect(card.getByText('7 decisões')).toBeVisible();
  await expect(card.getByText('(R$ 1.234,50 em jogo)')).toBeVisible();
  await expect(card.getByText('Comprar: 4')).toBeVisible();
  await expect(card.getByText('Comprar arroz antes de acabar')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Ver no MercadoFlow' })).toHaveAttribute(
    'href',
    'https://mercadoflow.com/app/decisoes/d1',
  );
});

test('preço aprovado no MercadoFlow espera o gerente aplicar (MF-11.a)', async ({ page }) => {
  let pendentes = [
    {
      id: '0192a000-0000-7000-8000-0000000000a1',
      storeId: '00000000-0000-7000-8000-000000000001',
      storeName: 'Loja Centro',
      kind: 'price',
      problem: null,
      data: {
        gtin: '7891000100103',
        productId: '0192a000-0000-7000-8000-0000000000b1',
        productName: 'Leite integral 1 L',
        priceCents: 529,
        currentPriceCents: 549,
        approvedBy: 'Ana Gerente',
      },
      updatedAt: new Date().toISOString(),
    },
  ];
  let aplicado = false;
  let automatico: unknown = null;
  await page.route('**/v1/mercadoflow', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        termsUrl: null,
        publicUrl: 'https://mercadoflow.com',
        stores: [
          {
            storeId: '00000000-0000-7000-8000-000000000001',
            storeName: 'Loja Centro',
            status: 'ATIVA',
            marketId: 'mk_1',
            scopes: ['prices:read'],
            createdVia: 'ACCOUNT',
            connectUrl: null,
            connectedAt: null,
            lastError: null,
            lastSalesSyncAt: null,
            salesPausedUntil: null,
            autoApply: { prices: automatico === true, promotions: false },
            customerActive: true,
            discount: null,
          },
        ],
        queue: { pending: 0, sent: 0, rejected: 0 },
        errors: [],
      },
    }),
  );
  await page.route('**/v1/mercadoflow/pendings', (route) => route.fulfill({ json: pendentes }));
  await page.route('**/v1/mercadoflow/pendings/*/apply', (route) => {
    aplicado = true;
    pendentes = [];
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/v1/mercadoflow/links/*/auto-apply', (route) => {
    automatico = (route.request().postDataJSON() as { prices: boolean }).prices;
    return route.fulfill({ json: { prices: automatico, promotions: false } });
  });

  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();
  await page.goto('/mercadoflow');

  const precos = page.getByRole('region', { name: 'Preços aprovados no MercadoFlow' });
  const linha = precos.getByRole('row', { name: /Leite integral 1 L/ });
  await expect(linha).toContainText('R$ 5,49');
  await expect(linha).toContainText('R$ 5,29');
  await expect(linha).toContainText('Ana Gerente');
  await linha.getByRole('button', { name: 'Aplicar' }).click();
  await expect(precos).toHaveCount(0);
  expect(aplicado).toBe(true);

  const opcao = page.getByLabel('Aplicar sozinho os preços aprovados no MercadoFlow');
  await opcao.click();
  await expect.poll(() => automatico).toBe(true);
  await expect(opcao).toBeChecked();
});
