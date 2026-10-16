import { expect, request, test } from '@playwright/test';

/** F5-07: comandas no caixa (abrir, lançar, guardar, dividir e fechar) e na retaguarda. */
test.skip(() => test.info().project.name !== 'web', 'O caixa é o mesmo nas duas cascas.');

test('comandas: abre pela mesa, guarda, divide a conta e fecha; a retaguarda vê as abertas', async ({
  page,
}) => {
  const email = `bia-bar-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Bia Dona',
        businessName: `Bar ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  await api.post('products', {
    headers,
    data: { name: 'Cerveja 600 ml', priceCents: 1200, barcodes: ['7891149101009'] },
  });
  await api.post('products', {
    headers,
    data: { name: 'Porção de fritas', priceCents: 3500, barcodes: ['7891000053508'] },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Bar 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  const bipar = async (codigo: string) => {
    await campo.fill(codigo);
    await campo.press('Enter');
  };
  const abrirComanda = async (nome: string) => {
    await page.getByRole('button', { name: 'Comandas' }).click();
    await page.getByLabel('Nova comanda (mesa ou número)').fill(nome);
    await page.getByRole('button', { name: 'Abrir comanda' }).click();
    await expect(page.getByTestId('tab-label')).toHaveText(`Comanda ${nome}`);
  };

  // Mesa 7: primeira rodada, guardada.
  await abrirComanda('Mesa 7');
  await bipar('7891149101009');
  await bipar('7891149101009');
  await page.getByRole('button', { name: 'Guardar na comanda' }).click();
  await expect(page.getByText('Comanda Mesa 7 guardada.')).toBeVisible();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  // Mesa 8 aberta e guardada.
  await abrirComanda('Mesa 8');
  await bipar('7891000053508');
  await page.getByRole('button', { name: 'Guardar na comanda' }).click();

  // Mesa 7 volta: mais uma porção, a conta dividida por 2 e paga.
  await page.getByRole('button', { name: 'Comandas' }).click();
  const lista = page.getByRole('list', { name: 'Comandas abertas' });
  await expect(lista.getByRole('listitem').filter({ hasText: 'Mesa 7' })).toContainText('R$ 24,00');
  await lista
    .getByRole('listitem')
    .filter({ hasText: 'Mesa 7' })
    .getByRole('button', {
      name: 'Abrir',
    })
    .click();
  await bipar('7891000053508');
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 59,00');
  await expect(page.getByTestId('tab-split')).toContainText('R$ 29,50 cada');
  await page.getByRole('button', { name: 'Mais uma pessoa' }).click();
  await expect(page.getByTestId('tab-split')).toContainText('R$ 19,67');
  await page.getByRole('button', { name: 'Pagar (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText('Bipaê! Venda nº 1 concluída.')).toBeVisible();

  // A retaguarda vê só a Mesa 8 aberta, depois que o caixa sincroniza.
  await expect(async () => {
    await page.getByTestId('sync-status').click();
    const abertas = await (await api.get('tabs', { headers })).json();
    expect(abertas.map((t: { label: string }) => t.label)).toEqual(['Mesa 8']);
  }).toPass({ timeout: 45_000 });
  await page.goto('/comandas');
  await expect(page.getByTestId('tabs-total')).toHaveText('1 comanda aberta · R$ 35,00 em consumo');
  await expect(page.getByRole('row', { name: /Mesa 8/ })).toContainText('1 Porção de fritas');
});
