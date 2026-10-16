import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import {
  brasiliaDateTime,
  buildSaleNfce,
  HOMOLOGATION_FIRST_ITEM,
  saleNumericCode,
  buildSaleNfceContingency,
  prorateFreight,
  type SaleNfceInput,
} from './sale';
import { pdvPaymentCode } from '../tables/pdv-payments';
import type { WebCryptoKey } from './sign';

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

  it('cartão vai com o grupo card (tpIntegra 2) e o CPF com o nome de homologação', async () => {
    const r = buildSaleNfce(
      venda({
        payments: [{ method: 'credit', amountCents: 6580, authorizationCode: 'A1B2C3' }],
      }),
    );
    if (!r.ok) throw new Error(r.pending.join('; '));
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain(
      '<tPag>03</tPag><vPag>65.80</vPag><card><tpIntegra>2</tpIntegra><cAut>A1B2C3</cAut></card>',
    );
    expect(r.document.xml).toContain(
      '<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>',
    );
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
    expect(cnpj.ok && cnpj.input.customer).toEqual({
      cnpj: '11222333000181',
      name: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
    });
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
    // Pix dinâmico (17) só com cobrança por PSP, que o caixa ainda não faz (D-029).
    expect(pdvPaymentCode('pix', '2026-10-15', { pix: '17' })).toBe('20');
    expect(pdvPaymentCode('pix', '2026-10-15', { pix: '99' })).toBe('20');
    expect(pdvPaymentCode('voucher', '2026-10-15', { voucher: '11' })).toBe('11');
    // O código 05 só vale a partir de 01/07/2024.
    expect(() => pdvPaymentCode('store_credit', '2024-01-01')).toThrow('não vale');
  });
});

describe('NFC-e em contingência off-line (F3-15.a)', () => {
  const chaves = () =>
    crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-1',
      },
      true,
      ['sign', 'verify'],
    ) as unknown as Promise<{ privateKey: WebCryptoKey; publicKey: WebCryptoKey }>;

  it('tpEmis 9 na chave e no ide, dhCont e xJust, QR Code versão 3 assinado e válido no schema', async () => {
    const par = await chaves();
    const r = await buildSaleNfceContingency(
      venda(),
      {
        enteredAt: '2026-10-15T15:25:00-03:00',
        reason: 'Caixa sem conexão com a internet no momento da venda',
      },
      { privateKey: par.privateKey, certificate: 'AAAA' },
    );
    if (!r.ok) throw new Error(r.pending.join('; '));
    const xml = r.document.xml;
    expect(await validate(xml)).toEqual([]);
    // A 35ª posição da chave é o tipo de emissão.
    expect(r.document.accessKey[34]).toBe('9');
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain(
      '<dhCont>2026-10-15T15:25:00-03:00</dhCont><xJust>Caixa sem conexão com a internet no momento da venda</xJust>',
    );
    // QR Code: chave|3|2|dia|vNF|2 (CPF)|CPF|assinatura.
    const p = r.document.qrCode.split('?p=')[1]!.split('|');
    expect(p.slice(0, 7)).toEqual([
      r.document.accessKey,
      '3',
      '2',
      '15',
      '65.80',
      '2',
      '12345678909',
    ]);
    const assinatura = Uint8Array.from(atob(p[7]!), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      par.publicKey,
      assinatura,
      new TextEncoder().encode(p.slice(0, 7).join('|')),
    );
    expect(ok).toBe(true);
    // A mesma venda em contingência gera sempre a mesma chave (a transmissão mantém a chave).
    const deNovo = await buildSaleNfceContingency(
      venda(),
      { enteredAt: '2026-10-15T15:25:00-03:00', reason: 'Caixa sem conexão com a internet' },
      { privateKey: par.privateKey, certificate: 'AAAA' },
    );
    expect(deNovo.ok && deNovo.document.accessKey).toBe(r.document.accessKey);
  });

  it('sem destinatário, o QR Code leva os separadores vazios; justificativa curta é recusada', async () => {
    const par = await chaves();
    const signer = {
      certificate: 'AAAA',
      sign: async (data: Uint8Array) => {
        const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, data);
        return btoa(String.fromCharCode(...new Uint8Array(s)));
      },
    };
    const r = await buildSaleNfceContingency(
      venda({ customerTaxId: null }),
      { enteredAt: '2026-10-15T15:25:00-03:00', reason: 'Sem internet no caixa da loja' },
      signer,
    );
    if (!r.ok) throw new Error(r.pending.join('; '));
    expect(r.document.qrCode).toMatch(/\|15\|65\.80\|\|\|[A-Za-z0-9+/=]+$/);
    const curta = await buildSaleNfceContingency(
      venda(),
      { enteredAt: '2026-10-15T15:25:00-03:00', reason: 'Sem rede' },
      signer,
    );
    expect(curta.ok).toBe(false);
    expect(!curta.ok && curta.pending[0]).toBe(
      'A justificativa da contingência precisa ter de 15 a 256 caracteres.',
    );
  });
});

describe('NFC-e de entrega a domicílio (F5-10, dúvida D-032)', () => {
  const entrega = {
    feeCents: 700,
    address: {
      street: 'Rua das Acácias',
      number: '45',
      complement: 'Apto 12',
      district: 'Jardim Paulista',
      cityCode: '3550308',
      cityName: 'São Paulo',
      uf: 'SP',
      cep: '01415-000',
      phone: '(11) 98888-7777',
    },
  };

  it('vai com indPres 4, frete rateado nos itens, endereço e transportador, válida no schema', async () => {
    const r = buildSaleNfce(
      venda({ delivery: entrega, payments: [{ method: 'pix', amountCents: 5780 + 800 + 700 }] }),
    );
    if (!r.ok) throw new Error(r.pending.join('; '));
    expect(await validate(r.document.xml)).toEqual([]);
    const xml = r.document.xml;
    expect(xml).toContain('<indPres>4</indPres><indIntermed>0</indIntermed>');
    expect(xml).toContain(
      '<enderDest><xLgr>Rua das Acácias</xLgr><nro>45</nro><xCpl>Apto 12</xCpl>',
    );
    expect(xml).toContain(
      '<cMun>3550308</cMun><xMun>São Paulo</xMun><UF>SP</UF><CEP>01415000</CEP>',
    );
    expect(xml).toContain('<modFrete>0</modFrete><transporta><CNPJ>11222333000181</CNPJ>');
    // R$ 7,00 rateados pelo valor dos itens (57,80 e 8,00): 6,15 + 0,85.
    expect(xml).toContain('<vFrete>6.15</vFrete>');
    expect(xml).toContain('<vFrete>0.85</vFrete>');
    expect(xml).toContain('<vFrete>7.00</vFrete>');
    // O total da nota inclui a taxa.
    expect(r.document.totalCents).toBe(5780 + 800 + 700);
  });

  it('sem CPF ou sem endereço, fica a lista do que falta', () => {
    const semCpf = buildSaleNfce(venda({ delivery: entrega, customerTaxId: null }));
    expect(semCpf.ok).toBe(false);
    if (!semCpf.ok) {
      expect(semCpf.pending).toContain(
        'A venda para entrega precisa do CPF ou CNPJ do cliente na nota (regra 787 da SEFAZ).',
      );
    }
    const semEndereco = buildSaleNfce(
      venda({
        delivery: {
          feeCents: 500,
          address: { ...entrega.address, street: ' ', cityCode: null, cityName: null, uf: null },
        },
      }),
    );
    expect(semEndereco.ok).toBe(false);
    if (!semEndereco.ok) {
      expect(semEndereco.pending).toEqual(
        expect.arrayContaining([
          'Falta o endereço de entrega (rua, número e bairro).',
          'Falta o município do endereço de entrega.',
        ]),
      );
    }
  });

  it('reparte o frete sem perder centavo', () => {
    expect(prorateFreight(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(prorateFreight(0, [5, 5])).toEqual([0, 0]);
    expect(prorateFreight(100, [0, 0])).toEqual([0, 0]);
  });
});
