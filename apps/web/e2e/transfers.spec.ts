import { expect, request, test } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * F4-12: a tela de transferência entre lojas, do envio ao recebimento com diferença.
 * A conta nova é do plano Grátis (uma loja só), então as rotas de lojas e de transferências são
 * simuladas aqui; o estoque saindo e entrando de verdade é provado em apps/api/test/transfers.
 */
/** Espelho mínimo de StockTransferView (@bipae/domain) para as respostas simuladas. */
interface StockTransferView {
  id: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  status: 'in_transit' | 'received' | 'cancelled';
  note: string | null;
  needsInvoice: boolean;
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: {
    productId: string;
    productName: string;
    unit: string;
    quantityMilli: number;
    receivedMilli: number | null;
  }[];
}

test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('envia mercadoria para a filial e confirma o recebimento', async ({ page }) => {
  const email = `davi-transf-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Davi Dono',
        businessName: `Rede ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [matriz] = await (await api.get('stores', { headers })).json();
  const filial = { id: '0190a0e4-0000-7000-8000-0000000000f1', name: 'Filial Praia' };
  await api.post('products', { headers, data: { name: 'Óleo de soja', priceCents: 799 } });

  const transfers: StockTransferView[] = [];
  let enviado: unknown = null;
  let recebido: unknown = null;
  await page.route(/\/v1\/stores$/, (route) => route.fulfill({ json: [matriz, filial] }));
  await page.route(/\/v1\/stock\/transfers(\/[^/]+\/receive)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: transfers });
    const body = req.postDataJSON();
    if (req.url().endsWith('/receive')) {
      recebido = body;
      const t = transfers[0]!;
      t.status = 'received';
      t.receivedAt = new Date().toISOString();
      t.items = t.items.map((i) => ({
        ...i,
        receivedMilli: body.items.find((r: { productId: string }) => r.productId === i.productId)
          .receivedMilli,
      }));
      return route.fulfill({ json: t });
    }
    enviado = body;
    const t: StockTransferView = {
      id: '0190a0e4-0000-7000-8000-0000000000a1',
      fromStoreId: matriz.id,
      fromStoreName: matriz.name,
      toStoreId: filial.id,
      toStoreName: filial.name,
      status: 'in_transit',
      note: null,
      needsInvoice: false,
      createdAt: new Date().toISOString(),
      receivedAt: null,
      cancelledAt: null,
      cancelReason: null,
      items: body.items.map((i: { productId: string; quantityMilli: number }) => ({
        ...i,
        productName: 'Óleo de soja',
        unit: 'UN',
        receivedMilli: null,
      })),
    };
    transfers.unshift(t);
    return route.fulfill({ status: 201, json: t });
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await abrirNoMenu(page, 'Transferências');
  await expect(page.getByText('Nenhuma transferência ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Nova transferência' }).click();
  await expect(page.getByLabel('Vai para a loja')).toHaveValue(filial.id);
  await page.getByLabel('Adicionar produto').fill('óleo');
  await page.getByRole('button', { name: 'Óleo de soja' }).click();
  await page.getByLabel('Quantidade de Óleo de soja (UN)').fill('12');
  await page.getByRole('button', { name: 'Enviar mercadoria' }).click();

  const linha = page.getByRole('row', { name: /Filial Praia/ });
  await expect(linha).toContainText('Em trânsito');
  expect(enviado).toMatchObject({
    fromStoreId: matriz.id,
    toStoreId: filial.id,
    items: [{ quantityMilli: 12_000 }],
  });

  await linha.click();
  await page.getByLabel('Chegou de Óleo de soja (UN)').fill('11');
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByRole('row', { name: /Filial Praia/ })).toContainText('Recebida');
  expect(recebido).toMatchObject({ items: [{ receivedMilli: 11_000 }] });

  await page.getByRole('row', { name: /Filial Praia/ }).click();
  await expect(page.getByText('Enviado: 12 UN · chegou: 11 UN')).toBeVisible();
});
