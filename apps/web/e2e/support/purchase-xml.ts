import { buildNfe, calculateIcms, signNfe } from '@bipae/fiscal';
import forge from 'node-forge';

/**
 * Gera o XML autorizado (nota assinada mais protocolo) de uma compra de teste e escreve na saída.
 * Roda num processo à parte (com tsx) porque o carregador do Playwright não lê os JSON do motor.
 * O certificado do fornecedor é criado na hora: nada de certificado versionado.
 */
async function xmlDoFornecedor(): Promise<string> {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '09';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: 'commonName', value: 'BEBIDAS JA LTDA:22333444000102' }]);
  cert.setIssuer([{ name: 'commonName', value: 'BEBIDAS JA LTDA:22333444000102' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(
      forge.asn1
        .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)))
        .getBytes(),
      'binary',
    ),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const item = (
    code: string,
    description: string,
    unit: string,
    quantityMilli: number,
    unitPriceCents: number,
  ) => ({
    code,
    gtin: null,
    description,
    ncm: '22021000',
    cfop: '5102',
    unit,
    quantityMilli,
    unitPriceCents,
    grossCents: (quantityMilli / 1000) * unitPriceCents,
    discountCents: 0,
    origin: '0',
    icms: calculateIcms(
      { cst: '00', rate: '18' },
      { baseCents: (quantityMilli / 1000) * unitPriceCents },
    ),
  });
  const doc = buildNfe({
    issuer: {
      cnpj: '22333444000102',
      name: 'Bebidas Já LTDA',
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
      },
    },
    cUF: '35',
    series: 1,
    number: 3001,
    issuedAt: '2026-10-13T09:00:00-03:00',
    numericCode: '30013001',
    nature: 'Venda de mercadoria',
    direction: 'saida',
    purpose: 'normal',
    presence: 'outros',
    finalConsumer: false,
    recipient: {
      cnpj: '11222333000181',
      name: 'Mercado do teste',
      ieIndicator: 1,
      ie: '111222333444',
      address: {
        street: 'Rua A',
        number: '1',
        district: 'Centro',
        cityCode: '3550308',
        cityName: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
      },
    },
    items: [
      item('REF-CX', 'Refrigerante guaraná 2 L caixa com 6', 'CX', 5000, 3000),
      item('AGUA', 'Água mineral sem gás 500 ml', 'UN', 12_000, 150),
    ],
    transport: { freight: 'porContaDoRemetente' },
    payments: [{ code: '15', amountCents: 16_800 }],
    appVersion: 'ERP do fornecedor',
  });
  const certificate = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    'binary',
  ).toString('base64');
  const signed = await signNfe(doc.xml, { privateKey, certificate });
  return (
    `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${signed}` +
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP</verAplic><chNFe>${doc.accessKey}</chNFe>` +
    `<dhRecbto>2026-10-13T09:00:05-03:00</dhRecbto><nProt>135260000300100</nProt><digVal>AAAA</digVal>` +
    `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`
  );
}

process.stdout.write(await xmlDoFornecedor());
