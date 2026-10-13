import {
  buildNfe,
  calculateIcms,
  calculateIpi,
  signNfe,
  type NfeInput,
  type NfeItem,
} from '@bipae/fiscal';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F3-19: entrada de compra pelo XML da NF-e do fornecedor. O fornecedor e o certificado dele são
 * gerados na hora (nada versionado); a nota é montada e assinada pelo próprio motor do Bipaê.
 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const fornecedorKeys = forge.pki.rsa.generateKeyPair(2048);
const fornecedorCert = (() => {
  const cert = forge.pki.createCertificate();
  cert.publicKey = fornecedorKeys.publicKey;
  cert.serialNumber = '07';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'DISTRIBUIDORA DE BEBIDAS LTDA:22333444000102' }]);
  cert.setIssuer([{ name: 'commonName', value: 'DISTRIBUIDORA DE BEBIDAS LTDA:22333444000102' }]);
  cert.sign(fornecedorKeys.privateKey, forge.md.sha256.create());
  return Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary',
  ).toString('base64');
})();
const fornecedorKey = await crypto.subtle.importKey(
  'pkcs8',
  Buffer.from(
    forge.asn1
      .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(fornecedorKeys.privateKey)))
      .getBytes(),
    'binary',
  ),
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
  false,
  ['sign'],
);

function item(over: Partial<NfeItem> = {}): NfeItem {
  return {
    code: 'FORN-REF2L',
    gtin: '7894900011517',
    description: 'Refrigerante cola 2 L caixa com 6',
    ncm: '22021000',
    cfop: '5102',
    unit: 'CX',
    quantityMilli: 10_000,
    unitPriceCents: 3000,
    grossCents: 30_000,
    discountCents: 0,
    origin: '0',
    icms: calculateIcms({ cst: '00', rate: '18' }, { baseCents: 30_000 }),
    ...over,
  };
}

/** XML autorizado (nota assinada mais protocolo), como o fornecedor manda por e-mail. */
async function notaDoFornecedor(numero: number, over: Partial<NfeInput> = {}) {
  const items = over.items ?? [
    item(),
    item({
      code: 'FORN-AGUA',
      gtin: '7891000100103',
      description: 'Água mineral 500 ml',
      unit: 'UN',
      quantityMilli: 24_000,
      unitPriceCents: 150,
      grossCents: 3600,
      icms: calculateIcms({ cst: '00', rate: '18' }, { baseCents: 3600 }),
      ipi: {
        result: calculateIpi({ cst: '50', rate: '10' }, { baseCents: 3600 }),
        legalFramework: '999',
      },
    }),
  ];
  const total = items.reduce((s, i) => s + i.grossCents + (i.ipi?.result.amountCents ?? 0), 0);
  const doc = buildNfe({
    issuer: {
      cnpj: '22333444000102',
      name: 'Distribuidora de Bebidas LTDA',
      tradeName: 'Bebidas Já',
      ie: '110042490114',
      crt: 3,
      address: {
        street: 'Av. Industrial',
        number: '500',
        district: 'Distrito',
        cityCode: '3550308',
        cityName: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
        phone: '1133335555',
      },
    },
    cUF: '35',
    series: 1,
    number: numero,
    issuedAt: '2026-10-13T09:00:00-03:00',
    numericCode: String(10_000_000 + numero),
    nature: 'Venda de mercadoria',
    direction: 'saida',
    purpose: 'normal',
    presence: 'outros',
    finalConsumer: false,
    recipient: {
      cnpj: '11222333000181',
      name: 'Mercadinho Bipaê LTDA',
      ieIndicator: 1,
      ie: '111222333444',
      address: {
        street: 'Rua das Flores',
        number: '100',
        district: 'Centro',
        cityCode: '3550308',
        cityName: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
      },
    },
    items,
    transport: { freight: 'porContaDoRemetente' },
    payments: [{ code: '15', amountCents: total }],
    appVersion: 'ERP do fornecedor',
    ...over,
  });
  const assinada = await signNfe(doc.xml, {
    privateKey: fornecedorKey,
    certificate: fornecedorCert,
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${assinada}` +
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP</verAplic><chNFe>${doc.accessKey}</chNFe>` +
    `<dhRecbto>2026-10-13T09:00:05-03:00</dhRecbto><nProt>13526000000${numero}</nProt><digVal>AAAA</digVal><cStat>100</cStat>` +
    `<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`
  );
}

async function mercado() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: empresa.legalName,
    taxId: '11.222.333/0001-81',
    uf: 'SP',
  });
  const [loja] = (await admin.get('/stores')).json();
  return { admin, empresa, loja };
}

describe('compra pelo XML da NF-e (F3-19)', () => {
  it('mostra a prévia, cria fornecedor e produto, associa pelo código de barras e dá entrada no estoque', async () => {
    const { admin, empresa, loja } = await mercado();
    const agua = (
      await admin.post('/products', {
        name: 'Água 500 ml',
        priceCents: 300,
        barcodes: ['7891000100103'],
      })
    ).json();
    const xml = await notaDoFornecedor(1001);

    const previa = await admin.post('/purchases/preview', { xml });
    expect(previa.statusCode).toBe(201);
    const p = previa.json();
    expect(p).toMatchObject({
      number: 1001,
      authorized: true,
      environment: 'homologacao',
      signature: {
        valid: true,
        signer: 'DISTRIBUIDORA DE BEBIDAS LTDA:22333444000102',
        trusted: false,
      },
      company: { id: empresa.id },
      supplier: { id: null, name: 'Distribuidora de Bebidas LTDA', taxId: '22333444000102' },
      alreadyImported: false,
    });
    expect(p.items[0]).toMatchObject({
      supplierCode: 'FORN-REF2L',
      unit: 'CX',
      quantity: '10.0000',
      suggestion: null,
    });
    expect(p.items[1].suggestion).toMatchObject({
      productId: agua.id,
      via: 'codigo-de-barras',
      factor: '1',
    });

    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: agua.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    expect(entrada.json()).toMatchObject({ items: 2, createdProducts: 1 });

    // Refrigerante: 10 caixas × 6 = 60 unidades a R$ 5,00 (300,00 / 60).
    const produtos = (await admin.get('/products?q=Refrigerante')).json();
    const refri = (produtos.items ?? produtos).find((x: { name: string }) =>
      x.name.startsWith('Refrigerante cola'),
    );
    expect(refri).toMatchObject({
      unit: 'UN',
      priceCents: 899,
      costCents: 500,
      ncm: '22021000',
      barcodes: ['7894900011517'],
    });
    const estoque = (await admin.get(`/stock?productId=${refri.id}&productId=${agua.id}`)).json();
    expect(estoque).toEqual(
      expect.arrayContaining([
        { productId: refri.id, storeId: loja.id, quantityMilli: 60_000 },
        { productId: agua.id, storeId: loja.id, quantityMilli: 24_000 },
      ]),
    );
    // Água: 36,00 + 3,60 de IPI por 24 unidades = 1,65.
    expect((await admin.get(`/products/${agua.id}`)).json().costCents).toBe(165);

    const fornecedores = (await admin.get('/suppliers')).json();
    expect(fornecedores.items ?? fornecedores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Bebidas Já', taxId: '22333444000102' }),
      ]),
    );
    const compras = (await admin.get('/purchases')).json();
    expect(compras).toEqual([
      expect.objectContaining({
        number: 1001,
        supplierName: 'Bebidas Já',
        storeName: loja.name,
        authorized: true,
        itemCount: 2,
      }),
    ]);
    const auditoria = (await admin.get('/audit?action=purchase.imported')).json();
    expect(JSON.stringify(auditoria)).toContain('purchase.imported');

    // A mesma nota não entra duas vezes.
    const repetida = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: refri.id },
        { line: 2, productId: agua.id },
      ],
    });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().message).toBe('A NF-e 1001 deste fornecedor já foi importada.');

    // Na próxima nota do fornecedor, os itens já vêm associados, com o fator de conversão.
    const proxima = (
      await admin.post('/purchases/preview', { xml: await notaDoFornecedor(1002) })
    ).json();
    expect(proxima.supplier.id).not.toBeNull();
    expect(proxima.items[0].suggestion).toMatchObject({
      productId: refri.id,
      via: 'fornecedor',
      factor: '6',
    });
    expect(proxima.items[1].suggestion).toMatchObject({ productId: agua.id, via: 'fornecedor' });

    // Outro cliente não vê a compra.
    const outro = await mercado();
    expect((await outro.admin.get('/purchases')).json()).toEqual([]);
  });

  it('recusa XML alterado, nota de outra empresa e item sem decisão', async () => {
    const { admin, loja } = await mercado();
    const xml = await notaDoFornecedor(2001);
    const alterado = xml.replace('Água mineral 500 ml', 'Água mineral 1,5 L');
    const previa = (await admin.post('/purchases/preview', { xml: alterado })).json();
    expect(previa.signature.valid).toBe(false);
    const recusada = await admin.post('/purchases', {
      xml: alterado,
      storeId: loja.id,
      items: [
        { line: 1, productId: null },
        { line: 2, productId: null },
      ],
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().message).toMatch(/assinatura digital da nota não confere/);

    const semSaida = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [{ line: 1, productId: null, unit: 'UN' }],
    });
    expect(semSaida.json().message).toBe('Diga o que fazer com o item 2 (Água mineral 500 ml).');
    const unidade = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, unit: 'XYZ' },
        { line: 2, productId: null },
      ],
    });
    expect(unidade.json().message).toBe(
      'A unidade XYZ do item 1 não está cadastrada. Escolha uma das suas unidades.',
    );
    const fator = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '0' },
        { line: 2, productId: null },
      ],
    });
    expect(fator.json().message).toMatch(/Fator de conversão inválido/);

    const outra = await notaDoFornecedor(2002, {
      recipient: {
        cnpj: '11444777000161',
        name: 'Outra empresa',
        ieIndicator: 1,
        ie: '999888777666',
        address: {
          street: 'Rua B',
          number: '2',
          district: 'Centro',
          cityCode: '3550308',
          cityName: 'São Paulo',
          uf: 'SP',
          cep: '01001000',
        },
      },
    });
    const naoEMinha = await admin.post('/purchases/preview', { xml: outra });
    expect(naoEMinha.statusCode).toBe(400);
    expect(naoEMinha.json().message).toBe(
      'Esta nota não é para nenhuma empresa sua: o destinatário é o CNPJ 11444777000161.',
    );

    const nfce = await admin.post('/purchases/preview', {
      xml: xml.replace('<mod>55</mod>', '<mod>65</mod>'),
    });
    expect(nfce.json().message).toBe(
      'Só a NF-e (modelo 55) dá entrada de compra; cupom e NFC-e não.',
    );
  });
});
