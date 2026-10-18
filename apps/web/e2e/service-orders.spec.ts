import { expect, request, test, type Page } from '@playwright/test';

/** F5-13.c: cadastro de serviço e ordem de serviço, da abertura à entrega. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name }).click();

test('cadastra o serviço pela lista nacional, abre a OS e entrega', async ({ page }) => {
  const email = `oficina-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Caio Dono',
        businessName: `Oficina ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [loja] = await (await api.get('stores', { headers })).json();
  const oleo = await (
    await api.post('products', { headers, data: { name: 'Óleo 5W30 1L', priceCents: 4500 } })
  ).json();
  await api.post('stock/adjustments', {
    headers,
    data: { productId: oleo.id, storeId: loja.id, mode: 'adjustment', quantityMilli: 10_000 },
  });
  await api.post('customers', { headers, data: { name: 'Joana Prado', taxId: '12345678909' } });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await menu(page, 'Serviços');
  await page.getByRole('button', { name: 'Novo serviço' }).click();
  const cadastro = page.getByRole('dialog');
  await cadastro.getByLabel('Nome do serviço').fill('Troca de óleo');
  await cadastro.getByLabel('Código na lista nacional de serviços').fill('14.01');
  await cadastro.getByRole('button', { name: /^14\.01\.01/ }).click();
  await expect(cadastro.getByText('Código nacional 14.01.01')).toBeVisible();
  await cadastro.getByLabel('Alíquota do ISS no município (%)').fill('2,5');
  await cadastro.getByLabel('Preço').fill('80,00');
  await cadastro.getByLabel('Preço').blur();
  await cadastro.getByRole('button', { name: 'Salvar serviço' }).click();
  await expect(page.getByRole('row', { name: /Troca de óleo/ })).toContainText('14.01.01');

  await menu(page, 'Ordens de serviço');
  await expect(page.getByText('Nenhuma ordem de serviço ainda')).toBeVisible();
  await page.getByRole('button', { name: 'Nova OS' }).click();
  const os = page.getByRole('dialog');
  await os.getByLabel('Cliente', { exact: true }).fill('Joana');
  await os.getByRole('button', { name: 'Joana Prado' }).click();
  await os.getByLabel('Equipamento ou objeto').fill('Moto Honda CG 160');
  await os.getByLabel('Defeito ou pedido do cliente').fill('Barulho no motor');
  await os.getByLabel('Adicionar serviço').selectOption({ label: 'Troca de óleo · R$ 80,00' });
  await os.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await os.getByLabel('Adicionar peça').fill('Óleo');
  await os.getByRole('button', { name: /Óleo 5W30 1L/ }).click();
  await os.getByLabel('Quantidade de Óleo 5W30 1L').fill('2');
  await expect(os.getByText('R$ 170,00')).toBeVisible();
  await os.getByRole('button', { name: 'Abrir a OS' }).click();
  await expect(os.getByText('Aberta em')).toBeVisible();

  await os.getByLabel('Situação').selectOption('ready');
  await expect(os.getByText('Pronta para retirar').first()).toBeVisible();
  await os.getByRole('button', { name: 'Entregar ao cliente' }).click();
  await expect(os.getByText(/foi para as contas a receber/)).toBeVisible();
  // NFS-e dos serviços: sem o certificado A1, a nota explica o que falta (F5-13.e).
  const nfse = os.getByRole('region', { name: 'NFS-e Nacional dos serviços' });
  await expect(nfse).toContainText('R$ 80,00');
  await nfse.getByRole('button', { name: 'Emitir NFS-e' }).click();
  await expect(nfse.getByText('Falta configurar')).toBeVisible();
  await expect(
    nfse.getByText('A empresa ainda não tem certificado digital A1 cadastrado.'),
  ).toBeVisible();
  await expect(nfse.getByText(/DPS série 1 · nº 1/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row', { name: /Joana Prado/ })).toContainText('Entregue');

  const estoque = await (await api.get(`stock?productId=${oleo.id}`, { headers })).json();
  expect(estoque.reduce((t: number, r: { quantityMilli: number }) => t + r.quantityMilli, 0)).toBe(
    8_000,
  );
});
