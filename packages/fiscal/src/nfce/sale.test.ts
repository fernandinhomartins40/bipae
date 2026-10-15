import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import {
  brasiliaDateTime,
  buildSaleNfce,
  HOMOLOGATION_FIRST_ITEM,
  saleNumericCode,
  type SaleNfceInput,
} from './sale';
import { pdvPaymentCode } from '../tables/pdv-payments';

/** F3-14.a: da venda do caixa à NFC-e. */

const SALE_ID = '0192a000-0000-7000-8000-00000000abcd';

const venda = (over: Partial<SaleNfceInput> = {}): SaleNfceInput => ({
  saleId: SALE_ID,
  company: {
    cnpj: '11.222.333/0001-81',
    legalName: 'Mercadinho Bipaê LTDA',
    tradeName: 'Mercadinho Bipaê',
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
      phone: '(11) 3333-4444',
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
      profile: {
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        csosn: '102',
        cClassTrib: '000001',
        origem: 0,
      },
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
      profile: {
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        csosn: '102',
        cClassTrib: '000001',
        origem: 0,
      },
    },
  ],
  payments: [
    { method: 'cash', amountCents: 5000, changeCents: 420 },
    { method: 'pix', amountCents: 1580 },
  ],
  customerTaxId: '123.456.789-09',
  appVersion: 'Bipaê 1.0',
  ...over,
});

describe('venda → NFC-e (F3-14.a)', () => {
  it('monta a NFC-e válida no schema, com série e número do caixa, CPF, tPag e troco', async () => {
    const r = buildSaleNfce(venda());
    if (!r.ok) throw new Error(r.pending.join('; '));
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.input).toMatchObject({
      series: 3,
      number: 42,
      cUF: '35',
      customer: { cpf: '12345678909' },
    });
    expect(r.document.accessKey).toMatch(/^35\d{4}11222333000181650030000000421\d{9}$/);
    const xml = r.document.xml;
    expect(xml).toContain(`<xProd>${HOMOLOGATION_FIRST_ITEM}</xProd>`);
    expect(xml).toContain('<xProd>Banana prata</xProd>');
    expect(xml).toContain('<cEAN>7891000315507</cEAN>');
    // Código interno da balança não é GTIN.
    expect(xml).toContain('<cEAN>SEM GTIN</cEAN>');
    expect(xml).toContain('<tPag>01</tPag><vPag>54.20</vPag>');
    expect(xml).toContain('<tPag>20</tPag><vPag>15.80</vPag>');
    expect(xml).toContain('<vTroco>4.20</vTroco>');
    expect(xml).toContain('<dhEmi>2026-10-15T15:30:00-03:00</dhEmi>');
    // A mesma venda gera sempre a mesma chave (novas tentativas não criam outra nota).
    const again = buildSaleNfce(venda());
    expect(again.ok && again.document.accessKey).toBe(r.document.accessKey);
  });

  it('lista tudo o que falta, sem montar nota pela metade', () => {
    const r = buildSaleNfce(
      venda({
        company: {
          ...venda().company,
          ie: null,
          address: { ...venda().company.address, cityCode: '' },
        },
        items: [{ ...venda().items[0]!, ncm: null, profile: null }],
        payments: [{ method: 'boleto', amountCents: 5780 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pending).toEqual(
      expect.arrayContaining([
        'Falta a inscrição estadual da empresa (Empresas e lojas).',
        'Falta o município da empresa (Empresas e lojas).',
        'Item 1 (Arroz tipo 1 5kg): o produto não tem NCM.',
        'Forma de pagamento sem código na NFC-e: boleto.',
      ]),
    );
    expect(r.pending.some((p) => p.includes('perfil fiscal'))).toBe(true);
  });

  it('sem regime e com CNPJ, regras e erro de montagem viram pendência', () => {
    const semRegime = buildSaleNfce(venda({ company: { ...venda().company, regime: null } }));
    expect(semRegime.ok).toBe(false);
    // Número fora da faixa: o motor recusa e a mensagem vira pendência.
    const foraDaFaixa = buildSaleNfce(venda({ terminalSeq: 1_000_000_000 }));
    expect(foraDaFaixa.ok).toBe(false);
    const cnpj = buildSaleNfce(venda({ customerTaxId: '11222333000181' }));
    expect(cnpj.ok && cnpj.input.customer).toEqual({ cnpj: '11222333000181' });
  });
});

describe('detalhes da NFC-e da venda', () => {
  it('horário de Brasília e cNF diferente do número', () => {
    expect(brasiliaDateTime('2026-01-01T02:00:00Z')).toBe('2025-12-31T23:00:00-03:00');
    const code = saleNumericCode(SALE_ID, 1);
    expect(code).toMatch(/^\d{8}$/);
    expect(saleNumericCode(SALE_ID, Number(code))).not.toBe(code);
  });

  it('Pix e vale seguem a escolha da empresa, só entre as opções da tabela', () => {
    expect(pdvPaymentCode('pix', '2026-10-15')).toBe('20');
    expect(pdvPaymentCode('pix', '2026-10-15', { pix: '17' })).toBe('17');
    expect(pdvPaymentCode('pix', '2026-10-15', { pix: '99' })).toBe('20');
    expect(pdvPaymentCode('voucher', '2026-10-15', { voucher: '11' })).toBe('11');
    // O código 05 só vale a partir de 01/07/2024.
    expect(() => pdvPaymentCode('store_credit', '2024-01-01')).toThrow('não vale');
  });
});
