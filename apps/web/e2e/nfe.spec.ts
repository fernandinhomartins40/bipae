import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F3-33.c: NF-e da retaguarda, do rascunho conferido à emissão. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

test('preenche a NF-e para uma empresa, vê o que falta, confere e emite', async ({ page }) => {
  const email = `loja-nfe-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Paulo Dono',
        businessName: `Distribuidora ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [empresa] = await (await api.get('companies', { headers })).json();
  await api.patch(`companies/${empresa.id}`, {
    headers,
    data: {
      legalName: 'Distribuidora Bipaê LTDA',
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
  const perfil = await (
    await api.post('fiscal-profiles', {
      headers,
      data: {
        name: 'Mercearia',
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        csosn: '102',
        cClassTrib: '000001',
      },
    })
  ).json();
  const arroz = await (
    await api.post('products', {
      headers,
      data: {
        name: 'Arroz tipo 1 5kg',
        priceCents: 2500,
        ncm: '10063021',
        fiscalProfileId: perfil.id,
      },
    })
  ).json();
  await api.post('customers', {
    headers,
    data: {
      name: 'Mercado do Bairro LTDA',
      taxId: '11444777000161',
      address: {
        cep: '01430000',
        street: 'Avenida Brasil',
        number: '2000',
        district: 'Jardim América',
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
  await menu(page, 'NF-e');
  await expect(page.getByText('Nenhuma NF-e ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Nova NF-e' }).click();
  const gaveta = page.getByRole('dialog');
  await gaveta.getByLabel('Buscar no cadastro de clientes').fill('Mercado');
  await gaveta.getByRole('button', { name: /Mercado do Bairro LTDA/ }).click();
  await expect(gaveta.getByLabel('Nome ou razão social')).toHaveValue('Mercado do Bairro LTDA');
  await expect(gaveta.getByText(/Escolhido: São Paulo - SP/)).toBeVisible();
  await gaveta.getByLabel('Adicionar produto').fill('Arroz');
  await gaveta.getByRole('button', { name: /Arroz tipo 1 5kg/ }).click();
  await gaveta.getByLabel('Quantidade de Arroz tipo 1 5kg (UN)').fill('10');
  // Contribuinte sem o número da inscrição: o motor aponta o que falta.
  await gaveta.getByRole('button', { name: 'Salvar rascunho e conferir' }).click();
  await expect(gaveta.getByText('Falta resolver antes de emitir')).toBeVisible();
  await expect(
    gaveta.getByText('Destinatário contribuinte do ICMS precisa da inscrição estadual.'),
  ).toBeVisible();
  await expect(gaveta.getByRole('button', { name: 'Emitir NF-e' })).toBeDisabled();

  await gaveta.getByLabel('Número da inscrição estadual').fill('111.222.333.444');
  await gaveta.getByRole('button', { name: 'Salvar e conferir' }).click();
  await expect(gaveta.getByText('Pronta para emitir')).toBeVisible();
  await expect(gaveta.getByText(/total de R\$ 250,00/)).toBeVisible();

  // Sem o certificado A1 a nota é numerada e fica em "falta configurar", com o motivo.
  await gaveta.getByRole('button', { name: 'Emitir NF-e' }).click();
  await expect(gaveta.getByRole('status').getByText('Falta configurar')).toBeVisible();
  await expect(
    gaveta.getByText('A empresa ainda não tem certificado digital A1 cadastrado.'),
  ).toBeVisible();
  await expect(gaveta.getByText(/Série 1 · nº 1/)).toBeVisible();
  await page.keyboard.press('Escape');
  const linha = page.getByRole('row', { name: /Mercado do Bairro/ });
  await expect(linha).toContainText('1 (série 1)');
  await expect(linha).toContainText('Falta configurar');

  // Ao emitir, a mercadoria saiu do estoque da loja (F3-33.e).
  const estoque = await (await api.get(`stock?productId=${arroz.id}`, { headers })).json();
  expect(estoque.reduce((t: number, r: { quantityMilli: number }) => t + r.quantityMilli, 0)).toBe(
    -10_000,
  );
});

test('devolução de compra: cada produto diz o item da nota do fornecedor (VC02-14)', async ({
  page,
}) => {
  const email = `loja-devolucao-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Paulo Dono',
        businessName: `Distribuidora ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [empresa] = await (await api.get('companies', { headers })).json();
  await api.patch(`companies/${empresa.id}`, {
    headers,
    data: {
      legalName: 'Distribuidora Bipaê LTDA',
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
  const perfil = await (
    await api.post('fiscal-profiles', {
      headers,
      data: {
        name: 'Mercearia',
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        csosn: '102',
        cClassTrib: '000001',
      },
    })
  ).json();
  await api.post('products', {
    headers,
    data: {
      name: 'Feijão carioca 1kg',
      priceCents: 800,
      ncm: '07133319',
      fiscalProfileId: perfil.id,
    },
  });
  await api.post('customers', {
    headers,
    data: {
      name: 'Atacado Fornecedor LTDA',
      taxId: '11444777000161',
      address: {
        cep: '01430000',
        street: 'Avenida Brasil',
        number: '2000',
        district: 'Jardim América',
        city: 'São Paulo',
        uf: 'SP',
        ibgeCode: '3550308',
      },
    },
  });
  const chave = '35261011444777000161550010000043211123456789';

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'NF-e');
  await page.getByRole('button', { name: 'Nova NF-e' }).click();
  const gaveta = page.getByRole('dialog');
  await gaveta.getByLabel('Finalidade').selectOption('devolucao');
  await gaveta.getByLabel('Chave da nota devolvida').fill(chave);
  await gaveta.getByLabel('Buscar no cadastro de clientes').fill('Atacado');
  await gaveta.getByRole('button', { name: /Atacado Fornecedor LTDA/ }).click();
  await gaveta.getByLabel('Número da inscrição estadual').fill('111.222.333.444');
  await gaveta.getByLabel('Adicionar produto').fill('Feijão');
  await gaveta.getByRole('button', { name: /Feijão carioca 1kg/ }).click();
  await gaveta.getByLabel('CFOP de Feijão carioca 1kg (opcional)').fill('5202');
  await gaveta.getByLabel('Forma de pagamento').selectOption('90');

  // Sem o número do item na nota do fornecedor, a devolução não sai (NT 2025.002, VC02-14).
  await gaveta.getByRole('button', { name: 'Salvar rascunho e conferir' }).click();
  await expect(
    gaveta.getByText('Item 1: informe de qual nota e de qual item ele é devolvido'),
  ).toBeVisible();

  await gaveta.getByLabel('Item de Feijão carioca 1kg na nota devolvida').fill('3');
  await gaveta.getByRole('button', { name: 'Salvar rascunho e conferir' }).click();
  await expect(gaveta.getByRole('button', { name: 'Salvar e conferir' })).toBeVisible();
  const [nota] = await (await api.get('fiscal/nfe', { headers })).json();
  expect(nota.purpose).toBe('devolucao');
  expect(nota.references).toEqual([chave]);
  expect(nota.items[0].reference).toEqual({ key: chave, item: 3 });
});

test('busca a inscrição estadual do destinatário na SEFAZ e preenche o endereço', async ({
  page,
}) => {
  const email = `loja-cadastro-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Paulo Dono',
      businessName: `Distribuidora ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });
  // A resposta da SEFAZ é simulada aqui; a conversa real é testada na API.
  let consulta = '';
  await page.route('**/fiscal/sefaz/cadastro**', (route) => {
    consulta = route.request().url();
    return route.fulfill({
      json: {
        uf: 'PR',
        cStat: '111',
        xMotivo: 'Consulta cadastro com uma ocorrencia',
        found: true,
        entries: [
          {
            ie: '1018008064',
            active: true,
            name: 'COMPANHIA DE SANEAMENTO DO PARANA - SANEPAR',
            address: {
              street: 'RUA ENGENHEIROS REBOUCAS',
              number: '1376',
              complement: null,
              district: 'REBOUCAS',
              cityCode: '4106902',
              city: 'CURITIBA',
              cep: '80210040',
            },
          },
        ],
      },
    });
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'NF-e');
  await page.getByRole('button', { name: 'Nova NF-e' }).click();
  const gaveta = page.getByRole('dialog');
  await gaveta.getByLabel('CPF ou CNPJ do destinatário').fill('76.484.013/0001-45');
  await gaveta.getByLabel('UF do destinatário').selectOption('PR');
  await gaveta.getByRole('button', { name: 'Buscar a inscrição estadual na SEFAZ' }).click();
  await expect(gaveta.getByText(/Inscrição estadual 1018008064 \(COMPANHIA/)).toBeVisible();
  expect(consulta).toContain('uf=PR&taxId=76484013000145');
  await expect(gaveta.getByLabel('Número da inscrição estadual')).toHaveValue('1018008064');
  await expect(gaveta.getByLabel('Nome ou razão social')).toHaveValue(
    'COMPANHIA DE SANEAMENTO DO PARANA - SANEPAR',
  );
  await expect(gaveta.getByLabel('Rua')).toHaveValue('RUA ENGENHEIROS REBOUCAS');
  await expect(gaveta.getByLabel('CEP')).toHaveValue('80210040');
});
