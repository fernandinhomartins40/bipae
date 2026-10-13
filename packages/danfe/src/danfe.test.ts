import {
  buildNfe,
  calculateContribution,
  calculateIbsCbs,
  calculateIcms,
  calculateIpi,
  type NfeInput,
  type NfeItem,
} from '@bipae/fiscal';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CODE128_PATTERNS,
  code128cCheck,
  code128cModules,
  code128cValues,
  createDanfeDocument,
  decimalBR,
  DanfeDataError,
  DanfeLayoutError,
  dateBR,
  FONT,
  layoutDanfeNfe,
  measureWith,
  nfNumberBR,
  phoneBR,
  readNfe,
  renderDanfeNfe,
  taxIdBR,
  timeBR,
  winAnsi,
  A4,
  type DrawOp,
  type Measure,
} from './index';

// ------------------------------------------------------------------ nota de exemplo

function item(n: number, over: Partial<NfeItem> = {}): NfeItem {
  const ipi = calculateIpi({ cst: '50', rate: '10' }, { baseCents: 10_000 });
  return {
    code: `P${n}`,
    gtin: '7894900011517',
    description: `Refrigerante de cola garrafa PET 2 litros, fardo com 6 unidades (item ${n})`,
    ncm: '22021000',
    cfop: '5102',
    unit: 'FD',
    quantityMilli: 10_000,
    unitPriceCents: 1000,
    grossCents: 10_000,
    discountCents: 0,
    origin: '0',
    icms: calculateIcms({ cst: '00', rate: '18' }, { baseCents: 10_000 }),
    ipi: { result: ipi, legalFramework: '999' },
    pis: calculateContribution('PIS', { cst: '01', rate: '1.65' }, { baseCents: 10_000 }),
    cofins: calculateContribution('COFINS', { cst: '01', rate: '7.6' }, { baseCents: 10_000 }),
    ibsCbs: calculateIbsCbs({ cClassTrib: '000001', date: '2026-06-15', operationCents: 10_000 }),
    ...over,
  };
}

function nota(items = 2, over: Partial<NfeInput> = {}): NfeInput {
  const list = Array.from({ length: items }, (_, i) => item(i + 1));
  const total = list.reduce((t, i) => t + i.grossCents + i.ipi!.result.amountCents, 0);
  return {
    issuer: {
      cnpj: '11222333000181',
      name: 'Distribuidora Bipaê LTDA',
      tradeName: 'Bipaê Distribuidora',
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
    },
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
    recipient: {
      cnpj: '11444777000161',
      name: 'Mercado do Bairro LTDA',
      ieIndicator: 1,
      ie: '111222333444',
      address: {
        street: 'Avenida Brasil',
        number: '2000',
        district: 'Jardim América',
        cityCode: '3509502',
        cityName: 'Campinas',
        uf: 'SP',
        cep: '13010000',
        phone: '1932321000',
      },
    },
    items: list,
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
      invoice: { number: '1001', originalCents: total, discountCents: 0 },
      installments: [{ number: '001', dueDate: '2026-07-15', amountCents: total }],
    },
    payments: [{ code: '15', amountCents: total }],
    additionalInfo: 'Pedido 778. Entregar no portão 3.',
    appVersion: 'Bipae 0.3.0',
    ...over,
  };
}

/** XML autorizado como a SEFAZ devolve: a nota e o protocolo. */
function autorizado(input = nota()) {
  const doc = buildNfe(input);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${doc.xml}` +
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFE_PL009_V4</verAplic><chNFe>${doc.accessKey}</chNFe>` +
    `<dhRecbto>2026-06-15T10:30:05-03:00</dhRecbto><nProt>135260000123456</nProt><digVal>AAAA</digVal>` +
    `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`;
  return { xml, accessKey: doc.accessKey, notaXml: doc.xml };
}

let measure: Measure;
beforeAll(async () => {
  measure = measureWith((await createDanfeDocument()).fonts);
});

const textos = (ops: DrawOp[]) =>
  ops
    .filter((op): op is Extract<DrawOp, { kind: 'text' }> => op.kind === 'text')
    .map((op) => op.text);

// ------------------------------------------------------------------ testes

describe('código de barras CODE-128C (Anexo II, item 2)', () => {
  it('calcula o dígito verificador do exemplo do manual', () => {
    expect(code128cCheck([9, 75, 83, 64])).toBe(48);
    expect(code128cValues('09758364')).toEqual([105, 9, 75, 83, 64, 48, 106]);
  });

  it('as barras do exemplo batem com a representação do manual', () => {
    expect(code128cModules('09758364').join('')).toBe(
      ['211232', '221213', '241211', '114212', '111422', '313121', '2331112'].join(''),
    );
  });

  it('a tabela tem 107 símbolos distintos, de 11 módulos (o Stop tem 13)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, i) =>
      expect(
        [...p].reduce((s, n) => s + Number(n), 0),
        String(i),
      ).toBe(i === 106 ? 13 : 11),
    );
  });

  it('a chave de 44 dígitos vira 22 pares e recusa letras', () => {
    expect(code128cValues('1'.repeat(44))).toHaveLength(25);
    expect(() => code128cValues('123')).toThrow('quantidade par');
    expect(() => code128cValues('AB')).toThrow('só dígitos');
  });
});

describe('formatação do DANFE', () => {
  it('valores do XML no padrão brasileiro, sem ponto flutuante', () => {
    expect(decimalBR('1234567.5')).toBe('1.234.567,50');
    expect(decimalBR('0.10')).toBe('0,10');
    expect(decimalBR('10.0000')).toBe('10,00');
    expect(decimalBR('1.2345')).toBe('1,2345');
    expect(decimalBR('125.500', 3)).toBe('125,500');
    expect(decimalBR('-5')).toBe('-5,00');
    expect(decimalBR('007')).toBe('7,00');
    expect(decimalBR(undefined)).toBe('');
    expect(() => decimalBR('1,5')).toThrow('Valor decimal inválido');
  });

  it('máscaras de documento, telefone, data e número', () => {
    expect(taxIdBR('11222333000181')).toBe('11.222.333/0001-81');
    expect(taxIdBR('52998224725')).toBe('529.982.247-25');
    expect(taxIdBR('X1')).toBe('X1');
    expect(taxIdBR(undefined)).toBe('');
    expect(phoneBR('1133334444')).toBe('(11) 3333-4444');
    expect(phoneBR('11987654321')).toBe('(11) 98765-4321');
    expect(phoneBR('123')).toBe('123');
    expect(dateBR('2026-06-15T10:30:00-03:00')).toBe('15/06/2026');
    expect(dateBR(undefined)).toBe('');
    expect(timeBR('2026-06-15T10:30:00-03:00')).toBe('10:30:00');
    expect(timeBR('2026-06-15')).toBe('');
    expect(nfNumberBR('1001')).toBe('000.001.001');
  });

  it('troca o que a fonte padrão não desenha', () => {
    expect(winAnsi('Ação – “ok” €')).toBe('Ação – “ok” €');
    expect(winAnsi('ŝ ≥ 😀')).toBe('s ? ?');
  });
});

describe('dados do DANFE lidos do XML', () => {
  it('lê nota, protocolo, emitente, destinatário, totais, IBS/CBS e itens', () => {
    const { xml, accessKey } = autorizado();
    const nfe = readNfe(xml);
    expect(nfe).toMatchObject({
      accessKey,
      number: '1001',
      series: '1',
      direction: '1',
      environment: 'homologacao',
      protocol: { number: '135260000123456', receivedAt: '2026-06-15T10:30:05-03:00' },
      emitter: {
        name: 'Distribuidora Bipaê LTDA',
        tradeName: 'Bipaê Distribuidora',
        cnpj: '11222333000181',
        crt: '3',
      },
      recipient: { name: 'Mercado do Bairro LTDA', cnpj: '11444777000161', ie: '111222333444' },
      totals: { vProd: '200.00', vIPI: '20.00', vNF: '220.00' },
      reformTotals: { vCBS: '1.80', vIBSUF: '0.20', vIBSMun: '0.00' },
      duplicates: [{ number: '001', dueDate: '2026-07-15', value: '220.00' }],
      transport: {
        freightMode: '0',
        carrier: { name: 'Transportes Rápidos', cnpj: '22333444000102', uf: 'SP' },
        volumes: [{ quantity: '10', species: 'FARDO', grossKg: '125.500' }],
      },
      additionalInfo: 'Pedido 778. Entregar no portão 3.',
    });
    expect(nfe.items[0]).toMatchObject({
      code: 'P1',
      gtin: '7894900011517',
      cst: '000',
      cfop: '5102',
      quantity: '10.0000',
      icmsRate: '18.00',
      ipiValue: '10.00',
      reform: {
        cClassTrib: '000001',
        base: '100.00',
        cbsRate: '0.9000',
        cbs: '0.90',
        ibsUfRate: '0.1000',
      },
    });
  });

  it('mostra a alíquota efetiva quando há redução (NT 2026.010, 4.3)', () => {
    const cesta = calculateIbsCbs({
      cClassTrib: '200025',
      date: '2026-06-15',
      operationCents: 10_000,
    });
    const { xml } = autorizado(
      nota(1, {
        items: [item(1, { ibsCbs: cesta, ipi: null })],
        billing: undefined,
        payments: [{ code: '01', amountCents: 10_000 }],
      }),
    );
    const reform = readNfe(xml).items[0]!.reform!;
    expect(reform.cClassTrib).toBe('200025');
    // IBS UF de 0,1% com 60% de redução: a efetiva é 0,04%; a CBS desta classificação é zerada.
    expect(reform.ibsUfRate).toBe('0.0400');
    expect(reform.cbsRate).toBe('0.0000');
  });

  it('Simples Nacional mostra origem + CSOSN e lê o XML sem protocolo', () => {
    const icms = calculateIcms({ csosn: '102' }, { baseCents: 10_000 });
    const doc = buildNfe(
      nota(1, {
        issuer: { ...nota().issuer, crt: 1 },
        items: [item(1, { icms, ipi: null, ibsCbs: null })],
        billing: undefined,
        payments: [{ code: '01', amountCents: 10_000 }],
      }),
    );
    const nfe = readNfe(doc.xml);
    expect(nfe.items[0]!.cst).toBe('0102');
    expect(nfe.protocol).toBeUndefined();
    expect(nfe.reformTotals).toBeUndefined();
    expect(nfe.items[0]!.reform).toBeUndefined();
  });

  it('recusa o que não é NF-e modelo 55', () => {
    expect(() => readNfe('<outra/>')).toThrow(DanfeDataError);
    const { notaXml } = autorizado();
    expect(() => readNfe(notaXml.replace('<mod>55</mod>', '<mod>65</mod>'))).toThrow('modelo 55');
    expect(() => readNfe(notaXml.replace(/Id="NFe\d+"/, 'Id="NFe123"'))).toThrow('Chave de acesso');
    expect(() => readNfe(notaXml.replace(/<natOp>.*?<\/natOp>/, ''))).toThrow('natOp');
  });
});

describe('leiaute do DANFE (Anexo II e NT 2026.010)', () => {
  it('primeira folha com os quadros do manual e os da Reforma', () => {
    const { xml, accessKey } = autorizado();
    const [folha, ...resto] = layoutDanfeNfe(readNfe(xml), measure);
    expect(resto).toHaveLength(0);
    const t = textos(folha!.ops);
    for (const esperado of [
      'DANFE',
      'Nº 000.001.001',
      'SÉRIE 001',
      'FOLHA 1/1',
      'Bipaê Distribuidora',
      accessKey.match(/.{4}/g)!.join(' '),
      '135260000123456 15/06/2026 10:30:05',
      '11.222.333/0001-81',
      '3 - REGIME NORMAL',
      'DESTINATÁRIO / REMETENTE',
      'FATURA / DUPLICATAS',
      'CÁLCULO DO IMPOSTO',
      'TOTAL DO IBS / CBS / IS',
      'VALOR DA CBS',
      'TRANSPORTADOR / VOLUMES TRANSPORTADOS',
      '0 - REMETENTE (CIF)',
      'DADOS DOS PRODUTOS / SERVIÇOS',
      'INFORMAÇÕES COMPLEMENTARES',
      'RESERVADO AO FISCO',
      '220,00',
    ]) {
      expect(
        t.some((x) => x.includes(esperado)),
        esperado,
      ).toBe(true);
    }
    expect(
      t.some((x) => x.startsWith('IBS/CBS cClassTrib 000001 · BC 100,00 · IBS UF 0,10% 0,10')),
    ).toBe(true);
    expect(t).toContain('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL');
    expect(folha!.ops).toContainEqual({ kind: 'watermark', text: 'SEM VALOR FISCAL' });
    const barras = folha!.ops.find((op) => op.kind === 'bars') as Extract<DrawOp, { kind: 'bars' }>;
    // Largura mínima de 6 cm para impressora a laser (Anexo II, item 2).
    expect(barras.widths.reduce((s, n) => s + n, 0) * barras.module).toBeGreaterThanOrEqual(
      6 * 28.3465 - 1,
    );
  });

  it('tudo cabe na folha A4, com as fontes mínimas do item 3.7', () => {
    const { xml } = autorizado(nota(40));
    const folhas = layoutDanfeNfe(readNfe(xml), measure);
    for (const folha of folhas) {
      for (const op of folha.ops) {
        if (op.kind === 'text') {
          expect(op.size, op.text).toBeGreaterThanOrEqual(5);
          expect(op.y, op.text).toBeLessThanOrEqual(A4.height);
          const width = measure(op.text, op.size, !!op.bold);
          const left =
            op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x;
          expect(left, op.text).toBeGreaterThanOrEqual(0);
          expect(left + width, op.text).toBeLessThanOrEqual(A4.width);
        }
        if (op.kind === 'rect') expect(op.y + op.h).toBeLessThanOrEqual(A4.height);
      }
      const nome = folha.ops.find((op) => op.kind === 'text' && op.text === 'Bipaê Distribuidora');
      expect(nome).toMatchObject({ size: FONT.emitterName, bold: true });
    }
  });

  it('nota grande continua em folhas adicionais, com o cabeçalho e o total de folhas', () => {
    const { xml } = autorizado(nota(40));
    const folhas = layoutDanfeNfe(readNfe(xml), measure);
    expect(folhas.length).toBeGreaterThan(1);
    folhas.forEach((folha, i) => {
      const t = textos(folha.ops);
      expect(t, `folha ${i + 1}`).toContain(`FOLHA ${i + 1}/${folhas.length}`);
      expect(t).toContain('DANFE');
    });
    const todos = folhas.flatMap((f) => textos(f.ops));
    for (let n = 1; n <= 40; n++) expect(todos).toContain(`P${n}`);
    // O canhoto só vai na primeira folha.
    expect(textos(folhas[1]!.ops).some((x) => x.startsWith('RECEBEMOS DE'))).toBe(false);
  });

  it('informações complementares longas continuam na folha seguinte', () => {
    const longo = Array.from(
      { length: 60 },
      (_, i) => `Observação número ${i + 1} da entrega combinada com o cliente.`,
    ).join(' ');
    const { xml } = autorizado(nota(1, { additionalInfo: longo }));
    const folhas = layoutDanfeNfe(readNfe(xml), measure);
    expect(folhas.length).toBe(2);
    expect(textos(folhas[0]!.ops)).toContain('CONTINUA NA PRÓXIMA FOLHA');
    expect(textos(folhas[1]!.ops)).toContain('DADOS ADICIONAIS (CONTINUAÇÃO)');
    expect(folhas.flatMap((f) => textos(f.ops)).join(' ')).toContain('Observação número 60');
  });

  it('sem protocolo só sai como prévia, marcada', () => {
    const { notaXml } = autorizado();
    const nfe = readNfe(notaXml);
    expect(() => layoutDanfeNfe(nfe, measure)).toThrow(DanfeLayoutError);
    const [folha] = layoutDanfeNfe({ ...nfe, environment: 'producao' }, measure, { preview: true });
    expect(textos(folha!.ops)).toContain('PRÉVIA: NOTA AINDA NÃO AUTORIZADA');
    expect(folha!.ops).toContainEqual({ kind: 'watermark', text: 'PRÉVIA' });
  });

  it('mostra FCP e tributos aproximados só quando o XML traz valor', () => {
    const icms = calculateIcms({ cst: '00', rate: '18', fcpRate: '2' }, { baseCents: 10_000 });
    const { xml } = autorizado(
      nota(1, {
        items: [item(1, { icms, ipi: null })],
        billing: undefined,
        payments: [{ code: '01', amountCents: 10_000 }],
      }),
    );
    const t = textos(layoutDanfeNfe(readNfe(xml), measure)[0]!.ops);
    expect(t).toContain('VALOR DO FCP');
    expect(t).not.toContain('VALOR DO DIFAL NA UF DE DESTINO');
    const semFcp = textos(layoutDanfeNfe(readNfe(autorizado().xml), measure)[0]!.ops);
    expect(semFcp).not.toContain('VALOR DO FCP');
  });
});

describe('PDF do DANFE', () => {
  it('gera um PDF A4 com as folhas do leiaute, sempre igual para o mesmo XML', async () => {
    const { xml } = autorizado(nota(40));
    const pdf = await renderDanfeNfe(xml);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(layoutDanfeNfe(readNfe(xml), measure).length);
    expect(doc.getPage(0).getSize()).toEqual({ width: A4.width, height: A4.height });
    expect(doc.getTitle()).toBe('DANFE NF-e 1001 série 1');
    expect(Buffer.from(await renderDanfeNfe(xml)).equals(Buffer.from(pdf))).toBe(true);
  });

  it('aceita os dados já lidos e a prévia', async () => {
    const nfe = readNfe(autorizado().notaXml);
    const pdf = await renderDanfeNfe(nfe, { preview: true });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});

describe('dados incomuns no DANFE', () => {
  const base = () => readNfe(autorizado(nota(1)).xml);

  it('emitente e transportadora com CPF, destinatário estrangeiro, IS e textos que não cabem', () => {
    const nfe = base();
    const estranho: typeof nfe = {
      ...nfe,
      accessKey: 'A'.repeat(44),
      leavesAt: undefined,
      emitter: {
        ...nfe.emitter,
        cnpj: undefined,
        cpf: '52998224725',
        tradeName: undefined,
        crt: '9',
        address: { ...nfe.emitter.address, phone: undefined, cep: undefined },
      },
      recipient: { name: 'Cliente de fora', foreignId: 'PASS-123' },
      duplicates: [{ number: '', dueDate: '', value: '1.00' }],
      totals: { ...nfe.totals, vTotTrib: '12.34', vICMSUFDest: '0.00' },
      reformTotals: { vIS: '3.00', vIBSMono: '1.00' },
      transport: {
        freightMode: '7',
        carrier: { name: 'Fulano Fretes', cpf: '52998224725' },
        volumes: [{ numbering: '1-10' }],
      },
      items: [
        {
          ...nfe.items[0]!,
          code: 'CODIGO-MUITO-COMPRIDO-QUE-NAO-CABE-NA-COLUNA',
          description: 'X'.repeat(200),
          additional: 'Lote 12, validade 10/2027',
          gtin: undefined,
          reform: { cClassTrib: '000001', isBase: '100.00', isRate: '10.00', is: '10.00' },
        },
      ],
      fiscalInfo: 'Mensagem ao fisco',
    };
    const [folha] = layoutDanfeNfe(estranho, measure);
    const t = textos(folha!.ops);
    expect(t).toContain('529.982.247-25');
    expect(t).toContain('PASS-123');
    expect(t).toContain('9');
    expect(t).toContain('7');
    expect(t).toContain('VALOR DO IMPOSTO SELETIVO');
    expect(t).toContain('VALOR APROXIMADO DOS TRIBUTOS');
    expect(t).not.toContain('VALOR DO DIFAL NA UF DE DESTINO');
    expect(t.some((x) => x.endsWith('…'))).toBe(true);
    expect(t).toContain('IBS/CBS cClassTrib 000001 · IS BC 100,00 10,00% 10,00');
    expect(t).toContain('Lote 12, validade 10/2027');
    expect(t.some((x) => x.startsWith('Inf. fisco: Mensagem ao fisco'))).toBe(true);
    // Chave com letras (CNPJ alfanumérico) não vira CODE-128C: o código de barras fica de fora.
    expect(folha!.ops.some((op) => op.kind === 'bars')).toBe(false);
  });

  it('nota sem destinatário, sem transportadora e sem volumes', () => {
    const nfe = base();
    const [folha] = layoutDanfeNfe(
      {
        ...nfe,
        recipient: undefined,
        transport: { freightMode: '9', volumes: [] },
        additionalInfo: undefined,
        reformTotals: {},
      },
      measure,
    );
    const t = textos(folha!.ops);
    expect(t).toContain('9 - SEM TRANSPORTE');
    expect(t).not.toContain('TOTAL DO IBS / CBS / IS');
  });

  it('lê do XML os totais monofásicos, o IS e o que a nota não traz', () => {
    const { xml } = autorizado(nota(1));
    const comExtras = xml
      .replace(
        '</IBSCBSTot>',
        '<gMono><vIBSMono>1.00</vIBSMono><vCBSMono>2.00</vCBSMono></gMono></IBSCBSTot><ISTot><vIS>3.00</vIS></ISTot>',
      )
      .replace('<transp>', '<transp>')
      .replace(/<dest><CNPJ>\d+<\/CNPJ>/, '<dest><idEstrangeiro>X9</idEstrangeiro>')
      .replace('<IE>111222333444</IE>', '')
      .replace(/<fone>1932321000<\/fone>/, '');
    const nfe = readNfe(comExtras);
    expect(nfe.reformTotals).toMatchObject({ vIBSMono: '1.00', vCBSMono: '2.00', vIS: '3.00' });
    expect(nfe.recipient).toMatchObject({ foreignId: 'X9' });
    expect(nfe.recipient!.ie).toBeUndefined();
    expect(nfe.recipient!.address!.phone).toBeUndefined();
    const semDest = readNfe(xml.replace(/<dest>.*?<\/dest>/, '').replace(/<cobr>.*?<\/cobr>/, ''));
    expect(semDest.recipient).toBeUndefined();
    expect(semDest.duplicates).toEqual([]);
    const entrada = readNfe(
      xml
        .replace('<tpNF>1</tpNF>', '<tpNF>0</tpNF>')
        .replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>'),
    );
    expect(entrada).toMatchObject({ direction: '0', environment: 'producao' });
  });
});
