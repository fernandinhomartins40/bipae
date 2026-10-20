import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F5-12.c.3: as notas do Ajuste SINIEF 02/18 aparecem no condicional e abrem na tela da NF-e. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

test('com o perfil da venda condicional, a remessa sai com as peças', async ({ page }) => {
  const email = `loja-cond-nfe-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rita Dona',
        businessName: `Ateliê ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [empresa] = await (await api.get('companies', { headers })).json();
  const [loja] = await (await api.get('stores', { headers })).json();
  const perfil = async (data: Record<string, string>) =>
    (await api.post('fiscal-profiles', { headers, data })).json();
  const venda = await perfil({
    name: 'Confecções',
    cfopInterna: '5102',
    csosn: '102',
    cClassTrib: '000001',
  });
  await perfil({
    name: 'Condicional (demonstração)',
    cfopInterna: '5912',
    csosn: '400',
    cClassTrib: '000001',
  });
  await api.patch(`companies/${empresa.id}`, {
    headers,
    data: {
      legalName: 'Ateliê Bipaê LTDA',
      taxId: '11.222.333/0001-81',
      uf: 'SP',
      taxRegime: 'simples',
      ie: '111.222.333.444',
      street: 'Rua das Flores',
      streetNumber: '100',
      district: 'Centro',
      cityCode: '3550308',
      cep: '01001-000',
    },
  });
  const vestido = await (
    await api.post('products', {
      headers,
      data: {
        name: 'Vestido Floral — M',
        priceCents: 18_990,
        ncm: '62044200',
        fiscalProfileId: venda.id,
      },
    })
  ).json();
  await api.post('stock/adjustments', {
    headers,
    data: { productId: vestido.id, storeId: loja.id, mode: 'adjustment', quantityMilli: 3000 },
  });
  await api.post('customers', {
    headers,
    data: {
      name: 'Joana Prado',
      taxId: '12345678909',
      address: {
        cep: '01002000',
        street: 'Rua das Acácias',
        number: '45',
        district: 'Centro',
        city: 'São Paulo',
        uf: 'SP',
        ibgeCode: '3550308',
      },
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // A empresa escolhe o perfil fiscal das notas com imposto suspenso.
  await menu(page, 'Empresas e lojas');
  await page
    .getByRole('button', { name: /Editar/ })
    .first()
    .click();
  const empresaForm = page.getByRole('dialog');
  await empresaForm
    .getByLabel('Perfil fiscal da venda condicional')
    .selectOption({ label: 'Condicional (demonstração)' });
  await empresaForm.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(empresaForm).toBeHidden();

  await menu(page, 'Condicional');
  await page.getByRole('button', { name: 'Novo condicional' }).click();
  const gaveta = page.getByRole('dialog');
  await expect(gaveta.getByText('Notas pelo Bipaê')).toBeVisible();
  await gaveta.getByLabel('Cliente').fill('Joana');
  await gaveta.getByRole('button', { name: 'Joana Prado' }).click();
  await gaveta.getByLabel('Adicionar peça').fill('Vestido');
  await gaveta.getByRole('button', { name: /Vestido/ }).click();
  await gaveta.getByRole('button', { name: 'Registrar a saída' }).click();

  // Sem o certificado A1, a remessa foi numerada e espera a configuração.
  await page.getByRole('row', { name: /Joana Prado/ }).click();
  const notas = page.getByRole('list', { name: 'Notas do condicional' });
  await expect(notas).toContainText('Remessa para demonstração (CFOP 5.912)');
  await expect(notas).toContainText('Falta configurar');
  await notas.getByRole('link', { name: 'Abrir na NF-e' }).click();
  await expect(page).toHaveURL(/\/nfe\?abrir=/);
  await expect(
    page
      .getByRole('dialog')
      .getByText('A empresa ainda não tem certificado digital A1 cadastrado.'),
  ).toBeVisible();
});
