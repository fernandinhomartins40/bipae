import { describe, expect, it } from 'vitest';
import { buildNfce, type NfceInput, type NfceItem } from '../nfce/build';
import { buildDraftNfe } from '../nfe/draft';
import { calculateContribution } from '../taxes/contributions';
import { calculateIbsCbs } from '../taxes/ibs-cbs';
import { calculateIcms } from '../taxes/icms';
import { buildEfdIcmsIpi, encodeEfdLatin1, type EfdCompany, type EfdInput } from './build';
import { EfdError, readEfdDocument } from './read';

/**
 * F4-14.b.1: arquivo da EFD ICMS/IPI do mês pelo Guia Prático 3.2.2 e leiaute 020, montado do XML
 * das notas que o próprio Bipaê gera.
 */

const DIA = '2026-10-15';

const company: EfdCompany = {
  legalName: 'Mercadinho Bipaê LTDA',
  tradeName: 'Mercadinho & Cia',
  cnpj: '11.222.333/0001-81',
  ie: '110.042.490.114',
  uf: 'SP',
  cityCode: '3550308',
  cep: '01001-000',
  street: 'Rua das Flores',
  number: '100',
  district: 'Centro',
  email: 'fiscal@mercadinho.com.br',
};

function item(over: Partial<NfceItem> = {}, priceCents = 10_000, rate = '18'): NfceItem {
  const icms = calculateIcms({ cst: '00', rate }, { baseCents: priceCents });
  return {
    code: 'ARZ5',
    gtin: '7891000315507',
    description: 'Arroz Tipo 1 5kg',
    ncm: '10063021',
    cfop: '5102',
    unit: 'UN',
    quantityMilli: 1000,
    unitPriceCents: priceCents,
    grossCents: priceCents,
    discountCents: 0,
    origin: '0',
    icms,
    pis: calculateContribution(
      'PIS',
      { cst: '01', rate: '1.65', excludeIcms: true },
      { baseCents: priceCents, icmsCents: icms.amountCents },
    ),
    cofins: calculateContribution(
      'COFINS',
      { cst: '01', rate: '7.6', excludeIcms: true },
      { baseCents: priceCents, icmsCents: icms.amountCents },
    ),
    ibsCbs: calculateIbsCbs({
      cClassTrib: '000001',
      date: DIA,
      operationCents: priceCents,
      taxes: { ICMS: icms.amountCents },
    }),
    ...over,
  };
}

const nfce = (number: number, items: NfceItem[], over: Partial<NfceInput> = {}) =>
  buildNfce({
    issuer: {
      cnpj: '11222333000181',
      name: company.legalName,
      tradeName: company.tradeName!,
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
      },
    },
    cUF: '35',
    series: 1,
    number,
    issuedAt: `${DIA}T10:30:00-03:00`,
    numericCode: '12345678',
    items,
    payments: [
      { code: '17', amountCents: items.reduce((t, i) => t + i.grossCents - i.discountCents, 0) },
    ],
    appVersion: 'Bipae 1.0',
    ...over,
  }).xml;

const nfe = (): string => {
  const r = buildDraftNfe({
    draftId: '0192a000-0000-7000-8000-00000000e001',
    company: {
      cnpj: '11.222.333/0001-81',
      legalName: company.legalName,
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
    },
    series: 1,
    number: 7,
    issuedAt: '2026-10-20T18:30:00.000Z',
    nature: 'Venda de mercadoria',
    purpose: 'normal',
    presence: 'presencial',
    recipient: {
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
    },
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

const base = (over: Partial<EfdInput> = {}): EfdInput => ({
  month: '2026-10',
  company,
  profile: 'A',
  accountant: {
    name: 'Contábil Exemplo',
    cpf: '529.982.247-25',
    crc: 'SP123456',
    cityCode: '3550308',
  },
  entries: [
    {
      status: 'authorized',
      document: readEfdDocument(nfce(1, [item(), item({ code: 'FEIJ' }, 800, '7')])),
    },
    { status: 'cancelled', document: readEfdDocument(nfce(2, [item()])) },
    { status: 'authorized', document: readEfdDocument(nfe()) },
  ],
  icmsDueDate: '2026-11-20',
  icmsRevenueCode: '046-2',
  ...over,
});

const rows = (text: string) =>
  text
    .split('\r\n')
    .filter(Boolean)
    .map((l) => l.slice(1, -1).split('|'));

describe('leitura da nota para a EFD', () => {
  it('NFC-e: itens, CST com a origem e valores em centavos', () => {
    const d = readEfdDocument(nfce(1, [item(), item({ code: 'FEIJ' }, 800, '7')]));
    expect(d).toMatchObject({ model: '65', series: 1, number: 1, direction: 'out', issuedOn: DIA });
    expect(d.items.map((i) => [i.cstIcms, i.cfop, i.icmsRate, i.icmsCents])).toEqual([
      ['000', '5102', '18.00', 1800],
      ['000', '5102', '7.00', 56],
    ]);
    expect(d.totalCents).toBe(10_800);
    expect(() => readEfdDocument('<nada/>')).toThrow(EfdError);
    expect(() => readEfdDocument('não é xml')).toThrow('não pôde ser lido');
  });

  it('NF-e com destinatário, frete e desconto', () => {
    const d = readEfdDocument(nfe());
    expect(d).toMatchObject({ model: '55', number: 7, freightCents: 1_000, discountCents: 500 });
    expect(d.recipient).toMatchObject({
      cpf: '52998224725',
      // Em homologação a SEFAZ exige este texto no nome do destinatário.
      name: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      cityCode: '3550308',
    });
  });
});

describe('arquivo da EFD ICMS/IPI (F4-14.b.1)', () => {
  const result = buildEfdIcmsIpi(base());
  const lines = rows(result.text);
  const byReg = (reg: string) => lines.filter((l) => l[0] === reg);

  it('abre com o 0000 do período e o leiaute 020', () => {
    expect(lines[0]).toEqual([
      '0000',
      '020',
      '0',
      '01102026',
      '31102026',
      'Mercadinho Bipaê LTDA',
      '11222333000181',
      '',
      'SP',
      '110042490114',
      '3550308',
      '',
      '',
      'A',
      '1',
    ]);
    expect(byReg('0005')[0]![1]).toBe('Mercadinho & Cia');
    expect(byReg('0100')[0]!.slice(1, 4)).toEqual(['Contábil Exemplo', '52998224725', 'SP123456']);
    // O participante da NF-e entra no 0150; a NFC-e não leva participante (Exceção 9).
    expect(byReg('0150')).toHaveLength(1);
    expect(byReg('0150')[0]!.slice(1, 6)).toEqual([
      '52998224725',
      'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      '1058',
      '',
      '52998224725',
    ]);
    expect(result.fileName).toBe('EFD-ICMS-IPI-11222333000181-2026-10.txt');
  });

  it('NFC-e no C100 sem participante e sem PIS/COFINS; C190 por CST, CFOP e alíquota', () => {
    const c100 = byReg('C100');
    expect(c100).toHaveLength(3);
    // Ordem do arquivo: modelo, série e número (a NF-e 55 vem antes da NFC-e 65).
    const venda = c100.find((l) => l[4] === '65' && l[7] === '1')!;
    expect(venda.slice(1, 9)).toEqual(['1', '0', '', '65', '00', '001', '1', venda[8]!]);
    expect(venda[8]).toHaveLength(44);
    expect(venda[11]).toBe('108,00'); // VL_DOC
    expect(venda[20]).toBe('108,00'); // VL_BC_ICMS
    expect(venda[21]).toBe('18,56'); // VL_ICMS
    expect(venda.slice(22, 29)).toEqual(['', '', '', '', '', '', '']);
    const i = lines.indexOf(venda);
    expect(lines[i + 1]).toEqual([
      'C190',
      '000',
      '5102',
      '7,00',
      '8,00',
      '8,00',
      '0,56',
      '0,00',
      '0,00',
      '0,00',
      '0,00',
      '',
    ]);
    expect(lines[i + 2]).toEqual([
      'C190',
      '000',
      '5102',
      '18,00',
      '100,00',
      '100,00',
      '18,00',
      '0,00',
      '0,00',
      '0,00',
      '0,00',
      '',
    ]);
  });

  it('nota cancelada: só os campos da Exceção 1, sem C190', () => {
    const cancelada = byReg('C100').find((l) => l[5] === '02')!;
    expect(cancelada.slice(1, 9).filter(Boolean)).toEqual([
      '1',
      '0',
      '65',
      '02',
      '001',
      '2',
      cancelada[8],
    ]);
    expect(cancelada.slice(9).every((v) => v === '')).toBe(true);
    expect(lines[lines.indexOf(cancelada) + 1]![0]).not.toBe('C190');
  });

  it('apuração: débitos somam o ICMS dos C190 das saídas; E116 com o vencimento', () => {
    const c190Icms = byReg('C190').reduce((t, l) => t + Number(l[6]!.replace(',', '')), 0);
    expect(result.settlement.debitsCents).toBe(c190Icms);
    expect(result.settlement).toMatchObject({
      creditsCents: 0,
      dueCents: c190Icms,
      creditCarriedCents: 0,
    });
    const e110 = byReg('E110')[0]!;
    expect(e110[1]).toBe(
      `${Math.trunc(c190Icms / 100)},${String(c190Icms % 100).padStart(2, '0')}`,
    );
    expect(byReg('E116')[0]!.slice(1, 5)).toEqual(['000', e110[12], '20112026', '046-2']);
    expect(byReg('E116')[0]![9]).toBe('102026');
  });

  it('saldo credor anterior maior que o débito vira saldo a transportar, sem E116', () => {
    const r = buildEfdIcmsIpi(base({ previousCreditCents: 1_000_000 }));
    expect(r.settlement).toMatchObject({ dueCents: 0, balanceCents: 0 });
    expect(r.settlement.creditCarriedCents).toBe(1_000_000 - r.settlement.debitsCents);
    expect(rows(r.text).some((l) => l[0] === 'E116')).toBe(false);
  });

  it('blocos sem movimento, encerramentos e o bloco 9 batem com as linhas', () => {
    for (const block of ['B', 'D', 'G', 'H', 'K']) expect(byReg(`${block}001`)[0]![1]).toBe('1');
    expect(
      byReg('1010')[0]!
        .slice(1)
        .every((v) => v === 'N'),
    ).toBe(true);
    // Cada xx990 conta as linhas do próprio bloco; no 9990 entra também o 9999 (Guia, registro 9990).
    for (const block of ['0', 'B', 'C', 'D', 'E', 'G', 'H', 'K', '1', '9']) {
      const qtd = lines.filter((l) => l[0]!.startsWith(block)).length;
      expect(Number(byReg(`${block}990`)[0]![1]), block).toBe(qtd);
    }
    // Um 9900 por registro, com a quantidade certa, e o 9999 com o total.
    const counted = Object.fromEntries(byReg('9900').map((l) => [l[1], Number(l[2])]));
    const real: Record<string, number> = {};
    for (const l of lines) real[l[0]!] = (real[l[0]!] ?? 0) + 1;
    expect(counted).toEqual(real);
    expect(Number(byReg('9999')[0]![1])).toBe(lines.length);
    expect(result.lineCount).toBe(lines.length);
    expect(result.text.endsWith('|\r\n')).toBe(true);
  });

  it('avisos do que o arquivo ainda não cobre', () => {
    expect(result.warnings.join(' ')).toMatch(/notas de compra/);
    const sem = buildEfdIcmsIpi(
      base({ accountant: undefined, icmsDueDate: undefined, month: '2026-10' }),
    );
    expect(sem.warnings.join(' ')).toMatch(/contador responsável/);
    expect(sem.warnings.join(' ')).toMatch(/vencimento do ICMS/);
  });

  it('recusa nota de outro mês, mês inválido, cadastro incompleto e ano sem leiaute', () => {
    expect(() => buildEfdIcmsIpi(base({ month: '2026-11' }))).toThrow('não é do mês 2026-11');
    expect(() => buildEfdIcmsIpi(base({ month: '2026-13' }))).toThrow('Mês inválido');
    expect(() =>
      buildEfdIcmsIpi(base({ company: { ...company, ie: '', cityCode: '35' } })),
    ).toThrow(
      'Falta a inscrição estadual da empresa (Empresas e lojas). Falta o município (código IBGE) da empresa (Empresas e lojas).',
    );
    expect(() => buildEfdIcmsIpi(base({ month: '2027-01', entries: [] }))).toThrow(
      'O leiaute da EFD para 2027 ainda não está no Bipaê',
    );
  });

  it('mês sem nota: bloco C sem movimento', () => {
    const vazio = rows(buildEfdIcmsIpi(base({ entries: [] })).text);
    expect(vazio.find((l) => l[0] === 'C001')![1]).toBe('1');
  });

  it('casos que as notas do caixa não exercitam: entrada, complementar, CST 20, 5605 e mais', () => {
    const det = (n: number, cfop: string, icms: string, prod = '<vProd>100.00</vProd>') =>
      `<det nItem="${n}"><prod><CFOP>${cfop}</CFOP>${prod}</prod><imposto><ICMS>${icms}</ICMS></imposto></det>`;
    const xml = (o: {
      mod?: string;
      tpNF?: string;
      fin?: string;
      dhSaiEnt?: string;
      dest?: string;
      dets: string;
      pag?: string;
      nNF?: number;
    }) =>
      `<NFe><infNFe Id="NFe${'3'.repeat(44)}"><ide><mod>${o.mod ?? '55'}</mod><serie>2</serie><nNF>${o.nNF ?? 9}</nNF>` +
      `<dhEmi>2026-02-10T10:00:00-03:00</dhEmi>${o.dhSaiEnt ? `<dhSaiEnt>${o.dhSaiEnt}</dhSaiEnt>` : ''}` +
      `<tpNF>${o.tpNF ?? '1'}</tpNF>${o.fin ? `<finNFe>${o.fin}</finNFe>` : ''}</ide>` +
      `${o.dest ?? ''}${o.dets}<total><ICMSTot><vNF>100.00</vNF><vProd>100.00</vProd></ICMSTot></total>` +
      `${o.pag ?? ''}</infNFe></NFe>`;
    const icms20 =
      '<ICMS20><orig>0</orig><CST>20</CST><vBC>60.00</vBC><pICMS>18.00</pICMS><vICMS>10.80</vICMS></ICMS20>';
    const sn = '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>';
    const estrangeiro =
      '<dest><idEstrangeiro>AB123</idEstrangeiro><xNome>Cliente de Fora</xNome><enderDest><cPais>0249</cPais></enderDest></dest>';
    const docs = [
      // Entrada própria com data de entrada, e só "sem pagamento".
      readEfdDocument(
        xml({
          tpNF: '0',
          dhSaiEnt: '2026-02-12T08:00:00-03:00',
          dets: det(1, '1202', icms20),
          pag: '<pag><detPag><tPag>90</tPag></detPag></pag>',
        }),
      ),
      // Complementar a prazo, com transferência de saldo devedor (5605) e participante estrangeiro.
      readEfdDocument(
        xml({
          fin: '2',
          nNF: 10,
          dest: estrangeiro,
          dets: det(1, '5605', icms20) + det(2, '5102', sn),
          pag: '<pag><detPag><indPag>1</indPag><tPag>15</tPag></detPag></pag>',
        }),
      ),
    ];
    expect(docs[0]).toMatchObject({
      direction: 'in',
      movedOn: '2026-02-12',
      paymentIndicator: '9',
    });
    expect(docs[1]).toMatchObject({ purpose: '2', paymentIndicator: '1', freightMode: '9' });
    expect(docs[1]!.items[1]).toMatchObject({ cstIcms: '0102', icmsRate: '0' });

    const r = buildEfdIcmsIpi(
      base({
        month: '2026-02',
        company: { ...company, uf: 'DF', cityCode: '5300108' },
        entries: docs.map((document) => ({ status: 'authorized' as const, document })),
      }),
    );
    const out = rows(r.text);
    const c100 = out.filter((l) => l[0] === 'C100');
    expect(c100[0]!.slice(1, 3)).toEqual(['0', '0']); // entrada própria
    expect(c100[0]![10]).toBe('12022026'); // DT_E_S
    expect(c100[0]![12]).toBe('9');
    expect(c100[1]![5]).toBe('06'); // complementar
    // CST 20: VL_RED_BC é o que a base deixou de fora.
    expect(out.find((l) => l[0] === 'C190' && l[2] === '1202')![9]).toBe('40,00');
    // 1202 de entrada é crédito; 5605 também (transferência de saldo devedor).
    expect(r.settlement).toMatchObject({ debitsCents: 0, creditsCents: 2_160 });
    const participante = out.find((l) => l[0] === '0150')!;
    expect(participante.slice(1, 8)).toEqual([
      'EXAB123',
      'Cliente de Fora',
      '0249',
      '',
      '',
      '',
      '9999999',
    ]);
    expect(r.warnings.join(' ')).toMatch(/inventário de 31\/12/);
    expect(r.warnings.join(' ')).toMatch(/Distrito Federal/);

    expect(() => readEfdDocument(xml({ mod: '57', dets: det(1, '5102', sn) }))).toThrow(
      'Modelo de nota fora da EFD: 57.',
    );
    expect(() => readEfdDocument(xml({ dets: '' }))).toThrow('A nota não tem itens.');
    expect(() => readEfdDocument(xml({ dets: det(1, '', sn) }))).toThrow(
      'Item 1 da nota sem CFOP.',
    );
    expect(() =>
      readEfdDocument(xml({ dets: det(1, '5102', '<ICMS00><orig>0</orig></ICMS00>') })),
    ).toThrow('Item 1 da nota sem CST ou CSOSN do ICMS.');
    expect(() => buildEfdIcmsIpi(base({ previousCreditCents: 10.5, entries: [] }))).toThrow(
      'Valor inválido no campo VL_SLD_CREDOR_ANT',
    );
  });

  it('grava em ISO 8859-1', () => {
    const bytes = encodeEfdLatin1('|0005|Pão€|');
    expect([...bytes.slice(6, 10)]).toEqual([0x50, 0xe3, 0x6f, 0x3f]);
  });
});
