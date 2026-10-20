import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, request, test, type Page } from '@playwright/test';
import { abrirNoMenu } from './menu';

/** F6-01.a e F6-01.c: chave da API pública e webhooks, criados na retaguarda e usados por outro sistema. */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

const menu = (page: Page, name: string) => abrirNoMenu(page, name);

test('criar a chave, usar na API pública e revogar', async ({ page }) => {
  const email = `api-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Bruno Dono',
      businessName: `Loja Online ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Integrações (API)');
  await expect(page.getByText('Nenhuma chave ainda')).toBeVisible();

  await page.getByRole('button', { name: 'Nova chave' }).click();
  await page.getByLabel('Nome da chave').fill('Loja virtual');
  await expect(page.getByLabel('Ler produtos, preços, estoque e vendas')).toBeChecked();
  await page.getByRole('button', { name: 'Criar chave' }).click();

  const chave = (await page.getByLabel('Chave de API criada').textContent())!.trim();
  expect(chave).toMatch(/^bpk_/);
  const parceiro = await request.newContext({
    baseURL: 'http://localhost:3334/v1/',
    extraHTTPHeaders: { authorization: `Bearer ${chave}` },
  });
  const eu = await parceiro.get('public/me');
  expect(eu.status()).toBe(200);
  expect(await eu.json()).toMatchObject({ apiKey: { name: 'Loja virtual' } });

  await page.getByRole('button', { name: 'Já guardei' }).click();
  await expect(page.getByLabel('Chave de API criada')).toHaveCount(0);
  const linha = page.getByRole('row', { name: /Loja virtual/ });
  await linha.getByRole('button', { name: 'Revogar Loja virtual' }).click();
  await expect(linha.getByText('Revogada')).toBeVisible();
  expect((await parceiro.get('public/me')).status()).toBe(401);
});

test('cadastrar um webhook, mandar o teste e ver a entrega', async ({ page }) => {
  const recebidos: string[] = [];
  const receptor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      recebidos.push(corpo);
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receptor.listen(0, '127.0.0.1', r));
  const endereco = `http://127.0.0.1:${(receptor.address() as AddressInfo).port}/avisos`;

  const email = `hook-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  await api.post('auth/signup', {
    data: {
      ownerName: 'Bruno Dono',
      businessName: `Loja Hook ${Date.now()}`,
      email,
      password: 'senha-forte-123',
    },
  });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await menu(page, 'Integrações (API)');

  await page.getByRole('button', { name: 'Novo webhook' }).click();
  await page.getByLabel('Endereço que recebe os avisos').fill(endereco);
  await page.getByLabel('Produto cadastrado ou alterado (inclusive preço)').check();
  await page.getByRole('button', { name: 'Criar webhook' }).click();
  await expect(page.getByLabel('Segredo do webhook')).toContainText('whsec_');
  await page.getByRole('button', { name: 'Já guardei o segredo' }).click();

  const linha = page.getByRole('row', { name: /127\.0\.0\.1:\d+\/avisos/ });
  await expect(linha).toContainText('Venda feita no caixa');
  await linha.getByRole('button', { name: 'Enviar teste' }).click();
  await expect.poll(() => recebidos.length).toBeGreaterThan(0);
  expect(JSON.parse(recebidos[0]!)).toMatchObject({ event: 'ping' });

  await linha.getByRole('button', { name: 'Entregas' }).click();
  const entregas = page.getByRole('list', { name: 'Entregas' });
  await expect(entregas).toContainText('Aviso de teste');
  await expect(entregas).toContainText('Entregue');
  receptor.close();
});
