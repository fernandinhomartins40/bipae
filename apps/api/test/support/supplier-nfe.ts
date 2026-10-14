import {
  buildNfe,
  calculateIcms,
  calculateIpi,
  signNfe,
  type NfeInput,
  type NfeItem,
} from '@bipae/fiscal';
import forge from 'node-forge';

/**
 * Apoio dos testes: a NF-e que um fornecedor emite para a empresa de teste (CNPJ
 * 11.222.333/0001-81), assinada com um certificado gerado na hora (nada versionado) e já com o
 * protocolo de autorização, como chega por e-mail.
 */
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

export function item(over: Partial<NfeItem> = {}): NfeItem {
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
export async function notaDoFornecedor(numero: number, over: Partial<NfeInput> = {}) {
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
