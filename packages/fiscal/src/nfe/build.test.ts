import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import { calculateContribution } from '../taxes/contributions';
import { calculateDifal } from '../taxes/difal';
import { calculateIbsCbs } from '../taxes/ibs-cbs';
import { calculateIcms } from '../taxes/icms';
import { calculateIpi } from '../taxes/ipi';
import { buildNfe, type NfeInput } from './build';
import { NfeBuildError, type NfeItem } from './groups';

/** F3-08.a: XML da NF-e (modelo 55) validado contra os schemas oficiais (PL_010f). */

const HOJE = '2026-06-15';
const EMITENTE: NfeInput['issuer'] = {
  cnpj: '11222333000181',
  name: 'Distribuidora Bipaê LTDA',
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
    phone: '1133334444',
  },
};
const CLIENTE: NfeInput['recipient'] = {
  cnpj: '11444777000161',
  name: 'Mercado do Bairro LTDA',
  ieIndicator: 1,
  ie: '111222333444',
  email: 'compras@mercado.com.br',
  address: {
    street: 'Avenida Brasil',
    number: '2000',
    complement: 'Galpão 3',
    district: 'Jardim América',
    cityCode: '3509502',
    cityName: 'Campinas',
    uf: 'SP',
    cep: '13010000',
  },
};

/** Item do Lucro Real com frete rateado, IPI e ICMS com substituição tributária. */
function itemComSt(over: Partial<NfeItem> = {}): NfeItem {
  const ipi = calculateIpi({ cst: '50', rate: '10' }, { baseCents: 10_500 });
  const icms = calculateIcms(
    { cst: '10', rate: '18', st: { mva: '40', rate: '18' } },
    { baseCents: 10_500, ipiCents: ipi.amountCents },
  );
  return {
    code: 'REF-2L',
    gtin: '7894900011517',
    description: 'Refrigerante 2 L (fardo com 6)',
    ncm: '22021000',
    cest: '0300700',
    cfop: '5401',
    unit: 'FD',
    quantityMilli: 10_000,
    unitPriceCents: 1000,
    grossCents: 10_000,
    discountCents: 0,
    freightCents: 500,
    origin: '0',
    icms,
    ipi: { result: ipi, legalFramework: '999' },
    pis: calculateContribution('PIS', { cst: '01', rate: '1.65' }, { baseCents: 10_000 }),
    cofins: calculateContribution('COFINS', { cst: '01', rate: '7.6' }, { baseCents: 10_000 }),
    ibsCbs: calculateIbsCbs({ cClassTrib: '000001', date: HOJE, operationCents: 10_000 }),
    order: { number: 'PC-778', item: '1' },
    ...over,
  };
}

const nota = (over: Partial<NfeInput> = {}): NfeInput => ({
  issuer: EMITENTE,
  cUF: '35',
  series: 1,
  number: 1001,
  issuedAt: '2026-06-15T10:30:00-03:00',
  leavesAt: '2026-06-15T14:00:00-03:00',
  numericCode: '87654321',
  nature: 'Venda de mercadoria',
  direction: 'saida',
  purpose: 'normal',
  presence: 'outros',
  finalConsumer: false,
  recipient: CLIENTE,
  items: [itemComSt()],
  transport: {
    freight: 'porContaDoRemetente',
    carrier: {
      cnpj: '22333444000102',
      name: 'Transportes Rápidos',
      ie: '222333444555',
      uf: 'SP',
      cityName: 'São Paulo',
    },
    volumes: [{ quantity: 10, species: 'FARDO', netKg: '120.000', grossKg: '125.500' }],
  },
  billing: {
    invoice: { number: '1001', originalCents: 12_571, discountCents: 0 },
    installments: [
      { number: '001', dueDate: '2026-07-15', amountCents: 6285 },
      { number: '002', dueDate: '2026-08-14', amountCents: 6286 },
    ],
  },
  payments: [{ code: '15', amountCents: 12_571 }],
  appVersion: 'Bipae 0.3.0',
  ...over,
});

describe('XML da NF-e contra o schema oficial', () => {
  it('Lucro Real: destinatário contribuinte, IPI, ST, frete, transporte e duplicatas', async () => {
    const doc = buildNfe(nota());
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.accessKey.slice(20, 22)).toBe('55');
    expect(doc.xml).toContain('<mod>55</mod>');
    expect(doc.xml).toContain('<tpAmb>2</tpAmb>');
    expect(doc.xml).toContain('<idDest>1</idDest>');
    expect(doc.xml).toContain('<tpImp>1</tpImp>');
    expect(doc.xml).toContain('<indPres>9</indPres><indIntermed>0</indIntermed>');
    expect(doc.xml).toContain('<indIEDest>1</indIEDest><IE>111222333444</IE>');
    expect(doc.xml).toContain('<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>105.00</vBC>');
    // ICMS 18% sobre 105,00; ST: (105,00 + 10,50 de IPI) × 1,4 × 18% − 18,90 = 10,21.
    expect(doc.xml).toContain('<vICMS>18.90</vICMS>');
    expect(doc.xml).toContain(
      '<vBCST>161.70</vBCST><pICMSST>18.00</pICMSST><vICMSST>10.21</vICMSST>',
    );
    expect(doc.xml).toContain('<xPed>PC-778</xPed><nItemPed>1</nItemPed>');
    // vNF = produtos 100,00 + ST 10,21 + frete 5,00 + IPI 10,50.
    expect(doc.xml).toContain('<vNF>125.71</vNF>');
    expect(doc.totalCents).toBe(12_571);
    expect(doc.xml).toContain(
      '<dup><nDup>001</nDup><dVenc>2026-07-15</dVenc><vDup>62.85</vDup></dup>',
    );
    expect(doc.xml).not.toContain('infNFeSupl');
  });

  it('Simples Nacional para outro estado: crédito, ST e idDest 2', async () => {
    const icms = calculateIcms(
      {
        csosn: '201',
        rate: '12',
        creditRate: '2.5',
        st: { mva: '50', rate: '17', baseReduction: '10' },
      },
      { baseCents: 20_000 },
    );
    const doc = buildNfe(
      nota({
        issuer: { ...EMITENTE, crt: 1 },
        recipient: {
          ...CLIENTE,
          address: {
            ...CLIENTE.address,
            uf: 'MG',
            cityCode: '3106200',
            cityName: 'Belo Horizonte',
          },
        },
        items: [
          itemComSt({
            cfop: '6403',
            grossCents: 20_000,
            unitPriceCents: 2000,
            freightCents: undefined,
            icms,
            ipi: null,
            pis: null,
            cofins: null,
          }),
        ],
        billing: undefined,
        payments: [{ code: '01', amountCents: 20_000 + icms.st!.amountCents }],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<idDest>2</idDest>');
    expect(doc.xml).toContain('<ICMSSN201><orig>0</orig><CSOSN>201</CSOSN><modBCST>4</modBCST>');
    expect(doc.xml).toContain('<pRedBCST>10.00</pRedBCST>');
    expect(doc.xml).toContain('<pCredSN>2.50</pCredSN>');
  });

  it('devolução referencia a nota de origem e vai sem pagamento', async () => {
    const icms = calculateIcms({ cst: '00', rate: '18' }, { baseCents: 5000 });
    const doc = buildNfe(
      nota({
        nature: 'Devolução de compra para comercialização',
        purpose: 'devolucao',
        presence: 'naoSeAplica',
        references: ['35260611444777000161550010000012341123456780'],
        items: [
          itemComSt({
            cfop: '5202',
            grossCents: 5000,
            unitPriceCents: 500,
            freightCents: undefined,
            icms,
            ipi: null,
            order: undefined,
          }),
        ],
        transport: { freight: 'semFrete' },
        billing: undefined,
        payments: [{ code: '90', amountCents: 0 }],
        fiscalInfo: 'Devolução parcial da NF 1234',
        additionalInfo: 'Mercadoria com avaria',
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<finNFe>4</finNFe>');
    expect(doc.xml).toContain(
      '<NFref><refNFe>35260611444777000161550010000012341123456780</refNFe></NFref>',
    );
    expect(doc.xml).toContain('<indPres>0</indPres><procEmi>');
    expect(doc.xml).toContain('<detPag><tPag>90</tPag><vPag>0.00</vPag></detPag>');
    expect(doc.xml).toContain(
      '<infAdic><infAdFisco>Devolução parcial da NF 1234</infAdFisco><infCpl>',
    );
  });

  it('várias situações de ICMS na mesma nota, para consumidor final com CPF', async () => {
    const base = { baseCents: 10_000 };
    const situacoes = [
      calculateIcms({ cst: '20', rate: '18', baseReduction: '33.33', fcpRate: '2' }, base),
      calculateIcms({ cst: '51', rate: '18', deferral: '33.33' }, base),
      calculateIcms(
        { cst: '70', rate: '18', baseReduction: '20', st: { mva: '30', rate: '18' } },
        base,
      ),
      calculateIcms({ cst: '60' }, base),
      calculateIcms({ cst: '41' }, base),
      calculateIcms({ cst: '00', rate: '18', fcpRate: '2' }, base),
    ];
    const items = situacoes.map((icms, i) =>
      itemComSt({
        code: `P${i}`,
        cfop: icms.cst === '60' || icms.cst === '70' ? '5405' : '5102',
        cest: null,
        freightCents: undefined,
        icms,
        ipi: { result: calculateIpi({ cst: '53' }, base), legalFramework: '999' },
        order: undefined,
      }),
    );
    const vNF = items.reduce((t, i) => t + i.grossCents + (i.icms.st?.amountCents ?? 0), 0);
    const doc = buildNfe(
      nota({
        finalConsumer: true,
        presence: 'presencial',
        recipient: {
          cpf: '52998224725',
          name: 'Ana Souza',
          ieIndicator: 9,
          address: CLIENTE.address,
        },
        items,
        transport: { freight: 'porContaDoDestinatario' },
        billing: undefined,
        payments: [
          { code: '03', amountCents: vNF - 1000 },
          { code: '99', amountCents: 1000, description: 'Vale da loja' },
        ],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<indFinal>1</indFinal><indPres>1</indPres><procEmi>');
    expect(doc.xml).toContain(
      '<ICMS51><orig>0</orig><CST>51</CST><modBC>3</modBC><vBC>100.00</vBC>',
    );
    expect(doc.xml).toContain(
      '<vICMSOp>18.00</vICMSOp><pDif>33.3300</pDif><vICMSDif>6.00</vICMSDif><vICMS>12.00</vICMS>',
    );
    expect(doc.xml).toContain(
      '<ICMS70><orig>0</orig><CST>70</CST><modBC>3</modBC><pRedBC>20.00</pRedBC>',
    );
    expect(doc.xml).toContain(
      '<ICMS20><orig>0</orig><CST>20</CST><modBC>3</modBC><pRedBC>33.33</pRedBC>',
    );
    expect(doc.xml).toContain('<ICMS40><orig>0</orig><CST>41</CST></ICMS40>');
    expect(doc.xml).toContain('<IPINT><CST>53</CST></IPINT>');
    expect(doc.xml).toContain('<xPag>Vale da loja</xPag>');
    expect(doc.xml).toContain('<indIEDest>9</indIEDest>');
    expect(doc.totalCents).toBe(vNF);
  });

  it('Simples Nacional com ST sem crédito (CSOSN 202) e isento de inscrição', async () => {
    const icms = calculateIcms(
      { csosn: '202', rate: '18', st: { mva: '40', rate: '18' } },
      { baseCents: 10_000 },
    );
    const doc = buildNfe(
      nota({
        issuer: { ...EMITENTE, crt: 1 },
        recipient: { ...CLIENTE, ieIndicator: 2, ie: undefined },
        items: [itemComSt({ cfop: '5403', freightCents: undefined, icms, ipi: null })],
        billing: undefined,
        payments: [{ code: '01', amountCents: 10_000 + icms.st!.amountCents }],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<ICMSSN202>');
    expect(doc.xml).toContain('<indIEDest>2</indIEDest><email>');
  });
});

describe('partilha do ICMS na NF-e (F3-32)', () => {
  it('venda de SP para consumidor de MG: grupo ICMSUFDest e totais, válidos no XSD', async () => {
    const base = { baseCents: 10_000 };
    const icms = calculateIcms({ cst: '00', rate: '12' }, base);
    const difal = calculateDifal({
      ufOrigem: 'SP',
      ufDestino: 'MG',
      baseCents: 10_000,
      fcpRate: '2',
    });
    const item = itemComSt({
      cfop: '6108',
      cest: null,
      freightCents: undefined,
      icms,
      ipi: null,
      order: undefined,
      difal,
    });
    const doc = buildNfe(
      nota({
        finalConsumer: true,
        presence: 'internet',
        recipient: {
          cpf: '52998224725',
          name: 'Ana Souza',
          ieIndicator: 9,
          address: {
            ...CLIENTE.address,
            uf: 'MG',
            cityCode: '3106200',
            cityName: 'Belo Horizonte',
          },
        },
        items: [item],
        billing: undefined,
        payments: [{ code: '03', amountCents: 10_000 }],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain(
      '<ICMSUFDest><vBCUFDest>100.00</vBCUFDest><vBCFCPUFDest>100.00</vBCFCPUFDest><pFCPUFDest>2.00</pFCPUFDest><pICMSUFDest>18.00</pICMSUFDest><pICMSInter>12.00</pICMSInter><pICMSInterPart>100.00</pICMSInterPart><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>6.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>',
    );
    expect(doc.xml).toContain(
      '<vICMSDeson>0.00</vICMSDeson><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>6.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet><vFCP>',
    );
    // A partilha não soma no total da nota: é recolhida pelo remetente à parte.
    expect(doc.totalCents).toBe(10_000);
  });
});

describe('NF-e do MEI (F3-30)', () => {
  const meiItem = (cfop: string) =>
    itemComSt({
      cfop,
      cest: null,
      freightCents: undefined,
      icms: calculateIcms({ csosn: '102' }, { baseCents: 10_000 }),
      ipi: null,
      pis: null,
      cofins: null,
      order: undefined,
    });
  const anaRj = {
    cpf: '52998224725',
    name: 'Ana Souza',
    ieIndicator: 9 as const,
    address: { ...CLIENTE.address, uf: 'RJ', cityCode: '3304557', cityName: 'Rio de Janeiro' },
  };

  it('venda para outro estado: CRT 4, CFOP 6102, sem a partilha do ICMS (regra NA01-20)', async () => {
    const doc = buildNfe(
      nota({
        issuer: { ...EMITENTE, crt: 4 },
        finalConsumer: true,
        presence: 'internet',
        recipient: anaRj,
        items: [meiItem('6102')],
        billing: undefined,
        payments: [{ code: '03', amountCents: 10_000 }],
      }),
    );
    expect(await validate(doc.xml)).toEqual([]);
    expect(doc.xml).toContain('<CRT>4</CRT>');
    expect(doc.xml).not.toContain('ICMSUFDest');
  });

  it('CFOP fora da lista do MEI vira erro antes da SEFAZ (rejeição 337)', () => {
    expect(() =>
      buildNfe(nota({ issuer: { ...EMITENTE, crt: 4 }, items: [meiItem('5405')] })),
    ).toThrow('Item 1: Com o CSOSN 102, o MEI só usa os CFOP 5102, 6102 (está 5405).');
  });
});

describe('NF-e incoerente vira erro claro, antes da SEFAZ', () => {
  const erro = (over: Partial<NfeInput>) => () => buildNfe(nota(over));

  it('CFOP precisa combinar com a direção e com o estado do destinatário', () => {
    expect(erro({ items: [itemComSt({ cfop: '1102' })] })).toThrow(
      'é de entrada, mas a nota é de saida',
    );
    expect(erro({ items: [itemComSt({ cfop: '6102' })] })).toThrow(
      'operação interestadual, mas o destinatário está no mesmo estado',
    );
    expect(erro({ items: [itemComSt({ cfop: '7102' })] })).toThrow('exterior');
    expect(erro({ items: [itemComSt({ cfop: '51' })] })).toThrow('CFOP 51 inválido');
  });

  it('venda interestadual a não contribuinte exige a partilha em cada item (F3-32)', () => {
    const anaRj = {
      cpf: '52998224725',
      name: 'Ana',
      ieIndicator: 9 as const,
      address: { ...CLIENTE.address, uf: 'RJ' },
    };
    expect(
      erro({ finalConsumer: true, recipient: anaRj, items: [itemComSt({ cfop: '6108' })] }),
    ).toThrow('Item 1: falta a partilha do ICMS (DIFAL)');
    const difal = calculateDifal({ ufOrigem: 'SP', ufDestino: 'RJ', baseCents: 10_000 });
    expect(erro({ items: [itemComSt({ difal })] })).toThrow(
      'só vale na venda para consumidor final não contribuinte',
    );
    expect(NfeBuildError).toBeDefined();
  });

  it('confere destinatário, referências, fatura, itens e IPI', () => {
    expect(erro({ recipient: { ...CLIENTE, cpf: '52998224725' } })).toThrow('só um');
    expect(erro({ recipient: { ...CLIENTE, ie: undefined } })).toThrow('inscrição estadual');
    expect(erro({ recipient: { ...CLIENTE, ieIndicator: 9 } })).toThrow(
      'Só o destinatário contribuinte',
    );
    expect(erro({ purpose: 'devolucao' })).toThrow('chave da nota devolvida');
    expect(erro({ references: ['123'] })).toThrow('Chave referenciada inválida');
    expect(
      erro({
        billing: {
          invoice: { number: '1', originalCents: 100, discountCents: 0 },
          installments: [],
        },
      }),
    ).toThrow('parcelas');
    expect(erro({ items: [] })).toThrow('pelo menos um item');
    expect(erro({ items: Array(991).fill(itemComSt()) })).toThrow('990 itens');
    expect(
      erro({
        items: [
          itemComSt({
            ipi: { result: calculateIpi({ cst: '53' }, { baseCents: 1 }), legalFramework: '9' },
          }),
        ],
      }),
    ).toThrow('enquadramento do IPI');
  });

  it('pagamento "sem pagamento" vem sozinho e zerado', () => {
    expect(erro({ payments: [{ code: '90', amountCents: 10 }] })).toThrow('"Sem pagamento" (90)');
    expect(
      erro({
        payments: [
          { code: '90', amountCents: 0 },
          { code: '01', amountCents: 0 },
        ],
      }),
    ).toThrow('(90)');
    expect(erro({ payments: [] })).toThrow('precisam somar');
    expect(erro({ payments: [{ code: '77', amountCents: 12_571 }] })).toThrow(
      'Meio de pagamento 77',
    );
  });

  it('o validador realmente reprova o destinatário sem CPF nem CNPJ', async () => {
    const semCnpj = buildNfe(nota()).xml.replace(/<dest><CNPJ>.*?<\/CNPJ>/, '<dest>');
    expect((await validate(semCnpj)).length).toBeGreaterThan(0);
  });
});
