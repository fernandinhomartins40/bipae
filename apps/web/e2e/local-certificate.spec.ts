import { expect, test, type Page } from '@playwright/test';
import forge from 'node-forge';

/**
 * F3-21.a: certificado A1 instalado no aparelho, para assinar sem internet. O certificado de
 * teste é gerado na hora, nunca versionado.
 */
// O desktop usa rotas com #: o mesmo teste vale para as duas cascas.
const go = (page: Page, path: string) =>
  page.goto(test.info().project.name === 'desktop-ui' ? `/#${path}` : path);

function makePfx(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '05';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 200 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'LOJA DO APARELHO:11222333000181' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

test('instalar o certificado A1 neste aparelho e remover', async ({ page }) => {
  await go(page, '/criar-conta');
  await page.getByLabel('Seu nome').fill('Lia Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`lia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha', { exact: true }).fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Lia!' })).toBeVisible();

  await page.getByRole('link', { name: 'Periféricos' }).click();
  const quadro = page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'Certificado digital neste aparelho' }) })
    .last();
  await quadro.getByLabel('Arquivo do certificado A1').setInputFiles({
    name: 'loja.pfx',
    mimeType: 'application/x-pkcs12',
    buffer: makePfx('segredo'),
  });
  await quadro.getByLabel('Senha do certificado A1').fill('errada');
  await quadro.getByRole('button', { name: 'Instalar neste aparelho' }).click();
  await expect(quadro.getByText('Senha do certificado incorreta.')).toBeVisible();

  await quadro.getByLabel('Senha do certificado A1').fill('segredo');
  await quadro.getByRole('button', { name: 'Instalar neste aparelho' }).click();
  await expect(quadro.getByText(/LOJA DO APARELHO:11222333000181, válido até/)).toBeVisible();

  // Continua instalado depois de recarregar a página (chave guardada no aparelho).
  await page.reload();
  await expect(page.getByText(/LOJA DO APARELHO:11222333000181, válido até/)).toBeVisible();
  await page.getByRole('button', { name: 'Remover deste aparelho' }).click();
  await expect(page.getByText('Certificado removido deste aparelho.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Instalar neste aparelho' })).toBeVisible();
});
