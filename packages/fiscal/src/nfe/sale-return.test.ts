import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import { buildDraftNfe, type NfeDraftInput } from './draft';
import { proportional, readSaleForReturn, returnCfop } from './sale-return';

/**
 * F3-33.h (dúvida D-037): a devolução de venda espelha os impostos da nota original, na proporção
 * devolvida (LC 214/2025, arts. 12, § 7º, e 17; RICMS-SP, art. 452; RC 30429/2024).
 */

const company: NfeDraftInput['company'] = {
  cnpj: '11.222.333/0001-81',
  legalName: 'Distribuidora Bipaê LTDA',
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
  },
};
const recipient: NfeDraftInput['recipient'] = {
  taxId: '529.982.247-25',
  name: 'Maria Cliente',
  ieIndicator: 9,
  address: {
    street: 'Avenida Brasil',
    number: '2000',
    district: 'Jardim América',
    cityCode: '3550308',
    cityName: 'São Paulo',
    uf: 'SP',
    cep: '01430-000',
  },
};

const sale = (): string => {
  const r = buildDraftNfe({
    draftId: '0192a000-0000-7000-8000-00000000a001',
    company,
    series: 1,
    number: 20,
    issuedAt: '2026-10-15T18:30:00.000Z',
    nature: 'Venda de mercadoria',
    purpose: 'normal',
    presence: 'presencial',
    recipient,
    items: [
      {
        code: 'ARROZ5',
        barcodes: ['7891000315507'],
        description: 'Arroz tipo 1 5kg',
        ncm: '10063021',
        unit: 'UN',
        quantityMilli: 10_000,
        unitPriceCents: 2_500,
        grossCents: 25_000,
        discountCents: 500,
        profile: {
          cfopInterna: '5102',
          cfopInterestadual: '6102',
          cstIcms: '00',
          cstPisCofins: '01',
          cClassTrib: '000001',
          origem: 0,
        },
      },
    ],
    transport: { freight: 'porContaDoRemetente', freightCents: 1_000 },
    payments: [{ code: '01', amountCents: 25_500 }],
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
    appVersion: 'Bipaê 1.0',
  });
  if (!r.ok) throw new Error(r.pending.join('\n'));
  return r.document.xml;
};

describe('devolução de venda (F3-33.h)', () => {
  it('arredonda a parte proporcional meio para cima, sem perder centavo', () => {
    expect(proportional(1000, 1, 3)).toBe(333);
    expect(proportional(1001, 1, 2)).toBe(501);
    expect(proportional(4590, 10_000, 10_000)).toBe(4590);
    expect(proportional(99_999_999_999, 3, 7)).toBe(42_857_142_857);
  });

  it('acha o CFOP de devolução pela tabela oficial', () => {
    expect(returnCfop('5102')).toBe('1202');
    expect(returnCfop('6102')).toBe('2202');
    expect(returnCfop('6108')).toBe('2202');
    expect(returnCfop('5101')).toBe('1201');
    expect(returnCfop('5405')).toBe('1411');
    expect(returnCfop('5401')).toBe('1410');
    expect(returnCfop('1102')).toBeNull();
  });

  it('espelha 4 de 10 unidades: base, alíquota e impostos proporcionais, nota de entrada válida', async () => {
    const original = sale();
    const read = readSaleForReturn(original, [{ item: 1, quantityMilli: 4_000 }]);
    expect(read.pending).toEqual([]);
    const [item] = read.items;
    expect(item).toMatchObject({
      reference: { key: read.key, item: 1 },
      quantityMilli: 4_000,
      grossCents: 10_000,
      discountCents: 200,
      freightCents: 400,
      cfop: '1202',
      originalCfop: '5102',
    });
    // Base da venda: 25.000 - 500 + 1.000 = 25.500; volta 40%: 10.200, a 18%: 1.836.
    expect(item!.icms).toMatchObject({
      cst: '00',
      rate: '18.00',
      baseCents: 10_200,
      amountCents: 1_836,
    });
    expect(read.recipient).toEqual({ taxId: '52998224725', name: expect.any(String) });
    // IBS e CBS: mesma alíquota da venda (LC 214/2025, art. 17), valor na proporção devolvida.
    const venda = readSaleForReturn(original, [{ item: 1, quantityMilli: 10_000 }]).items[0]!;
    expect(item!.ibsCbs?.cClassTrib).toBe(venda.ibsCbs?.cClassTrib);
    expect(item!.ibsCbs?.cbs?.rate).toBe(venda.ibsCbs?.cbs?.rate);
    expect(item!.ibsCbs?.baseCents).toBe(Math.round((venda.ibsCbs!.baseCents * 4) / 10));
    expect(item!.pis?.rate).toBe(venda.pis?.rate);

    const r = buildDraftNfe({
      draftId: '0192a000-0000-7000-8000-00000000a002',
      company,
      series: 1,
      number: 21,
      issuedAt: '2026-10-20T15:00:00.000Z',
      nature: 'Devolução de venda',
      purpose: 'devolucao',
      presence: 'presencial',
      recipient,
      items: [],
      transport: { freight: 'semFrete' },
      payments: [],
      appVersion: 'Bipaê 1.0',
      saleReturn: { items: read.items },
    });
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    const xml = r.document.xml;
    expect(xml).toContain('<tpNF>0</tpNF>');
    expect(xml).toContain('<finNFe>4</finNFe>');
    expect(xml).toContain('<CFOP>1202</CFOP>');
    expect(xml).toContain(`<chaveAcesso>${read.key}</chaveAcesso>`);
    expect(xml).toContain('<vBC>102.00</vBC>');
    expect(xml).toContain('<vICMS>18.36</vICMS>');
    expect(xml).toContain('<tPag>90</tPag>');
    expect(await validate(xml)).toEqual([]);
  });

  it('o que ainda não espelha vira pendência, sem valor inventado', () => {
    const original = sale();
    expect(readSaleForReturn(original, [{ item: 2, quantityMilli: 1_000 }]).pending).toEqual([
      'O item 2 não existe na nota original.',
    ]);
    expect(readSaleForReturn(original, [{ item: 1, quantityMilli: 11_000 }]).pending[0]).toContain(
      'passa da quantidade vendida',
    );
    const difal = original.replace(
      '</imposto>',
      '<ICMSUFDest><vBCUFDest>1.00</vBCUFDest></ICMSUFDest></imposto>',
    );
    expect(readSaleForReturn(difal, [{ item: 1, quantityMilli: 1_000 }]).pending[0]).toContain(
      'partilha do ICMS (DIFAL)',
    );
  });
});

/** Nota mínima com um item e o grupo de impostos dado (só o que o leitor usa). */
const nota = (imposto: string, over: { tpNF?: string; cfop?: string; dest?: string } = {}) =>
  `<nfeProc><NFe><infNFe Id="NFe35261011222333000181550010000000201000000017">` +
  `<ide><tpNF>${over.tpNF ?? '1'}</tpNF><dhEmi>2026-10-15T15:30:00-03:00</dhEmi></ide>` +
  (over.dest ?? '<dest><CNPJ>11444777000161</CNPJ><xNome>Mercado</xNome></dest>') +
  `<det nItem="1"><prod><cProd>P1</cProd><cEAN>SEM GTIN</cEAN><xProd>Refrigerante</xProd>` +
  `<NCM>22021000</NCM><CFOP>${over.cfop ?? '5405'}</CFOP><uCom>UN</uCom><qCom>2.0000</qCom>` +
  `<vUnCom>5.00</vUnCom><vProd>10.00</vProd></prod><imposto>${imposto}</imposto></det>` +
  `</infNFe></NFe></nfeProc>`;

describe('leitura dos grupos de imposto na devolução', () => {
  it('ICMS com ST e FCP, metade devolvida', () => {
    const r = readSaleForReturn(
      nota(
        '<ICMS><ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>10.00</vBC><pICMS>18.00</pICMS><vICMS>1.80</vICMS><vBCFCP>10.00</vBCFCP><pFCP>2.00</pFCP><vFCP>0.20</vFCP><modBCST>4</modBCST><pMVAST>40.00</pMVAST><pRedBCST>10.00</pRedBCST><vBCST>14.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>0.72</vICMSST></ICMS10></ICMS>' +
          '<PIS><PISQtde><CST>03</CST><qBCProd>2.0000</qBCProd><vAliqProd>0.1000</vAliqProd><vPIS>0.20</vPIS></PISQtde></PIS>' +
          '<COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS>' +
          '<IBSCBS><CST>410</CST><cClassTrib>410001</cClassTrib></IBSCBS>',
      ),
      [{ item: 1, quantityMilli: 1_000 }],
    );
    expect(r.pending).toEqual([]);
    expect(r.recipient).toEqual({ taxId: '11444777000161', name: 'Mercado' });
    const [i] = r.items;
    expect(i!.cfop).toBe('1411');
    expect(i!.icms).toMatchObject({
      group: 'ICMS10',
      amountCents: 90,
      fcp: { rate: '2.00', amountCents: 10 },
      st: { mva: '40.00', modBc: '4', baseReduction: '10.00', baseCents: 700, amountCents: 36 },
    });
    expect(i!.pis).toMatchObject({ group: 'PISQtde', quantity: '1.0000', amountCents: 10 });
    expect(i!.cofins).toMatchObject({ group: 'COFINSNT', amountCents: 0 });
    expect(i!.ibsCbs).toMatchObject({ taxed: false, baseCents: 0, cbs: null });
  });

  it('diferimento, Simples Nacional com crédito e IBS/CBS com redução', () => {
    const diferido = readSaleForReturn(
      nota(
        '<ICMS><ICMS51><orig>0</orig><CST>51</CST><modBC>3</modBC><vBC>10.00</vBC><pICMS>18.00</pICMS><vICMSOp>1.80</vICMSOp><pDif>33.3300</pDif><vICMSDif>0.60</vICMSDif><vICMS>1.20</vICMS></ICMS51></ICMS>',
        { cfop: '5102' },
      ),
      [{ item: 1, quantityMilli: 2_000 }],
    );
    expect(diferido.items[0]!.icms.deferral).toEqual({
      rate: '33.3300',
      operationAmountCents: 180,
      deferredAmountCents: 60,
    });
    const simples = readSaleForReturn(
      nota(
        '<ICMS><ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>1.25</pCredSN><vCredICMSSN>0.13</vCredICMSSN></ICMSSN101></ICMS>' +
          '<IBSCBS><CST>200</CST><cClassTrib>200001</cClassTrib><gIBSCBS><vBC>10.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><gRed><pRedAliq>60.0000</pRedAliq><pAliqEfet>0.0400</pAliqEfet></gRed><vIBSUF>0.00</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.00</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.09</vCBS></gCBS></gIBSCBS></IBSCBS>',
        { cfop: '5102', dest: '' },
      ),
      [{ item: 1, quantityMilli: 2_000 }],
    );
    const s = simples.items[0]!;
    expect(simples.recipient).toBeNull();
    expect(s.icms).toMatchObject({ csosn: '101', credit: { rate: '1.25', amountCents: 13 } });
    expect(s.ibsCbs?.ibsState).toMatchObject({ reduction: '60.0000', effectiveRate: '0.0400' });
    expect(s.ibsCbs?.cbs).toMatchObject({
      reduction: '0',
      effectiveRate: '0.9000',
      amountCents: 9,
    });
    expect(s.pis).toBeNull();
  });

  it('IPI, nota de entrada, grupo do ICMS ausente e CFOP sem devolução viram pendência', () => {
    const icms = '<ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>';
    expect(
      readSaleForReturn(
        nota(icms + '<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST></IPITrib></IPI>'),
        [{ item: 1, quantityMilli: 1_000 }],
      ).pending[0],
    ).toContain('IPI');
    expect(
      readSaleForReturn(nota(icms, { tpNF: '0' }), [{ item: 1, quantityMilli: 1_000 }]).pending,
    ).toContain('A nota original não é de saída (venda).');
    expect(readSaleForReturn(nota(''), [{ item: 1, quantityMilli: 1_000 }]).pending[0]).toContain(
      'não tem o grupo do ICMS',
    );
    const semCfop = readSaleForReturn(nota(icms, { cfop: '5949' }), [
      { item: 1, quantityMilli: 1_000 },
    ]);
    expect(semCfop.items[0]!.cfop).toBeNull();
    expect(semCfop.pending[0]).toContain('Escolha o CFOP no item');
    expect(() => readSaleForReturn('<outro/>', [])).toThrow('não é uma NF-e');
  });
});
