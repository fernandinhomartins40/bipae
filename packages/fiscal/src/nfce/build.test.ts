import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import { calculateContribution } from '../taxes/contributions';
import { calculateIbsCbs } from '../taxes/ibs-cbs';
import { calculateIcms } from '../taxes/icms';
import { accessKeyCheckDigit, buildAccessKey } from './access-key';
import { buildNfce, NfceBuildError, type NfceInput, type NfceItem } from './build';

/** F3-07: XML da NFC-e validado contra os schemas oficiais (pacote PL_010f do Portal Nacional). */

// Os XSD saem do pacote oficial guardado em sources/ (o mesmo que gera as tabelas).
const schemas = await (async () => {
  const { unzip } = await import('../../scripts/xlsx.mjs');
  const zip = readFileSync(
    fileURLToPath(new URL('../../sources/PL_010f_v1.04.zip', import.meta.url)),
  );
  return [...unzip(zip)]
    .filter(([name]) => name.endsWith('.xsd'))
    .map(([name, body]) => ({ fileName: name.split('/').pop()!, contents: body.toString('utf8') }));
})();
const nfeSchema = schemas.find((s) => s.fileName === 'nfe_v4.00.xsd')!;
const preload = schemas.filter((s) => s !== nfeSchema);

/**
 * A assinatura é a F3-09. Para validar a estrutura, entra um bloco de assinatura no formato do
 * schema, com valores fictícios: ele nunca vai para a SEFAZ.
 */
const FAKE_SIGNATURE =
  '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>' +
  '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
  '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>' +
  '<Reference URI="#NFe0"><Transforms>' +
  '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
  '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>' +
  '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue>' +
  '</Reference></SignedInfo><SignatureValue>AAAA</SignatureValue>' +
  '<KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>';

async function validate(xml: string) {
  const signed = xml.replace('</NFe>', `${FAKE_SIGNATURE}</NFe>`);
  const result = await validateXML({
    xml: [{ fileName: 'nfce.xml', contents: signed }],
    schema: [nfeSchema],
    preload,
  });
  return result.errors.map((e) => e.message);
}

const HOJE = '2026-06-15';
const EMITENTE: NfceInput['issuer'] = {
  cnpj: '11222333000181',
  name: 'Mercadinho Bipaê LTDA',
  tradeName: 'Mercadinho & Cia',
  ie: '110042490114',
  crt: 3,
  address: {
    street: 'Rua das Flores',
    number: '100',
    district: 'Centro',
    cityCode: '3550308',
    cityName: 'São Paulo',
    uf: 'SP',
    cep: '01001000',
  },
};

function itemReal(over: Partial<NfceItem> = {}): NfceItem {
  const icms = calculateIcms({ cst: '00', rate: '18' }, { baseCents: 10_000 });
  return {
    code: 'ARZ5',
    gtin: '7891000315507',
    description: 'Arroz Tipo 1 5kg',
    ncm: '10063021',
    cfop: '5102',
    unit: 'UN',
    quantityMilli: 1000,
    unitPriceCents: 10_000,
    grossCents: 10_000,
    discountCents: 0,
    origin: '0',
    icms,
    pis: calculateContribution(
      'PIS',
      { cst: '01', rate: '1.65', excludeIcms: true },
      { baseCents: 10_000, icmsCents: 1800 },
    ),
    cofins: calculateContribution(
      'COFINS',
      { cst: '01', rate: '7.6', excludeIcms: true },
      { baseCents: 10_000, icmsCents: 1800 },
    ),
    ibsCbs: calculateIbsCbs({
      cClassTrib: '000001',
      date: HOJE,
      operationCents: 10_000,
      taxes: { ICMS: 1800 },
    }),
    ...over,
  };
}

const venda = (over: Partial<NfceInput> = {}): NfceInput => ({
  issuer: EMITENTE,
  cUF: '35',
  series: 1,
  number: 42,
  issuedAt: '2026-06-15T10:30:00-03:00',
  numericCode: '12345678',
  items: [itemReal()],
  payments: [{ code: '17', amountCents: 10_000 }],
  appVersion: 'Bipae 0.3.0',
  ...over,
});

describe('chave de acesso', () => {
  it('monta os 44 dígitos com o dígito verificador do módulo 11', () => {
    const chave = buildAccessKey({
      cUF: '35',
      yearMonth: '2606',
      cnpj: '11222333000181',
      model: '65',
      series: 1,
      number: 42,
      emissionType: 1,
      numericCode: '12345678',
    });
    expect(chave).toHaveLength(44);
    expect(chave.slice(0, 43)).toBe('3526061122233300018165001000000042112345678');
    expect(Number(chave.at(-1))).toBe(accessKeyCheckDigit(chave.slice(0, 43)));
    // Caso conhecido do manual: soma com resto 0 ou 1 dá dígito 0.
    expect(accessKeyCheckDigit('0'.repeat(43))).toBe(0);
  });

  it('recusa partes inválidas', () => {
    const base = {
      cUF: '35',
      yearMonth: '2606',
      cnpj: '11222333000181',
      model: '65' as const,
      series: 1,
      number: 42,
      emissionType: 1 as const,
      numericCode: '12345678',
    };
    expect(() => buildAccessKey({ ...base, cUF: '3' })).toThrow('cUF');
    expect(() => buildAccessKey({ ...base, yearMonth: '26' })).toThrow('AAMM');
    expect(() => buildAccessKey({ ...base, cnpj: '123' })).toThrow('CNPJ');
    expect(() => buildAccessKey({ ...base, series: 1000 })).toThrow('Série');
    expect(() => buildAccessKey({ ...base, number: 0 })).toThrow('Número');
    expect(() => buildAccessKey({ ...base, numericCode: '123' })).toThrow('8 dígitos');
    expect(() => buildAccessKey({ ...base, numericCode: '00000042' })).toThrow('igual ao número');
    expect(() => accessKeyCheckDigit('123')).toThrow('43');
  });
});

describe('XML da NFC-e contra o schema oficial', () => {
  it('Lucro Real: ICMS, PIS, COFINS e IBS/CBS', async () => {
    const doc = buildNfce(venda());
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.accessKey).toHaveLength(44);
    expect(doc.xml).toContain(`Id="NFe${doc.accessKey}"`);
    expect(doc.xml).toContain('<tpAmb>2</tpAmb>');
    expect(doc.xml).toContain('<mod>65</mod>');
    expect(doc.xml).toContain('<vNF>100.00</vNF>');
    expect(doc.xml).toContain(
      '<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>',
    );
    expect(doc.xml).toContain('<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>');
    expect(doc.totalCents).toBe(10_000);
  });

  it('Simples Nacional, com consumidor identificado, desconto, troco e caracteres especiais', async () => {
    const icms = calculateIcms({ csosn: '102' }, { baseCents: 9000 });
    const doc = buildNfce(
      venda({
        issuer: { ...EMITENTE, crt: 1 },
        customer: { cpf: '12345678909', name: 'Zé & Maria <Ltda>' },
        items: [
          itemReal({
            icms,
            pis: null,
            cofins: null,
            discountCents: 1000,
            description: 'Café "Especial"',
          }),
        ],
        payments: [{ code: '01', amountCents: 10_000 }],
        changeCents: 1000,
        additionalInfo: 'Obrigado pela preferência!',
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>');
    expect(doc.xml).toContain('<xNome>Zé &amp; Maria &lt;Ltda&gt;</xNome>');
    expect(doc.xml).toContain('<vTroco>10.00</vTroco>');
    expect(doc.xml).toContain('<vNF>90.00</vNF>');
  });

  it('situações sem destaque e com redução de base, em vários itens', async () => {
    const isento = calculateIcms({ cst: '40' }, { baseCents: 500 });
    const reduzido = calculateIcms(
      { cst: '20', rate: '18', baseReduction: '33.33' },
      { baseCents: 1000 },
    );
    const imune = calculateIbsCbs({ cClassTrib: '410001', date: HOJE, operationCents: 500 });
    const doc = buildNfce(
      venda({
        items: [
          itemReal(),
          itemReal({
            code: 'P2',
            gtin: null,
            unitPriceCents: 500,
            grossCents: 500,
            icms: isento,
            ibsCbs: imune,
          }),
          itemReal({
            code: 'P3',
            quantityMilli: 1250,
            unit: 'KG',
            unitPriceCents: 800,
            grossCents: 1000,
            icms: reduzido,
            cest: '1700100',
          }),
        ],
        payments: [{ code: '03', amountCents: 11_500 }],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<cEAN>SEM GTIN</cEAN>');
    expect(doc.xml).toContain('<qCom>1.2500</qCom>');
    expect(doc.xml).toContain('<ICMS20>');
  });

  it('o que ainda não é emitido ou está incoerente vira erro claro', () => {
    const comSt = calculateIcms(
      { cst: '10', rate: '18', st: { mva: '40', rate: '18' } },
      { baseCents: 10_000 },
    );
    expect(() => buildNfce(venda({ items: [itemReal({ icms: comSt })] }))).toThrow(NfceBuildError);
    expect(() => buildNfce(venda({ items: [itemReal({ icms: comSt })] }))).toThrow(
      'ainda não é emitida na NFC-e',
    );
    expect(() => buildNfce(venda({ items: [] }))).toThrow('pelo menos um item');
    expect(() => buildNfce(venda({ payments: [{ code: '17', amountCents: 5000 }] }))).toThrow(
      'precisam somar o valor da nota',
    );
    expect(() => buildNfce(venda({ payments: [{ code: '77', amountCents: 10_000 }] }))).toThrow(
      'Meio de pagamento 77',
    );
  });
});

describe('o validador realmente reprova XML fora do schema', () => {
  it('sem natOp, com tpAmb inválido ou com elementos fora de ordem', async () => {
    const xml = buildNfce(venda()).xml;
    expect((await validate(xml.replace(/<natOp>.*?<\/natOp>/, ''))).join(' ')).toContain('mod');
    expect(
      (await validate(xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>7</tpAmb>'))).length,
    ).toBeGreaterThan(0);
    expect(
      (await validate(xml.replace(/(<cNF>.*?<\/cNF>)(<natOp>.*?<\/natOp>)/, '$2$1'))).length,
    ).toBeGreaterThan(0);
  });
});

describe('XML assinado de verdade contra o schema (F3-09)', () => {
  it('a assinatura gerada pelo Bipaê tem a estrutura que o schema exige', async () => {
    const { signNfe } = await import('./sign');
    const par = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-1',
      },
      false,
      ['sign'],
    )) as { privateKey: import('./sign').WebCryptoKey; publicKey: import('./sign').WebCryptoKey };
    const assinado = await signNfe(buildNfce(venda()).xml, {
      privateKey: par.privateKey,
      certificate: btoa('teste'),
    });
    const result = await validateXML({
      xml: [{ fileName: 'assinado.xml', contents: assinado }],
      schema: [nfeSchema],
      preload,
    });
    expect(result.errors.map((e) => e.message)).toEqual([]);
  });
});
