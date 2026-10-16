import { describe, expect, it } from 'vitest';
import { buildNfeProc } from '../sefaz/responses';
import { PurchaseXmlError } from '../purchase/read';
import { readSaleNfce } from './read';
import { buildSaleNfce, type SaleNfceInput } from './sale';

/** MF-08: a NFC-e autorizada lida de volta, para mandar a venda ao MercadoFlow. */

const venda: SaleNfceInput = {
  saleId: '0192a000-0000-7000-8000-00000000abcd',
  company: {
    cnpj: '11.222.333/0001-81',
    legalName: 'Mercadinho Bipaê LTDA',
    ie: '111.222.333.444',
    uf: 'SP',
    regime: 'simples',
    address: {
      street: 'Rua das Flores',
      number: '100',
      district: 'Centro',
      cityCode: '3550308',
      cityName: 'São Paulo',
      cep: '01001-000',
    },
  },
  series: 3,
  terminalSeq: 42,
  occurredAt: '2026-10-15T18:30:00.000Z',
  items: [
    {
      code: 'ARROZ5',
      barcodes: ['7891000315507'],
      description: 'Arroz tipo 1 5kg',
      ncm: '10063021',
      unit: 'UN',
      quantityMilli: 2000,
      unitPriceCents: 2890,
      grossCents: 5780,
      discountCents: 0,
      profile: { cfopInterna: '5102', cfopInterestadual: '6102', csosn: '102', origem: 0 },
    },
    {
      code: 'BANANA',
      barcodes: ['2000420015990'],
      description: 'Banana prata',
      ncm: '08039000',
      unit: 'KG',
      quantityMilli: 1250,
      unitPriceCents: 699,
      grossCents: 874,
      discountCents: 74,
      profile: { cfopInterna: '5102', cfopInterestadual: '6102', csosn: '102', origem: 0 },
    },
  ],
  payments: [{ method: 'cash', amountCents: 6580 }],
  customerTaxId: '123.456.789-09',
  appVersion: 'Bipaê 1.0',
};

function autorizada() {
  const r = buildSaleNfce(venda);
  if (!r.ok) throw new Error(r.pending.join('; '));
  const key = r.document.accessKey;
  return buildNfeProc(r.document.xml, {
    accessKey: key,
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e',
    outcome: 'authorized',
    number: '135260000999999',
    receivedAt: '2026-10-15T15:30:02-03:00',
    xml:
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP</verAplic><chNFe>${key}</chNFe>` +
      '<dhRecbto>2026-10-15T15:30:02-03:00</dhRecbto><nProt>135260000999999</nProt><digVal>AAAA</digVal>' +
      '<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>',
  });
}

describe('leitura da NFC-e autorizada (MF-08)', () => {
  it('traz chave, número, emitente, consumidor, itens e protocolo', () => {
    const nota = readSaleNfce(autorizada());
    expect(nota).toMatchObject({
      number: 42,
      series: 3,
      issuedAt: '2026-10-15T15:30:00-03:00',
      environment: 'homologacao',
      contingency: false,
      recipientTaxId: '12345678909',
      totalCents: 6580,
      issuer: {
        cnpj: '11222333000181',
        address: { cityCode: '3550308', cityName: 'São Paulo', uf: 'SP', cep: '01001000' },
      },
      protocol: { number: '135260000999999', cStat: '100' },
    });
    expect(nota.accessKey).toMatch(/^35\d{42}$/);
    expect(nota.items).toHaveLength(2);
    expect(nota.items[0]).toMatchObject({
      gtin: '7891000315507',
      supplierCode: 'ARROZ5',
      cfop: '5102',
      quantity: '2.0000',
      totalCents: 5780,
    });
    // Código interno da balança não é GTIN: sai sem código de barras.
    expect(nota.items[1]).toMatchObject({ supplierCode: 'BANANA', unit: 'KG', discountCents: 74 });
    expect(nota.items[1]!.gtin).toBeUndefined();
  });

  it('recusa o que não é NFC-e autorizada', () => {
    const r = buildSaleNfce(venda);
    if (!r.ok) throw new Error('montagem');
    expect(() => readSaleNfce(r.document.xml)).toThrow(PurchaseXmlError);
    expect(() => readSaleNfce('não é xml')).toThrow('O arquivo não é um XML válido.');
    const semProtocolo = autorizada().replace(/<nProt>\d+<\/nProt>/, '');
    expect(() => readSaleNfce(semProtocolo)).toThrow('não traz o protocolo');
    const nfe = autorizada().replace('<mod>65</mod>', '<mod>55</mod>');
    expect(() => readSaleNfce(nfe)).toThrow('não é o XML de uma NFC-e');
  });
});
