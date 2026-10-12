import { expect, test } from '@playwright/test';

/** Desktop download page: public (linked from the landing page) and inside the back office. */
test.skip(() => test.info().project.name !== 'web', 'A página de download é da casca web.');

const RELEASE = {
  available: true,
  version: '0.3.0',
  publishedAt: '2026-10-12T20:00:00Z',
  files: [
    {
      kind: 'windows-setup',
      label: 'Windows 10 ou 11 (recomendado)',
      fileName: 'Bipae-0.3.0-windows-x64-setup.exe',
      url: 'https://github.com/o/r/releases/download/v0.3.0/Bipae-0.3.0-windows-x64-setup.exe',
      sizeBytes: 88_300_000,
    },
    {
      kind: 'linux-deb',
      label: 'Linux Ubuntu/Debian (.deb)',
      fileName: 'bipae_0.3.0_amd64.deb',
      url: 'https://github.com/o/r/releases/download/v0.3.0/bipae_0.3.0_amd64.deb',
      sizeBytes: 90_000_000,
    },
  ],
};

test('public page offers the latest installer without login', async ({ page }) => {
  await page.route('**/v1/downloads/desktop', (route) => route.fulfill({ json: RELEASE }));
  await page.goto('/download');
  await expect(page.getByRole('heading', { name: 'Baixe o Bipaê Desktop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Versão 0.3.0' })).toBeVisible();
  const main = page.getByRole('link', { name: /Baixar para (Windows|Linux)/ });
  await expect(main).toHaveAttribute('href', /releases\/download\/v0\.3\.0\//);
  await expect(page.getByText('Executar assim mesmo')).toBeVisible();
});

test('back office menu leads to the download page, honest when nothing is published', async ({
  page,
}) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Bruno Balcão');
  await page.getByLabel('Nome do negócio').fill(`Padaria ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`bruno-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Bruno!' })).toBeVisible();

  await page.getByRole('link', { name: 'Baixar o desktop' }).click();
  await expect(page.getByRole('heading', { name: 'Bipaê Desktop' })).toBeVisible();
  // The test API has no releases repository configured.
  await expect(page.getByRole('heading', { name: 'O instalador está quase pronto' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir o caixa no navegador' })).toBeVisible();
});
