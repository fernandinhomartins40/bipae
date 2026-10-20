import { expect, test } from '@playwright/test';
import forge from 'node-forge';
import { abrirNoMenu } from './menu';

/**
 * F3-10: enviar o certificado A1 pela tela. O certificado de teste é gerado na hora, nunca
 * versionado.
 */
test.skip(() => test.info().project.name !== 'web', 'A retaguarda é a mesma nas duas cascas.');

function makePfx(cnpj: string, password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 200 * 86_400_000);
  const attrs = [{ name: 'commonName', value: `MERCADO TESTE:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

test('enviar o certificado A1 da empresa e ver a validade', async ({ page }) => {
  await page.goto('/criar-conta');
  await page.getByLabel('Seu nome').fill('Bia Dona');
  await page.getByLabel('Nome do negócio').fill(`Mercado ${Date.now()}`);
  await page.getByLabel('E-mail').fill(`bia-${Date.now()}@exemplo.com.br`);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page.getByRole('heading', { name: 'Olá, Bia!' })).toBeVisible();

  await abrirNoMenu(page, 'Empresas e lojas');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('CNPJ').fill('11.222.333/0001-81');
  await page.getByRole('button', { name: 'Salvar empresa' }).click();
  await expect(page.getByText('Sem certificado digital A1')).toBeVisible();

  const arquivo = {
    name: 'empresa.pfx',
    mimeType: 'application/x-pkcs12',
    buffer: makePfx('11222333000181', 'segredo'),
  };
  await page.getByRole('button', { name: 'Enviar certificado' }).click();
  await page.getByLabel('Arquivo do certificado').setInputFiles(arquivo);
  await page.getByLabel('Senha do certificado').fill('errada');
  await page.getByRole('button', { name: 'Enviar certificado' }).last().click();
  await expect(page.getByText('Senha do certificado incorreta.')).toBeVisible();

  await page.getByLabel('Senha do certificado').fill('segredo');
  await page.getByRole('button', { name: 'Enviar certificado' }).last().click();
  await expect(
    page.getByText(/Certificado A1 de MERCADO TESTE:11222333000181, válido até/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar certificado' })).toBeVisible();

  // F3-11: teste de conexão. A resposta da SEFAZ é simulada aqui: o certificado de teste não
  // vale na SEFAZ de verdade (a conversa real é testada na API, com uma SEFAZ simulada).
  await page.route('**/fiscal/sefaz/status/**', (route) =>
    route.fulfill({
      json: {
        model: '65',
        uf: 'SP',
        environment: 'homologacao',
        cStat: '107',
        xMotivo: 'Serviço em Operação',
        online: true,
        checkedAt: new Date().toISOString(),
      },
    }),
  );
  await page.getByRole('button', { name: 'Testar conexão com a SEFAZ' }).click();
  // NFC-e, NF-e e a contingência da NF-e (SVC), uma linha para cada.
  for (const linha of ['NFC-e', 'NF-e', 'Contingência da NF-e (SVC)']) {
    await expect(
      page.getByText(`${linha}: SEFAZ de homologação (SP) respondeu: 107 - Serviço em Operação`, {
        exact: true,
      }),
    ).toBeVisible();
  }
});
