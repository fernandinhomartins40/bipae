import { describe, expect, it } from 'vitest';
import { buildEfdIcmsIpi, type EfdCompany, type EfdPurchase } from './build';
import { EFD_ENTRY_RULES, purchaseLines, type PurchaseContext } from './entry';
import { readEfdDocument } from './read';
import { findCfop } from '../tables/cfop';

/**
 * F4-14.b.2 (dúvida D-039): nota de compra na EFD, com CFOP, CST e crédito sob o enfoque da
 * empresa. Notas de fornecedor montadas à mão, no formato do XML autorizado.
 */

const company: EfdCompany = {
  legalName: 'Mercadinho Bipaê LTDA',
  cnpj: '11222333000181',
  ie: '110042490114',
  uf: 'SP',
  cityCode: '3550308',
};

const icms00 = (base: string, rate: string, value: string) =>
  `<ICMS00><orig>0</orig><CST>00</CST><vBC>${base}</vBC><pICMS>${rate}</pICMS><vICMS>${value}</vICMS></ICMS00>`;
const icms60 = '<ICMS60><orig>0</orig><CST>60</CST></ICMS60>';
const icms10 =
  '<ICMS10><orig>0</orig><CST>10</CST><vBC>50.00</vBC><pICMS>18.00</pICMS><vICMS>9.00</vICMS>' +
  '<vBCST>70.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>3.60</vICMSST></ICMS10>';
const csosn101 =
  '<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.56</pCredSN><vCredICMSSN>1.28</vCredICMSSN></ICMSSN101>';

function det(n: number, cfop: string, icms: string, prod = '') {
  return (
    `<det nItem="${n}"><prod><cProd>F${n}</cProd><cEAN>7891000315507</cEAN><xProd>Produto ${n}</xProd>` +
    `<NCM>10063021</NCM><CFOP>${cfop}</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vProd>50.00</vProd>${prod}</prod>` +
    `<imposto><ICMS>${icms}</ICMS></imposto></det>`
  );
}

function supplierXml(dets: string, number = 501) {
  return (
    `<nfeProc><NFe><infNFe Id="NFe${'3526109988776600019955001000000' + String(number).padStart(9, '0') + '15'}">` +
    `<ide><mod>55</mod><serie>1</serie><nNF>${number}</nNF><dhEmi>2026-10-08T09:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>` +
    `<emit><CNPJ>99887766000199</CNPJ><xNome>Distribuidora Fornece</xNome><enderEmit><xLgr>Rua A</xLgr><nro>10</nro>` +
    `<xBairro>Centro</xBairro><cMun>3550308</cMun><cPais>1058</cPais></enderEmit><IE>123456789012</IE></emit>` +
    `${dets}<total><ICMSTot><vNF>100.00</vNF><vProd>100.00</vProd></ICMSTot></total>` +
    `<transp><modFrete>0</modFrete></transp><pag><detPag><indPag>1</indPag><tPag>15</tPag></detPag></pag></infNFe></NFe></nfeProc>`
  );
}

const ctx = (over: Partial<PurchaseContext> = {}): PurchaseContext => ({
  purpose: 'resale',
  enteredOn: '2026-10-10',
  declarantSimples: false,
  ...over,
});
const lineOf = (icms: string, cfop = '5102', over: Partial<PurchaseContext> = {}) =>
  purchaseLines(readEfdDocument(supplierXml(det(1, cfop, icms))).items, ctx(over))[0]!;

describe('regras da entrada (D-039)', () => {
  it('os CFOP da tabela são os títulos oficiais da compra', () => {
    expect(findCfop('1102')?.title).toBe('Compra para comercialização.');
    expect(findCfop('1403')?.title).toMatch(/comercialização .*substituição tributária/);
    expect(findCfop('1556')?.title).toBe('Compra de material para uso ou consumo.');
    expect(findCfop('1551')?.title).toBe('Compra de bem para o ativo imobilizado.');
    expect(findCfop('1101')?.title).toMatch(/^Compra para industrialização/);
    for (const rule of Object.values(EFD_ENTRY_RULES)) {
      expect(findCfop(`1${rule.cfop.normal}`), rule.cfop.normal).not.toBeNull();
      expect(findCfop(`1${rule.cfop.st}`), rule.cfop.st).not.toBeNull();
    }
  });

  it('revenda com ICMS destacado: 1102, CST do fornecedor e crédito do ICMS', () => {
    expect(lineOf(icms00('50.00', '18.00', '9.00'))).toMatchObject({
      cfop: '1102',
      cst: '000',
      icmsBaseCents: 5000,
      icmsRate: '18.00',
      icmsCents: 900,
      itemType: '00',
    });
    // De outra UF: 2102.
    expect(lineOf(icms00('50.00', '12.00', '6.00'), '6102').cfop).toBe('2102');
  });

  it('com ST (CST 60 ou 10): 1403, CST 60 e sem crédito', () => {
    expect(lineOf(icms60, '5405')).toMatchObject({ cfop: '1403', cst: '060', icmsCents: 0 });
    expect(lineOf(icms10, '5401')).toMatchObject({
      cfop: '1403',
      cst: '060',
      icmsCents: 0,
      stBaseCents: 7000,
      stRate: '18.00',
      stCents: 360,
    });
  });

  it('uso e consumo: sem crédito até 2032 e com crédito a partir de 2033 (LC 87/1996, art. 33, I)', () => {
    const consumo = (enteredOn: string) =>
      lineOf(icms00('50.00', '18.00', '9.00'), '5102', { purpose: 'consumption', enteredOn });
    expect(consumo('2026-10-10')).toMatchObject({
      cfop: '1556',
      cst: '090',
      icmsCents: 0,
      itemType: '07',
    });
    expect(consumo('2033-01-02')).toMatchObject({ cst: '000', icmsCents: 900 });
  });

  it('ativo: 1551, crédito fora do C170 (CIAP); indústria: 1101', () => {
    expect(
      lineOf(icms00('50.00', '18.00', '9.00'), '5102', { purpose: 'fixed_asset' }),
    ).toMatchObject({
      cfop: '1551',
      cst: '090',
      icmsCents: 0,
      itemType: '08',
    });
    expect(
      lineOf(icms00('50.00', '18.00', '9.00'), '5101', { purpose: 'industrialization' }),
    ).toMatchObject({
      cfop: '1101',
      icmsCents: 900,
      itemType: '01',
    });
  });

  it('fornecedor do Simples: crédito do pCredSN só na revenda (LC 123/2006, art. 23)', () => {
    expect(lineOf(csosn101)).toMatchObject({
      cst: '090',
      icmsBaseCents: 5000,
      icmsRate: '2.56',
      icmsCents: 128,
    });
    expect(lineOf(csosn101, '5102', { purpose: 'consumption' }).icmsCents).toBe(0);
  });

  it('empresa do Simples não se credita', () => {
    expect(
      lineOf(icms00('50.00', '18.00', '9.00'), '5102', { declarantSimples: true }),
    ).toMatchObject({
      cst: '090',
      icmsCents: 0,
    });
  });

  it('recusa CFOP que não é de saída e CFOP de entrada que não existe', () => {
    expect(() => lineOf(icms60, '1102')).toThrow('não é de saída');
    // Importação com ST: não há 3403 na tabela oficial.
    expect(() => lineOf(icms60, '7102')).toThrow('Não há CFOP de entrada 3403');
  });
});

describe('compras no arquivo da EFD (F4-14.b.2)', () => {
  const nota = readEfdDocument(
    supplierXml(det(1, '5102', icms00('50.00', '18.00', '9.00')) + det(2, '5405', icms60)),
  );
  const purchase = (over: Partial<EfdPurchase> = {}): EfdPurchase => ({
    enteredOn: '2026-10-10',
    purpose: 'resale',
    document: nota,
    products: {
      1: {
        code: 'ARZ5',
        name: 'Arroz Tipo 1 5kg',
        unit: 'UN',
        factor: '12',
        ncm: '10063021',
        barcode: '7891000315507',
      },
      2: { code: 'FEIJ1', name: 'Feijão 1kg', unit: 'CX', factor: '1' },
    },
    ...over,
  });
  const rows = (text: string) =>
    text
      .split('\r\n')
      .filter(Boolean)
      .map((l) => l.slice(1, -1).split('|'));
  const result = buildEfdIcmsIpi({
    month: '2026-10',
    company,
    profile: 'A',
    accountant: { name: 'Contábil Exemplo', cpf: '52998224725' },
    entries: [],
    purchases: [purchase()],
  });
  const lines = rows(result.text);
  const byReg = (reg: string) => lines.filter((l) => l[0] === reg);

  it('C100 de terceiros, C170 por item e C190 sob o enfoque da empresa', () => {
    const c100 = byReg('C100')[0]!;
    expect(c100.slice(1, 6)).toEqual(['0', '1', '99887766000199', '55', '00']);
    expect(c100[10]).toBe('10102026'); // DT_E_S
    expect(c100[21]).toBe('9,00'); // VL_ICMS creditado
    const c170 = byReg('C170');
    expect(c170.map((l) => [l[1], l[2], l[4], l[5], l[9], l[10], l[14]])).toEqual([
      ['1', 'ARZ5', '2,00000', 'CX', '000', '1102', '9,00'],
      ['2', 'FEIJ1', '2,00000', 'CX', '060', '1403', '0,00'],
    ]);
    expect(byReg('C190').map((l) => [l[1], l[2], l[6]])).toEqual([
      ['000', '1102', '9,00'],
      ['060', '1403', '0,00'],
    ]);
    expect(result.settlement).toMatchObject({
      creditsCents: 900,
      debitsCents: 0,
      creditCarriedCents: 900,
    });
  });

  it('cadastros: fornecedor no 0150, unidades no 0190, itens no 0200 e o fator no 0220', () => {
    expect(byReg('0150')[0]!.slice(1, 4)).toEqual([
      '99887766000199',
      'Distribuidora Fornece',
      '1058',
    ]);
    expect(byReg('0190').map((l) => l[1])).toEqual(['CX', 'UN']);
    expect(byReg('0200').map((l) => [l[1], l[5], l[6], l[7]])).toEqual([
      ['ARZ5', 'UN', '00', '10063021'],
      ['FEIJ1', 'CX', '00', ''],
    ]);
    // Arroz comprado em caixa e estocado em unidade: 0220 logo depois do 0200 dele.
    const i = lines.findIndex((l) => l[0] === '0200' && l[1] === 'ARZ5');
    expect(lines[i + 1]).toEqual(['0220', 'CX', '12,000000', '']);
    expect(result.warnings.join(' ')).not.toMatch(/não foram informadas/);
    const counted = Object.fromEntries(byReg('9900').map((l) => [l[1], Number(l[2])]));
    expect(counted.C170).toBe(2);
    expect(counted['0220']).toBe(1);
    expect(Number(byReg('9999')[0]![1])).toBe(lines.length);
  });

  it('erros claros e o aviso do ativo imobilizado', () => {
    const build = (p: EfdPurchase) =>
      buildEfdIcmsIpi({ month: '2026-10', company, profile: 'A', entries: [], purchases: [p] });
    expect(() => build(purchase({ enteredOn: '2026-11-02' }))).toThrow('não entrou no mês 2026-10');
    expect(() => build(purchase({ products: {} }))).toThrow(
      'O item 1 da compra 501 não está ligado a um produto',
    );
    expect(() => build(purchase({ document: { ...nota, issuer: undefined } as never }))).toThrow(
      'não traz o fornecedor',
    );
    expect(build(purchase({ purpose: 'fixed_asset' })).warnings.join(' ')).toMatch(
      /controle dos bens \(CIAP\) não foi informado/,
    );
  });
});
