import { expect, request, test } from '@playwright/test';
import forge from 'node-forge';
import { abrirNoMenu } from './menu';

/**
 * F3-15.c: venda sem internet com o certificado A1 no aparelho sai com a NFC-e em contingência
 * off-line, e a nota chega ao servidor ao reconectar. Sem certificado no servidor, a nota fica
 * em "falta configurar" (a transmissão real depende do A1 da empresa, E1).
 */
test.skip(() => test.info().project.name !== 'web', 'O certificado no navegador é da casca web.');

function makePfx(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '07';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 200 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'MERCADINHO OFFLINE:11222333000181' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

test('sem internet, o caixa emite a NFC-e em contingência e ela sobe ao reconectar', async ({
  page,
  context,
}) => {
  const email = `rui-conting-${Date.now()}@exemplo.com.br`;
  const api = await request.newContext({ baseURL: 'http://localhost:3334/v1/' });
  const conta = await (
    await api.post('auth/signup', {
      data: {
        ownerName: 'Rui Dono',
        businessName: `Mercadinho ${Date.now()}`,
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
      legalName: 'Mercadinho Offline LTDA',
      taxId: '11.222.333/0001-81',
      uf: 'SP',
      taxRegime: 'simples',
      ie: '111222333444',
      street: 'Rua das Flores',
      streetNumber: '100',
      district: 'Centro',
      cityCode: '3550308',
      cep: '01001000',
    },
  });
  const perfil = await (
    await api.post('fiscal-profiles', {
      headers,
      data: { name: 'Mercearia', cfopInterna: '5102', csosn: '102' },
    })
  ).json();
  await api.post('products', {
    headers,
    data: {
      name: 'Arroz 5 kg',
      priceCents: 2890,
      barcodes: ['7891000315507'],
      ncm: '10063021',
      fiscalProfileId: perfil.id,
    },
  });

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Certificado A1 neste aparelho (F3-21.a).
  await abrirNoMenu(page, 'Periféricos');
  const quadro = page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'Certificado digital neste aparelho' }) })
    .last();
  await quadro.getByLabel('Arquivo do certificado A1').setInputFiles({
    name: 'loja.pfx',
    mimeType: 'application/x-pkcs12',
    buffer: makePfx('segredo'),
  });
  await quadro.getByLabel('Senha do certificado A1').fill('segredo');
  await quadro.getByRole('button', { name: 'Instalar neste aparelho' }).click();
  await expect(quadro.getByText(/MERCADINHO OFFLINE:11222333000181, válido até/)).toBeVisible();

  // Abre o caixa com internet (baixa catálogo e dados fiscais) e depois a rede cai.
  await page.getByRole('link', { name: 'Abrir o caixa' }).click();
  await page.getByLabel('Novo caixa').fill('Caixa 1');
  await page.getByRole('button', { name: 'Criar e usar este caixa' }).click();
  await expect(page.getByRole('heading', { name: 'Abrir o caixa' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Dinheiro na gaveta para troco (R$)').fill('0');
  await page.getByRole('button', { name: 'Abrir caixa' }).click();
  await expect(page.getByText('Caixa livre')).toBeVisible();

  await context.setOffline(true);
  const campo = page.getByLabel('Bipe o código ou digite o nome do produto');
  await campo.fill('7891000315507');
  await campo.press('Enter');
  await page.getByRole('button', { name: 'Receber (F10)' }).click();
  await page.getByRole('radio', { name: 'Pix' }).click();
  await page.getByRole('button', { name: 'Adicionar pix' }).click();
  await page.getByRole('button', { name: 'Pagamento recebido' }).click();
  await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await expect(page.getByText(/NFC-e emitida em contingência/)).toBeVisible();

  // Volta a internet: a venda sobe com a nota assinada pelo caixa.
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).not.toContainText('para enviar', {
    timeout: 20_000,
  });
  await page.goto('/vendas');
  await page.getByRole('row', { name: /Caixa 1 · nº 1/ }).click();
  const nota = page.getByRole('region', { name: 'Nota fiscal' });
  await expect(nota).toContainText('Emitida em contingência off-line');
  // A chave tem o tipo de emissão 9 (35ª posição).
  await expect(nota.getByLabel('Chave de acesso')).toHaveText(/^(\d{4} ){8}\d{2}9\d/);
  // A empresa ainda não tem o certificado no servidor, que faz a conexão com a SEFAZ.
  await expect(nota).toContainText('A empresa ainda não tem certificado digital A1 cadastrado.');
});
