import { readFileSync } from 'node:fs';
import { expect, request, test } from '@playwright/test';

/**
 * F2-14: foto do produto. Cadastra a foto na retaguarda (recusando o que não é imagem), vê a
 * miniatura na lista e a foto na grade de produtos do caixa, no lugar das iniciais.
 */
test.skip(() => test.info().project.name !== 'web', 'As telas são as mesmas nas duas cascas.');

const FOTO = readFileSync(new URL('../public/icon-512.png', import.meta.url));

test('cadastra a foto do produto e a vê na lista e na grade do caixa', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const email = `foto-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Lia Dona',
        businessName: `Padaria ${Date.now()}`,
        email,
        password: 'senha-forte-123',
      },
    })
  ).json();
  const headers = { authorization: `Bearer ${conta.accessToken}` };
  for (const p of [
    { name: 'Pão de Queijo', priceCents: 450, category: 'Padaria', barcodes: ['789000035'] },
    { name: 'Coxinha', priceCents: 700, category: 'Padaria', barcodes: ['789000042'] },
  ]) {
    expect((await api.post('products', { headers, data: p })).ok(), p.name).toBeTruthy();
  }

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('link', { name: 'Abrir o caixa' })).toBeVisible();
  await page.goto('/produtos');
  await page.getByRole('row', { name: /Pão de Queijo/ }).click();

  // O que não é imagem é recusado com mensagem clara.
  const arquivo = page.getByTestId('product-photo-file');
  await arquivo.setInputFiles({
    name: 'nota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('isto não é foto'),
  });
  await expect(page.getByText('Esse arquivo não é uma foto.')).toBeVisible();

  // Foto de verdade: prévia recortada, zoom e salvar.
  await arquivo.setInputFiles({ name: 'pao.png', mimeType: 'image/png', buffer: FOTO });
  await expect(page.getByTestId('product-photo-preview')).toBeVisible();
  await expect(page.getByText('Esse arquivo não é uma foto.')).toHaveCount(0);
  await page.getByLabel('Aproximar').fill('1.4');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A lista mostra a miniatura; a foto chegou reduzida no servidor.
  const linha = page.getByRole('row', { name: /Pão de Queijo/ });
  await expect(linha.getByTestId('product-photo')).toBeVisible();
  await expect(page.getByRole('row', { name: /Coxinha/ }).getByTestId('product-photo')).toHaveCount(
    0,
  );
  const lista = await (await api.get('products?q=queijo', { headers })).json();
  const produto = lista.items[0];
  expect(produto.imageHash).toMatch(/^[0-9a-f]{64}$/);
  const foto = await api.get(`products/${produto.id}/image?v=${produto.imageHash}`, { headers });
  expect(foto.ok()).toBeTruthy();
  expect(['image/webp', 'image/jpeg']).toContain(foto.headers()['content-type']);
  expect((await foto.body()).length).toBeLessThanOrEqual(80 * 1024);

  // No caixa, a grade mostra a foto do pão e as iniciais da coxinha.
  await page.goto('/caixa');
  await page.getByLabel('Novo caixa').fill('Balcão');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();
  await page
    .getByRole('group', { name: 'Modo da tela' })
    .getByRole('button', { name: 'Grade de produtos' })
    .click();
  const grade = page.getByRole('list', { name: 'Produtos' });
  const pao = grade.getByRole('button', { name: /Pão de Queijo/ });
  await expect(pao.getByTestId('product-photo')).toBeVisible({ timeout: 15_000 });
  await expect(
    grade.getByRole('button', { name: /Coxinha/ }).getByTestId('product-photo'),
  ).toHaveCount(0);
  expect(
    await pao.getByTestId('product-photo').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);

  // Vende tocando na foto; o item em destaque também mostra a foto.
  await pao.click();
  await expect(page.getByTestId('pdv-total')).toHaveText('R$ 4,50');

  // Tirar a foto volta as iniciais na lista.
  await page.goto('/produtos');
  await page.getByRole('row', { name: /Pão de Queijo/ }).click();
  await page.getByRole('button', { name: 'Remover foto' }).click();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('row', { name: /Pão de Queijo/ }).getByTestId('product-photo'),
  ).toHaveCount(0);
});
