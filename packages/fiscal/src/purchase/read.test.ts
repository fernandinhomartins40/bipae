import { describe, expect, it } from 'vitest';
import { buildNfe, type NfeInput } from '../nfe/build';
import type { NfeItem } from '../nfe/groups';
import { calculateIbsCbs } from '../taxes/ibs-cbs';
import { calculateIcms } from '../taxes/icms';
import { calculateIpi } from '../taxes/ipi';
import {
  decimalTextToCents,
  purchaseStockMilli,
  purchaseUnitCostCents,
  readPurchaseNfe,
  PurchaseXmlError,
} from './read';

/** F3-19.a: o XML que o fornecedor emitiu, lido para dar entrada na compra. */

function itemDoFornecedor(over: Partial<NfeItem> = {}): NfeItem {
  const ipi = calculateIpi({ cst: '50', rate: '10' }, { baseCents: 12_000 });
  return {
    code: 'FORN-778',
    gtin: '7894900011517',
    description: 'Refrigerante 2 L caixa com 6',
    ncm: '22021000',
    cest: '0300700',
    cfop: '5401',
    unit: 'CX',
    quantityMilli: 10_000,
    unitPriceCents: 1200,
    grossCents: 12_000,
    discountCents: 600,
    freightCents: 300,
    origin: '0',
    icms: calculateIcms(
      { cst: '10', rate: '18', st: { mva: '40', rate: '18' } },
      { baseCents: 11_700, ipiCents: ipi.amountCents },
    ),
    ipi: { result: ipi, legalFramework: '999' },
    ibsCbs: calculateIbsCbs({ cClassTrib: '000001', date: '2026-10-13', operationCents: 11_700 }),
    ...over,
  };
}

function notaDoFornecedor(over: Partial<NfeInput> = {}) {
  const items = over.items ?? [itemDoFornecedor()];
  const totalCents = items.reduce(
    (t, i) =>
      t +
      i.grossCents -
      i.discountCents +
      (i.freightCents ?? 0) +
      (i.icms.st?.amountCents ?? 0) +
      (i.ipi?.result.amountCents ?? 0),
    0,
  );
  return buildNfe({
    issuer: {
      cnpj: '22333444000102',
      name: 'Distribuidora de Bebidas LTDA',
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
    series: 2,
    number: 4321,
    issuedAt: '2026-10-13T09:00:00-03:00',
    numericCode: '55443322',
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
    payments: [{ code: '15', amountCents: totalCents }],
    appVersion: 'ERP do fornecedor',
    ...over,
  });
}

describe('XML de compra (F3-19.a)', () => {
  it('lê fornecedor, destinatário, itens, valores e tributos', () => {
    const doc = notaDoFornecedor();
    const compra = readPurchaseNfe(doc.xml);
    expect(compra).toMatchObject({
      accessKey: doc.accessKey,
      number: 4321,
      series: 2,
      environment: 'homologacao',
      supplier: {
        cnpj: '22333444000102',
        name: 'Distribuidora de Bebidas LTDA',
        ie: '110042490114',
        address: { uf: 'SP', cityName: 'São Paulo' },
      },
      recipient: { cnpj: '11222333000181' },
      totalCents: doc.totalCents,
    });
    expect(compra.protocol).toBeUndefined();
    const [item] = compra.items;
    expect(item).toMatchObject({
      line: 1,
      supplierCode: 'FORN-778',
      gtin: '7894900011517',
      ncm: '22021000',
      cest: '0300700',
      unit: 'CX',
      quantity: '10.0000',
      unitPrice: '12.00',
      totalCents: 12_000,
      discountCents: 600,
      freightCents: 300,
      ipiCents: 1200,
      taxes: { icms: { cst: '010', amountCents: 2106 }, ibsCbs: { cClassTrib: '000001' } },
    });
    expect(item!.stCents).toBeGreaterThan(0);
  });

  it('lê o protocolo do XML autorizado e ignora GTIN inválido', () => {
    const doc = notaDoFornecedor({
      items: [
        itemDoFornecedor({
          gtin: null,
          ipi: null,
          icms: calculateIcms({ cst: '00', rate: '18' }, { baseCents: 11_700 }),
        }),
      ],
    });
    const proc =
      `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${doc.xml}<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb>` +
      `<verAplic>SP</verAplic><chNFe>${doc.accessKey}</chNFe><dhRecbto>2026-10-13T09:00:05-03:00</dhRecbto><nProt>135260000111222</nProt>` +
      `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
    const compra = readPurchaseNfe(proc);
    expect(compra.protocol).toEqual({
      number: '135260000111222',
      receivedAt: '2026-10-13T09:00:05-03:00',
      cStat: '100',
    });
    expect(compra.items[0]!.gtin).toBeUndefined();
  });

  it('custo de entrada por unidade de estoque e quantidade com fator de conversão', () => {
    const [item] = readPurchaseNfe(notaDoFornecedor().xml).items;
    // (120,00 − 6,00 + 3,00 + ST + 12,00) por caixa; com fator 6, por garrafa.
    const caixa = purchaseUnitCostCents(item!);
    const garrafa = purchaseUnitCostCents(item!, 6);
    expect(caixa).toBe(Math.round((12_000 - 600 + 300 + item!.stCents + 1200) / 10));
    expect(garrafa).toBe(Math.round((12_000 - 600 + 300 + item!.stCents + 1200) / 60));
    expect(purchaseStockMilli(item!)).toBe(10_000);
    expect(purchaseStockMilli(item!, 6)).toBe(60_000);
    expect(purchaseStockMilli(item!, '0.5')).toBe(5000);
    expect(() => purchaseStockMilli(item!, 0)).toThrow('Quantidade inválida');
    expect(() => purchaseUnitCostCents(item!, 0)).toThrow('Quantidade inválida');
  });

  it('recusa o que não é NF-e de compra', () => {
    const doc = notaDoFornecedor();
    expect(() => readPurchaseNfe('não é xml <')).toThrow('não é um XML válido');
    expect(() => readPurchaseNfe('<outra/>')).toThrow('não é o XML de uma NF-e');
    expect(() => readPurchaseNfe(doc.xml.replace('<mod>55</mod>', '<mod>65</mod>'))).toThrow(
      'modelo 55',
    );
    expect(() => readPurchaseNfe(doc.xml.replace(/Id="NFe\d+"/, 'Id="NFe1"'))).toThrow(
      'Chave de acesso',
    );
    expect(() => readPurchaseNfe(doc.xml.replace(/<det nItem="1">[\s\S]*<\/det>/, ''))).toThrow(
      'não tem itens',
    );
    expect(() => readPurchaseNfe(doc.xml.replace(/<NCM>\d+<\/NCM>/, ''))).toThrow('Item 1 sem NCM');
    expect(() => readPurchaseNfe(doc.xml.replace(/<dest>[\s\S]*<\/dest>/, ''))).toThrow(
      PurchaseXmlError,
    );
    expect(decimalTextToCents('1.005')).toBe(101);
    expect(decimalTextToCents(undefined)).toBe(0);
    expect(() => decimalTextToCents('1,50')).toThrow('Valor inválido');
  });
});
