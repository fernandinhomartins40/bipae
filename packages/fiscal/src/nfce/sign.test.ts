import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { calculateIcms } from '../taxes/icms';
import { buildNfce, type NfceInput } from './build';
import { canonicalInfNfe, signNfe } from './sign';

/**
 * F3-09: a assinatura é conferida por uma biblioteca independente (xml-crypto), que faz a
 * canonicalização e a verificação do jeito dela. Se a nossa forma canônica divergisse da real, o
 * resumo não bateria e a SEFAZ rejeitaria a nota.
 */
const keys = (await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-1',
  },
  true,
  ['sign', 'verify'],
)) as { privateKey: import('./sign').WebCryptoKey; publicKey: import('./sign').WebCryptoKey };
const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
const publicPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki)).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
// Certificado de teste só para ocupar o lugar no XML: a verificação abaixo usa a chave pública.
const CERTIFICADO = btoa('certificado-de-teste');

const nota = (descricao: string): NfceInput => ({
  issuer: {
    cnpj: '11222333000181',
    name: 'Mercadinho Bipaê LTDA',
    ie: '110042490114',
    crt: 1,
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
  cUF: '35',
  series: 1,
  number: 7,
  issuedAt: '2026-06-15T10:30:00-03:00',
  numericCode: '87654321',
  items: [
    {
      code: '1',
      gtin: null,
      description: descricao,
      ncm: '22030000',
      cfop: '5102',
      unit: 'UN',
      quantityMilli: 1000,
      unitPriceCents: 990,
      grossCents: 990,
      discountCents: 0,
      origin: '0',
      icms: calculateIcms({ csosn: '102' }, { baseCents: 990 }),
    },
  ],
  payments: [{ code: '01', amountCents: 990 }],
  appVersion: 'Bipae 0.3.0',
});

function verify(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signature = doc.getElementsByTagNameNS(
    'http://www.w3.org/2000/09/xmldsig#',
    'Signature',
  )[0]!;
  const verifier = new SignedXml({ publicCert: publicPem });
  verifier.loadSignature(signature as never);
  return verifier.checkSignature(xml);
}

describe('assinatura XML da NF-e/NFC-e', () => {
  it('a assinatura confere numa biblioteca independente, inclusive com acentos, & e aspas', async () => {
    for (const descricao of ['Cerveja 600ml', 'Café "Especial" & Pão de Açúcar <grande>']) {
      const assinado = await signNfe(buildNfce(nota(descricao)).xml, {
        privateKey: keys.privateKey,
        certificate: CERTIFICADO,
      });
      expect(assinado).toMatch(
        /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><SignedInfo>/,
      );
      expect(assinado).toContain(`<X509Certificate>${CERTIFICADO}</X509Certificate>`);
      expect(verify(assinado), descricao).toBe(true);
    }
  });

  it('qualquer alteração depois de assinar invalida a assinatura', async () => {
    const assinado = await signNfe(buildNfce(nota('Cerveja')).xml, {
      privateKey: keys.privateKey,
      certificate: CERTIFICADO,
    });
    expect(verify(assinado.replace('<vNF>9.90</vNF>', '<vNF>1.00</vNF>'))).toBe(false);
  });

  it('recusa XML que não veio do gerador, já assinado ou certificado fora do formato', async () => {
    const xml = buildNfce(nota('X')).xml;
    const chave = { privateKey: keys.privateKey, certificate: CERTIFICADO };
    expect(() => canonicalInfNfe('<NFe/>')).toThrow('sem o elemento infNFe');
    expect(() =>
      canonicalInfNfe(xml.replace('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">', '<NFe>')),
    ).toThrow('namespace');
    await expect(signNfe(await signNfe(xml, chave), chave)).rejects.toThrow('já está assinado');
    await expect(
      signNfe(xml, { ...chave, certificate: '-----BEGIN CERTIFICATE-----' }),
    ).rejects.toThrow('base64');
  });
});
