import { describe, expect, it } from 'vitest';
import { buildEfdIcmsIpi, type EfdCompany, type EfdEntry, type EfdInput } from './build';
import {
  ciapOutputIndex,
  ciapParcel,
  EFD_CIAP_RULES,
  fixedAssetCredit,
  planCiap,
  type EfdCiap,
  type EfdFixedAsset,
} from './ciap';
import { readEfdDocument, type EfdDocument, type EfdItem } from './read';

/**
 * F4-14.b.7: CIAP no bloco G (LC 87/1996, art. 20, § 5º; Guia Prático 3.2.2, registros 0300,
 * 0305, 0500, 0600, G110, G125, G130, G140 e E111).
 */

const company: EfdCompany = {
  legalName: 'Mercadinho Bipaê LTDA',
  cnpj: '11222333000181',
  ie: '110042490114',
  uf: 'SP',
  cityCode: '3550308',
};

/** Nota de compra de um freezer para o ativo: ICMS de R$ 480,00 (18% de R$ 2.666,67). */
const assetXml =
  `<nfeProc><NFe><infNFe Id="NFe35261099887766000199550010000007771000000015">` +
  `<ide><mod>55</mod><serie>1</serie><nNF>777</nNF><dhEmi>2026-03-05T09:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>` +
  `<emit><CNPJ>99887766000199</CNPJ><xNome>Refrigeração Fornece</xNome><enderEmit><xLgr>Rua A</xLgr><nro>10</nro>` +
  `<xBairro>Centro</xBairro><cMun>3550308</cMun><cPais>1058</cPais></enderEmit><IE>123456789012</IE></emit>` +
  `<det nItem="1"><prod><cProd>FRZ</cProd><cEAN>SEM GTIN</cEAN><xProd>Freezer horizontal 500 L</xProd>` +
  `<NCM>84183000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vProd>2666.67</vProd></prod>` +
  `<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>2666.67</vBC><pICMS>18.00</pICMS><vICMS>480.00</vICMS></ICMS00></ICMS></imposto></det>` +
  `<total><ICMSTot><vNF>2666.67</vNF><vProd>2666.67</vProd></ICMSTot></total>` +
  `<transp><modFrete>0</modFrete></transp><pag><detPag><indPag>0</indPag><tPag>01</tPag></detPag></pag></infNFe></NFe></nfeProc>`;
const assetDoc = readEfdDocument(assetXml);

const freezer = (over: Partial<EfdFixedAsset> = {}): EfdFixedAsset => ({
  code: `${assetDoc.accessKey}-1`,
  description: 'Freezer horizontal 500 L',
  enteredOn: '2026-03-10',
  icms: fixedAssetCredit(assetDoc.items[0]!, false),
  source: { accessKey: assetDoc.accessKey, line: 1 },
  ...over,
});

const ciapConfig = (over: Partial<EfdCiap> = {}): EfdCiap => ({
  assets: [freezer()],
  account: { code: '1.2.3.01', name: 'Máquinas e equipamentos', level: 4 },
  adjustmentCode: 'SP020001',
  ...over,
});

/** Uma NFC-e própria já lida, com um item por CST (valor em centavos). */
let nextNumber = 1;
function sale(
  month: string,
  items: { cst: string; cents: number; icms?: number; cfop?: string }[],
) {
  const number = nextNumber++;
  const document: EfdDocument = {
    model: '65',
    accessKey: `3526031122233300018165001${String(number).padStart(9, '0')}1000000001`.slice(0, 44),
    series: 1,
    number,
    issuedOn: `${month}-15`,
    direction: 'out',
    purpose: '1',
    paymentIndicator: '0',
    freightMode: '9',
    totalCents: items.reduce((t, i) => t + i.cents, 0),
    productsCents: items.reduce((t, i) => t + i.cents, 0),
    discountCents: 0,
    freightCents: 0,
    insuranceCents: 0,
    otherCents: 0,
    items: items.map((i, n): EfdItem => ({
      line: n + 1,
      cfop: i.cfop ?? '5102',
      cstIcms: `0${i.cst}`,
      icmsRate: i.icms ? '18' : '0',
      productCents: i.cents,
      discountCents: 0,
      freightCents: 0,
      insuranceCents: 0,
      otherCents: 0,
      icmsBaseCents: i.icms ? i.cents : 0,
      icmsCents: i.icms ?? 0,
      stBaseCents: 0,
      stCents: 0,
      ipiCents: 0,
      supplierCode: `P${n}`,
      description: `Produto ${n}`,
      unit: 'UN',
      quantity: '1',
      origin: '0',
      supplierCst: i.cst,
      simplesCreditCents: 0,
    })),
  };
  return { status: 'authorized', document } satisfies EfdEntry;
}

const rows = (text: string) =>
  text
    .split('\r\n')
    .filter(Boolean)
    .map((l) => l.slice(1, -1).split('|'));

const base = (over: Partial<EfdInput> = {}): EfdInput => ({
  month: '2026-03',
  company,
  profile: 'A',
  accountant: { name: 'Contábil Exemplo', cpf: '52998224725' },
  entries: [],
  purchases: [
    {
      enteredOn: '2026-03-10',
      purpose: 'fixed_asset',
      document: assetDoc,
      products: {
        1: { code: 'FRZ500', name: 'Freezer horizontal 500 L', unit: 'UN', factor: '1' },
      },
    },
  ],
  ciap: ciapConfig(),
  ...over,
});

describe('conta do CIAP (LC 87/1996, art. 20, § 5º)', () => {
  it('parcela de 1/48, truncada nos centavos (G125, campo 10)', () => {
    expect(EFD_CIAP_RULES.installments).toBe(48);
    const icms = { ownCents: 48_000, stCents: 0, freightCents: 0, difalCents: 0 };
    expect(ciapParcel(icms, 48)).toBe(1000);
    // R$ 100,00 / 48 = 2,0833...: a parcela não pode passar do total dividido (vai 2,08).
    expect(ciapParcel({ ...icms, ownCents: 10_000 }, 48)).toBe(208);
    expect(ciapParcel({ ...icms, ownCents: 10_000, difalCents: 4_400 }, 48)).toBe(300);
  });

  it('índice: tributadas e exportações sobre o total das saídas, com 8 casas truncadas', () => {
    const r = ciapOutputIndex([
      { cst: '000', cfop: '5102', operationCents: 60_000, icmsCents: 10_800 },
      { cst: '040', cfop: '5102', operationCents: 20_000, icmsCents: 0 },
      { cst: '041', cfop: '7102', operationCents: 10_000, icmsCents: 0 }, // exportação
      { cst: '090', cfop: '5949', operationCents: 5_000, icmsCents: 0 }, // outras, sem ICMS
      { cst: '060', cfop: '5405', operationCents: 5_000, icmsCents: 0 },
    ]);
    expect(r).toEqual({
      taxedCents: 70_000,
      totalCents: 100_000,
      index: '0.70000000',
      stUndecided: true,
    });
    const st = ciapOutputIndex(
      [
        { cst: '000', cfop: '5102', operationCents: 1, icmsCents: 0 },
        { cst: '060', cfop: '5405', operationCents: 2, icmsCents: 0 },
      ],
      true,
    );
    expect(st).toMatchObject({ taxedCents: 3, index: '1.00000000', stUndecided: false });
    // 1/3 trunca em 0,33333333.
    expect(
      ciapOutputIndex([
        { cst: '000', cfop: '5102', operationCents: 1, icmsCents: 0 },
        { cst: '040', cfop: '5102', operationCents: 2, icmsCents: 0 },
      ]).index,
    ).toBe('0.33333333');
    // Sem saídas no mês, nada a apropriar.
    expect(ciapOutputIndex([]).index).toBe('0.00000000');
  });

  it('crédito apropriado = soma das parcelas × índice, meio para cima', () => {
    const outputs = [
      { cst: '000', cfop: '5102', operationCents: 75_000, icmsCents: 13_500 },
      { cst: '040', cfop: '5102', operationCents: 25_000, icmsCents: 0 },
    ];
    const plan = planCiap(ciapConfig(), '2026-03', '2026-03-01', '2026-03-31', outputs);
    expect(plan.parcelsCents).toBe(1000);
    expect(plan.index.index).toBe('0.75000000');
    expect(plan.appropriationCents).toBe(750);
    expect(plan.movements.map((m) => [m.type, m.installment])).toEqual([['IM', 1]]);
    // 1/3 de R$ 10,00 = 3,3333...: vai R$ 3,33.
    const third = planCiap(ciapConfig(), '2026-03', '2026-03-01', '2026-03-31', [
      { cst: '000', cfop: '5102', operationCents: 1, icmsCents: 0 },
      { cst: '040', cfop: '5102', operationCents: 2, icmsCents: 0 },
    ]);
    expect(third.appropriationCents).toBe(333);
  });

  it('meses seguintes como SI; a 48ª parcela vem com a baixa (BA); depois o bem sai', () => {
    const month = (m: string) => {
      const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0));
      return planCiap(ciapConfig(), m, `${m}-01`, end.toISOString().slice(0, 10), []);
    };
    const april = month('2026-04');
    expect(april.movements.map((m) => [m.type, m.date, m.installment])).toEqual([
      ['SI', '2026-04-01', 2],
    ]);
    expect(april.openingCents).toBe(48_000);
    const last = month('2030-02');
    expect(last.movements.map((m) => [m.type, m.installment ?? null, m.withValues])).toEqual([
      ['SI', 48, true],
      ['BA', null, false],
    ]);
    expect(month('2030-03').movements).toEqual([]);
    expect(month('2026-02').movements).toEqual([]);
  });

  it('saída do bem por perecimento: SI sem parcela e PE; a AT ainda não é gerada', () => {
    const lost = ciapConfig({ assets: [freezer({ disposal: { on: '2026-06-20', type: 'PE' } })] });
    const june = planCiap(lost, '2026-06', '2026-06-01', '2026-06-30', []);
    expect(june.movements.map((m) => [m.type, m.date, m.installment ?? null])).toEqual([
      ['SI', '2026-06-01', null],
      ['PE', '2026-06-20', null],
    ]);
    expect(june.parcelsCents).toBe(0);
    expect(planCiap(lost, '2026-07', '2026-07-01', '2026-07-31', []).movements).toEqual([]);
    const sold = ciapConfig({ assets: [freezer({ disposal: { on: '2026-06-20', type: 'AT' } })] });
    expect(() => planCiap(sold, '2026-06', '2026-06-01', '2026-06-30', [])).toThrow(
      'ainda não é gerada',
    );
  });

  it('crédito do item: só fornecedor do regime normal; empresa do Simples não credita', () => {
    const item = assetDoc.items[0]!;
    expect(fixedAssetCredit(item, false)).toEqual({
      ownCents: 48_000,
      stCents: 0,
      freightCents: 0,
      difalCents: 0,
    });
    expect(fixedAssetCredit(item, true).ownCents).toBe(0);
    expect(fixedAssetCredit({ ...item, supplierCst: '101' }, false).ownCents).toBe(0);
  });
});

describe('bloco G no arquivo da EFD (F4-14.b.7)', () => {
  const march = buildEfdIcmsIpi(
    base({
      entries: [
        sale('2026-03', [
          { cst: '00', cents: 300_000, icms: 54_000 },
          { cst: '40', cents: 100_000 },
        ]),
      ],
    }),
  );
  const lines = rows(march.text);
  const byReg = (reg: string) => lines.filter((l) => l[0] === reg);

  it('G110 com o índice e G125 batendo com a soma das parcelas', () => {
    const g110 = byReg('G110')[0]!;
    expect(g110).toEqual([
      'G110',
      '01032026',
      '31032026',
      '0,00',
      '10,00',
      '3000,00',
      '4000,00',
      '0,75000000',
      '7,50',
      '0,00',
    ]);
    const parcels = byReg('G125').reduce((t, l) => t + Number((l[9] || '0').replace(',', '')), 0);
    expect(Number(g110[4]!.replace(',', ''))).toBe(parcels);
    expect(byReg('G125')[0]).toEqual([
      'G125',
      `${assetDoc.accessKey}-1`,
      '10032026',
      'IM',
      '480,00',
      '0,00',
      '0,00',
      '0,00',
      '1',
      '10,00',
    ]);
    expect(byReg('G130')[0]!.slice(1, 8)).toEqual([
      '1',
      '99887766000199',
      '55',
      '001',
      '777',
      assetDoc.accessKey,
      '05032026',
    ]);
    expect(byReg('G140')[0]).toEqual([
      'G140',
      '1',
      'FRZ500',
      '1,00000',
      'UN',
      '480,00',
      '0,00',
      '0,00',
      '0,00',
    ]);
    expect(byReg('G001')[0]![1]).toBe('0');
  });

  it('o crédito vai ao E110 pelo E111 e entra no saldo', () => {
    expect(byReg('E111')[0]).toEqual([
      'E111',
      'SP020001',
      'Crédito do ICMS do ativo permanente (CIAP, bloco G)',
      '7,50',
    ]);
    const e110 = byReg('E110')[0]!;
    expect(e110[1]).toBe('540,00'); // débitos
    expect(e110[7]).toBe('7,50'); // VL_TOT_AJ_CREDITOS
    expect(march.settlement).toMatchObject({
      debitsCents: 54_000,
      adjustmentCreditsCents: 750,
      dueCents: 54_000 - 750,
    });
    const i = lines.findIndex((l) => l[0] === 'E110');
    expect(lines[i + 1]![0]).toBe('E111');
    expect(march.ciap).toEqual({
      appropriationCents: 750,
      installments: [{ code: `${assetDoc.accessKey}-1`, installment: 1 }],
    });
  });

  it('cadastros 0300, 0305, 0500 e 0600 e o bloco 9 contando o G', () => {
    expect(byReg('0300')[0]).toEqual([
      '0300',
      `${assetDoc.accessKey}-1`,
      '1',
      'Freezer horizontal 500 L',
      '',
      '1.2.3.01',
      '48',
    ]);
    expect(byReg('0305')[0]).toEqual(['0305', '1', 'Uso nas atividades do estabelecimento', '']);
    expect(byReg('0500')[0]).toEqual([
      '0500',
      '01032026',
      '01',
      'A',
      '4',
      '1.2.3.01',
      'Máquinas e equipamentos',
    ]);
    expect(byReg('0600')[0]).toEqual(['0600', '01032026', '1', 'Área operacional']);
    for (const block of ['0', 'C', 'E', 'G', '9']) {
      const qtd = lines.filter((l) => l[0]!.startsWith(block)).length;
      expect(Number(byReg(`${block}990`)[0]![1]), block).toBe(qtd);
    }
    const counted = Object.fromEntries(byReg('9900').map((l) => [l[1], Number(l[2])]));
    const real: Record<string, number> = {};
    for (const l of lines) real[l[0]!] = (real[l[0]!] ?? 0) + 1;
    expect(counted).toEqual(real);
    expect(counted.G125).toBe(1);
    expect(counted.G990).toBe(1);
    expect(Number(byReg('G990')[0]![1])).toBe(6); // G001, G110, G125, G130, G140, G990
    expect(Number(byReg('9999')[0]![1])).toBe(lines.length);
  });

  it('mês seguinte: SI com a parcela 2, sem G130, e saldo inicial do CIAP', () => {
    const april = rows(
      buildEfdIcmsIpi(
        base({
          month: '2026-04',
          purchases: [],
          entries: [sale('2026-04', [{ cst: '00', cents: 100_000, icms: 18_000 }])],
        }),
      ).text,
    );
    const g110 = april.find((l) => l[0] === 'G110')!;
    expect(g110.slice(3, 9)).toEqual([
      '480,00',
      '10,00',
      '1000,00',
      '1000,00',
      '1,00000000',
      '10,00',
    ]);
    expect(april.filter((l) => l[0] === 'G125').map((l) => [l[3], l[8], l[9]])).toEqual([
      ['SI', '2', '10,00'],
    ]);
    expect(april.some((l) => l[0] === 'G130')).toBe(false);
    expect(april.find((l) => l[0] === 'E111')![3]).toBe('10,00');
  });

  it('sem conta contábil, sem código de ajuste ou no Simples: avisa e não inventa', () => {
    const noAccount = buildEfdIcmsIpi(base({ ciap: ciapConfig({ account: undefined }) }));
    expect(rows(noAccount.text).find((l) => l[0] === 'G001')![1]).toBe('1');
    expect(noAccount.warnings.join(' ')).toMatch(/falta a conta contábil do ativo/);
    const sales = [sale('2026-03', [{ cst: '00', cents: 1000, icms: 180 }])];
    const noCode = buildEfdIcmsIpi(
      base({ entries: sales, ciap: ciapConfig({ adjustmentCode: undefined }) }),
    );
    expect(rows(noCode.text).some((l) => l[0] === 'G110')).toBe(true);
    expect(rows(noCode.text).some((l) => l[0] === 'E111')).toBe(false);
    expect(noCode.settlement.adjustmentCreditsCents).toBe(0);
    expect(noCode.warnings.join(' ')).toMatch(/Falta o código de ajuste/);
    expect(() =>
      buildEfdIcmsIpi(base({ ciap: ciapConfig({ adjustmentCode: 'RJ020001' }) })),
    ).toThrow('Código de ajuste do CIAP inválido');
    const simples = buildEfdIcmsIpi(base({ simples: true }));
    expect(rows(simples.text).find((l) => l[0] === 'G001')![1]).toBe('1');
    // Bem que entrou no mês sem a nota de compra no arquivo: erro claro (G130).
    expect(() => buildEfdIcmsIpi(base({ purchases: [] }))).toThrow('G130');
  });
});
