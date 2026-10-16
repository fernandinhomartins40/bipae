import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * F3-19: entrada de compra pelo XML. A nota do fornecedor é montada e assinada aqui, com um
 * certificado de teste gerado na hora (nunca versionado).
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

test('importar o XML de compra: fornecedor, produtos e estoque de uma vez', async ({ page }) => {
  const xml = execFileSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./support/purchase-xml.ts', import.meta.url))],
    { encoding: 'utf8' },
  );
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Rita Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`rita-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Rita!' })).toBeVisible();

  await page.getByRole('link', { name: 'Empresas e lojas' }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('CNPJ').fill('11.222.333/0001-81');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText('11.222.333/0001-81')).toBeVisible();

  await page.getByRole('link', { name: 'Compras' }).click();
  await expect(page.getByText('Nenhuma compra importada ainda')).toBeVisible();
  await page.getByLabel('Arquivo XML da nota de compra').setInputFiles({
    name: 'nfe-3001.xml',
    mimeType: 'text/xml',
    buffer: Buffer.from(xml, 'utf8'),
  });
  const gaveta = page.getByRole('dialog', { name: 'Entrada da NF-e 3001' });
  await expect(gaveta).toBeVisible();
  await expect(gaveta.getByText('Nota de homologação')).toBeVisible();
  await expect(gaveta.getByText('Novo', { exact: true })).toBeVisible();

  // A caixa do refrigerante vira 6 garrafas no estoque, vendidas a R$ 8,99.
  await gaveta.getByLabel('Unidades de estoque por CX').fill('6');
  await gaveta.getByLabel('Unidade do produto novo (item 1)').selectOption('UN');
  await gaveta.getByLabel('Preço de venda (item 1)').fill('8,99');
  await gaveta.getByLabel('Preço de venda (item 1)').blur();
  await gaveta.getByRole('button', { name: 'Dar entrada no estoque' }).click();

  await expect(
    page.getByText(
      'NF-e 3001 de Bebidas Já LTDA: 2 item(ns) no estoque, 2 produto(s) novo(s) cadastrado(s).',
    ),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bebidas Já LTDA' })).toBeVisible();
  await expect(page.getByText('Autorizada')).toBeVisible();

  // Uso ou consumo pessoal (LC 214/2025, art. 57): a marcação fica gravada na nota.
  const pessoal = page.getByLabel('Uso pessoal (nota nº 3001)');
  await expect(pessoal).not.toBeChecked();
  await pessoal.click();
  await expect(pessoal).toBeChecked();
  await page.reload();
  await expect(page.getByLabel('Uso pessoal (nota nº 3001)')).toBeChecked();
  await page.getByLabel('Uso pessoal (nota nº 3001)').click();
  await expect(page.getByLabel('Uso pessoal (nota nº 3001)')).not.toBeChecked();

  await page.getByRole('link', { name: 'Produtos', exact: true }).click();
  const linha = page.getByRole('row', { name: /Refrigerante guaraná 2 L caixa com 6/ });
  await expect(linha).toContainText('R$ 8,99');
  await expect(linha).toContainText('30');
});
