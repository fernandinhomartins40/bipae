import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/**
 * F1-05: escolha das lojas de cada pessoa na tela da equipe. O bloqueio de outra loja (caixas,
 * vendas, estoque) está provado nos testes da API (test/store-permissions.test.ts), com duas
 * lojas; aqui a conta é do plano Grátis, que tem uma loja só.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const SENHA = 'senha-forte-123';
const menu = (page: Page, name: string) => abrirNoMenu(page, name);

async function entrar(page: Page, email: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('o dono escolhe as lojas da operadora na tela da equipe', async ({ page, browser }) => {
  // Conta com um caixa e uma operadora, preparada direto pela API.
  const marca = Date.now();
  const dono = `dono-lojas-${marca}@exemplo.com.br`;
  const operadora = `bia-lojas-${marca}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Davi Dono',
        businessName: `Mercado ${marca}`,
        email: dono,
        password: SENHA,
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  const [loja] = await (await api.get('stores', { headers })).json();
  await api.post('terminals', {
    headers,
    data: { storeId: loja.id, name: 'Caixa Centro', platform: 'web' },
  });
  const papeis = (await (await api.get('roles', { headers })).json()) as {
    id: string;
    systemKey: string;
  }[];
  await api.post('members', {
    headers,
    data: {
      name: 'Bia Caixa',
      email: operadora,
      password: SENHA,
      roleId: papeis.find((p) => p.systemKey === 'cashier')!.id,
    },
  });
  await api.dispose();

  await entrar(page, dono);
  await menu(page, 'Equipe');
  const linha = page.getByRole('row', { name: /Bia Caixa/ });
  await expect(linha).toContainText('Todas');

  await page.getByRole('button', { name: 'Lojas de Bia Caixa' }).click();
  await page.getByLabel('Todas as lojas').uncheck();
  await page.getByRole('button', { name: 'Salvar lojas' }).click();
  await expect(page.getByText('Escolha pelo menos uma loja')).toBeVisible();
  await page.getByLabel('Loja principal').check();
  await page.getByRole('button', { name: 'Salvar lojas' }).click();
  await expect(linha).toContainText('Loja principal');

  // A Bia continua vendo o caixa da loja dela.
  const contexto = await browser.newContext();
  const bia = await contexto.newPage();
  await entrar(bia, operadora);
  await menu(bia, 'Abrir o caixa');
  await expect(bia.getByRole('heading', { name: 'Qual caixa é este aparelho?' })).toBeVisible();
  await expect(bia.getByRole('button', { name: /Caixa Centro/ })).toBeVisible();
  await contexto.close();

  // Voltar para "Todas as lojas".
  await page.getByRole('button', { name: 'Lojas de Bia Caixa' }).click();
  await page.getByLabel('Todas as lojas').check();
  await page.getByRole('button', { name: 'Salvar lojas' }).click();
  await expect(linha).toContainText('Todas');
});
