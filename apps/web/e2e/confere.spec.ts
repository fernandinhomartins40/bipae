import { expect, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * MF-09: Notas de entrada (Confere). As respostas da API do Bipaê são simuladas aqui; a entrada no
 * estoque e a conversa com o MercadoFlow são testadas na API com um MercadoFlow simulado.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const ENTRY = {
  documentId: 'doc1',
  accessKey: '41261012345678000199550010000123451000012345',
  number: '12345',
  supplierName: 'Distribuidora X',
  checkStatus: 'EM_ANDAMENTO',
  items: [
    {
      item: 1,
      gtin: '7894900010015',
      packGtin: '7894900010220',
      supplierCode: '55406',
      description: 'Coca-Cola Lata 350ml',
      invoiceUnit: 'CX',
      invoiceQuantity: 2,
      unitsPerPack: 6,
      priceVariation: 8,
    },
  ],
};

test('ler pela chave, conferir bipando e dar entrada no estoque', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('João Dono');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`joao-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, João!' })).toBeVisible();

  let termos = false;
  const checks: { counts: Record<string, { counted: number }>; finish: boolean; blind: boolean }[] =
    [];
  await page.route('**/mercadoflow/confere/*/status', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        termsAccepted: termos,
        termsVersion: 'v1',
        termsText: 'Termos do Confere: leia com atenção.',
        balance: 10,
        plans: [],
        certificate: null,
      },
    }),
  );
  await page.route('**/mercadoflow/confere/*/terms', (route) => {
    termos = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/mercadoflow/confere/*/read', (route) =>
    route.fulfill({ json: { documentId: 'doc1', charged: true, balance: 9 } }),
  );
  await page.route('**/mercadoflow/confere/*/documents', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'doc1',
            accessKey: ENTRY.accessKey,
            completeness: 'FULL',
            emitterName: 'Distribuidora X',
            number: '12345',
            issuedAt: '2026-10-10T08:00:00',
            totalValue: 30.2,
            itemsCount: 1,
            checkStatus: null,
          },
        ],
        entries: [],
      },
    }),
  );
  await page.route('**/mercadoflow/confere/*/documents/doc1', (route) =>
    route.fulfill({ json: { document: {}, entry: ENTRY } }),
  );
  await page.route('**/mercadoflow/confere/*/documents/doc1/check', (route) => {
    checks.push(route.request().postDataJSON());
    return route.fulfill({ json: { check: {}, entry: ENTRY } });
  });
  await page.route('**/mercadoflow/confere/*/documents/doc1/entry', (route) =>
    route.fulfill({ json: { status: 'applied', missing: [], applied: 1 } }),
  );
  await page.route('**/mercadoflow/supplier-issues', (route) =>
    route.fulfill({
      json: [
        {
          id: '00000000-0000-7000-8000-000000000009',
          supplierName: 'Distribuidora X',
          invoiceNumber: '12345',
          item: 1,
          description: 'Coca-Cola Lata 350ml',
          kind: 'AVARIA',
          expectedMilli: 12000,
          receivedMilli: 12000,
          status: 'aberta',
        },
      ],
    }),
  );

  await abrirNoMenu(page, 'Notas de entrada');
  await expect(page.getByText('Termos do Confere: leia com atenção.')).toBeVisible();
  await page.getByRole('button', { name: 'Aceito' }).click();
  await expect(page.getByText(/Saldo: 10 leitura/)).toBeVisible();

  await page.getByLabel('Ler pela chave (bipe o DANFE)').fill(ENTRY.accessKey);
  await page.getByRole('button', { name: 'Ler', exact: true }).click();
  await expect(page.getByText('Nota lida. Saldo: 9 leitura(s).')).toBeVisible();

  await page.getByRole('cell', { name: 'Distribuidora X' }).click();
  const gaveta = page.getByRole('dialog', { name: 'Conferência da NF-e 12345' });
  // Conferência cega: a quantidade da nota não aparece.
  await expect(gaveta.getByText('Nota: 2 CX')).toHaveCount(0);
  const bipe = gaveta.getByLabel('Bipe o produto ou a caixa');
  await bipe.fill('7894900010220');
  await bipe.press('Enter');
  await expect(gaveta.getByLabel('Contei (item 1)')).toHaveValue('1');
  await bipe.fill('7894900010015');
  await bipe.press('Enter');
  await expect(gaveta.getByText('Isto é 1 unidade; a nota está em cx de 6.')).toBeVisible();
  await bipe.fill('7894900010220');
  await bipe.press('Enter');
  await expect(gaveta.getByLabel('Contei (item 1)')).toHaveValue('2');
  await expect(gaveta.getByText('Preço subiu mais de 5%: Coca-Cola Lata 350ml')).toBeVisible();

  await gaveta.getByRole('button', { name: 'Concluir conferência e dar entrada' }).click();
  await expect(gaveta.getByText('Entrada feita: 1 item(ns) no estoque.')).toBeVisible();
  expect(checks.at(-1)).toMatchObject({
    counts: { '1': { counted: 2 } },
    finish: true,
    blind: true,
  });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Pendências com fornecedor' }).click();
  await expect(page.getByRole('cell', { name: '1. Coca-Cola Lata 350ml' })).toBeVisible();
  await expect(page.getByText('Avaria')).toBeVisible();
});

test('nota chegando: contador no menu some quando a tela de notas abre (MF-14)', async ({
  page,
}) => {
  let visto = false;
  await page.route('**/v1/mercadoflow/confere-notices', (route) =>
    route.fulfill({
      json: visto
        ? { unseen: 0, items: [] }
        : {
            unseen: 2,
            items: [
              {
                id: '00000000-0000-7000-8000-0000000000a1',
                storeId: '00000000-0000-7000-8000-000000000001',
                documentId: 'doc1',
                supplierName: 'Distribuidora X',
                invoiceNumber: '12345',
                totalCents: 183450,
                itemsCount: 12,
                receivedAt: '2026-10-14T08:00:00Z',
              },
            ],
          },
    }),
  );
  await page.route('**/mercadoflow/confere/*/notices/seen', (route) => {
    visto = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/mercadoflow/confere/*/status', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        termsAccepted: true,
        termsVersion: 'v1',
        termsText: 'Termos',
        balance: 10,
        plans: [],
        certificate: null,
      },
    }),
  );
  await page.route('**/mercadoflow/confere/*/documents', (route) =>
    route.fulfill({ json: { items: [], entries: [] } }),
  );
  await page.route('**/mercadoflow/supplier-issues', (route) => route.fulfill({ json: [] }));

  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();

  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(menu.getByLabel('2 notas novas para conferir')).toBeVisible();
  await abrirNoMenu(page, /Notas de entrada/);
  await expect(menu.getByLabel('2 notas novas para conferir')).toHaveCount(0);
  expect(visto).toBe(true);
});
