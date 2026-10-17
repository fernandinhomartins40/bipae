import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import { HOMOLOGATION_RECIPIENT_NAME } from '../nfce/sale';
import { buildDraftNfe, nonContributorCfop, type NfeDraftInput } from './draft';

/** F3-33.a: a NF-e preenchida na retaguarda vira XML com os impostos do motor. */

const DRAFT_ID = '0192a000-0000-7000-8000-00000000beef';

const PERFIL = {
  cfopInterna: '5102',
  cfopInterestadual: '6102',
  cstIcms: '00',
  cstPisCofins: '01',
  cClassTrib: '000001',
  origem: 0,
};

const nota = (over: Partial<NfeDraftInput> = {}): NfeDraftInput => ({
  draftId: DRAFT_ID,
  company: {
    cnpj: '11.222.333/0001-81',
    legalName: 'Distribuidora Bipaê LTDA',
    tradeName: 'Distribuidora Bipaê',
    ie: '110.042.490.114',
    uf: 'SP',
    regime: 'presumido',
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
  series: 1,
  number: 15,
  issuedAt: '2026-10-15T18:30:00.000Z',
  nature: 'Venda de mercadoria',
  purpose: 'normal',
  presence: 'teleatendimento',
  recipient: {
    taxId: '11.444.777/0001-61',
    name: 'Mercado do Bairro LTDA',
    ieIndicator: 1,
    ie: '111.222.333.444',
    email: 'compras@mercado.com.br',
    address: {
      street: 'Avenida Brasil',
      number: '2000',
      district: 'Jardim América',
      cityCode: '3550308',
      cityName: 'São Paulo',
      uf: 'SP',
      cep: '01430-000',
    },
  },
  items: [
    {
      code: 'ARROZ5',
      barcodes: ['7891000315507'],
      description: 'Arroz tipo 1 5kg',
      ncm: '10063021',
      unit: 'FD',
      quantityMilli: 10_000,
      unitPriceCents: 2_500,
      grossCents: 25_000,
      discountCents: 0,
      profile: PERFIL,
    },
  ],
  transport: { freight: 'porContaDoRemetente', freightCents: 1_000 },
  payments: [{ code: '15', amountCents: 26_000 }],
  appVersion: 'Bipaê 1.0',
  ...over,
});

const ALIQUOTA_SP = {
  rules: [
    {
      id: 'r1',
      name: 'Arroz em SP',
      ncm: ['10063021'],
      validity: { start: '2026-01-01' },
      effect: { rate: '18' },
      source: 'Exemplo de cadastro',
    },
  ],
};

describe('NF-e da retaguarda (F3-33.a)', () => {
  it('venda dentro do estado para contribuinte: válida no schema, com frete e boleto', async () => {
    const r = buildDraftNfe(nota(ALIQUOTA_SP));
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<mod>55</mod><serie>1</serie><nNF>15</nNF>');
    expect(r.document.xml).toContain('<idDest>1</idDest>');
    expect(r.document.xml).toContain('<indFinal>0</indFinal>');
    expect(r.document.xml).toContain(`<xNome>${HOMOLOGATION_RECIPIENT_NAME}</xNome>`);
    expect(r.document.xml).toContain('<CFOP>5102</CFOP>');
    expect(r.document.xml).toContain('<vFrete>10.00</vFrete>');
    expect(r.document.xml).toContain('<tPag>15</tPag>');
    expect(r.document.totalCents).toBe(26_000);
    // A mesma nota gera sempre a mesma chave (novas tentativas).
    const again = buildDraftNfe(nota(ALIQUOTA_SP));
    expect(again.ok && again.document.accessKey).toBe(r.document.accessKey);
  });

  it('venda a prazo: fatura com o número da nota e duplicatas 001, 002', async () => {
    const r = buildDraftNfe(
      nota({
        ...ALIQUOTA_SP,
        installments: [
          { dueDate: '2026-11-15', amountCents: 13_000 },
          { dueDate: '2026-12-15', amountCents: 13_000 },
        ],
      }),
    );
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<nFat>15</nFat>');
    expect(r.document.xml).toContain('<nDup>002</nDup><dVenc>2026-12-15</dVenc>');
  });

  it('para consumidor de outro estado: alíquota interestadual, CFOP 6108 e partilha do ICMS', async () => {
    const r = buildDraftNfe(
      nota({
        presence: 'internet',
        recipient: {
          taxId: '123.456.789-09',
          name: 'Maria da Silva',
          ieIndicator: 9,
          address: {
            street: 'Rua da Bahia',
            number: '10',
            district: 'Centro',
            cityCode: '3106200',
            cityName: 'Belo Horizonte',
            uf: 'MG',
            cep: '30160-010',
          },
        },
        transport: { freight: 'porContaDoRemetente' },
        payments: [{ code: '17', amountCents: 25_000 }],
      }),
    );
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<idDest>2</idDest>');
    expect(r.document.xml).toContain('<indFinal>1</indFinal>');
    expect(r.document.xml).toContain('<CFOP>6108</CFOP>');
    expect(r.document.xml).toContain('<pICMS>12.00</pICMS>');
    expect(r.document.xml).toContain('<ICMSUFDest>');
    expect(r.notes.join(' ')).toContain('CFOP 6108 (venda a não contribuinte)');
  });

  it('mercadoria importada vai a 4% para outro estado (Resolução do Senado 13/2012)', () => {
    const base = nota();
    const r = buildDraftNfe(
      nota({
        recipient: {
          ...base.recipient,
          address: {
            ...base.recipient.address,
            uf: 'RJ',
            cityCode: '3304557',
            cityName: 'Rio de Janeiro',
          },
        },
        items: [{ ...base.items[0]!, profile: { ...PERFIL, origem: 1 } }],
      }),
    );
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(r.document.xml).toContain('<CFOP>6102</CFOP>');
    expect(r.document.xml).toContain('<pICMS>4.00</pICMS>');
  });

  it('o que falta vira lista para quem vai resolver, sem montar a nota', () => {
    const base = nota();
    const r = buildDraftNfe(
      nota({
        recipient: {
          ...base.recipient,
          taxId: null,
          ieIndicator: 1,
          ie: null,
          address: { ...base.recipient.address, cep: null },
        },
        items: [{ ...base.items[0]!, ncm: null }],
        payments: [{ code: '98', amountCents: 26_000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pending).toEqual(
      expect.arrayContaining([
        'Falta o CPF ou o CNPJ do destinatário.',
        'Destinatário contribuinte do ICMS precisa da inscrição estadual.',
        'Falta o CEP do destinatário.',
        'Item 1 (Arroz tipo 1 5kg): o produto não tem NCM.',
        'Meio de pagamento 98 não existe na tabela oficial em 2026-10-15.',
      ]),
    );
  });

  it('erro do montador (parcelas que não somam o total) volta como pendência', () => {
    const r = buildDraftNfe(
      nota({ ...ALIQUOTA_SP, installments: [{ dueDate: '2026-11-15', amountCents: 1_000 }] }),
    );
    expect(r).toEqual({
      ok: false,
      pending: ['As parcelas precisam somar o valor líquido da fatura.'],
    });
  });
});

describe('CFOP de venda a não contribuinte, pela tabela oficial', () => {
  it('6102 → 6108 e 6101 → 6107; sem correspondente, null', () => {
    expect(nonContributorCfop('6102')).toBe('6108');
    expect(nonContributorCfop('6101')).toBe('6107');
    expect(nonContributorCfop('6108')).toBeNull();
    expect(nonContributorCfop('6403')).toBeNull();
  });
});
