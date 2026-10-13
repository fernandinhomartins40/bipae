import { buildAccessKey, nfceSupplement } from '@bipae/fiscal';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
  accessKeyLines,
  buildDanfeNfce,
  encodeQrCode,
  encodeReceipt,
  qrMatrix,
  qrSvg,
  receiptToHtml,
  receiptToText,
  wrapText,
  type DanfeNfceData,
} from './index';

const accessKey = buildAccessKey({
  cUF: '43',
  yearMonth: '2610',
  cnpj: '11222333000181',
  model: '65',
  series: 1,
  number: 123,
  emissionType: 1,
  numericCode: '12345678',
});
const { qrCode, urlChave } = nfceSupplement({ uf: 'RS', accessKey, environment: 'homologacao' });

const nota: DanfeNfceData = {
  environment: 'homologacao',
  emitter: {
    cnpj: '11222333000181',
    legalName: 'MERCADO BIPAÊ LTDA',
    address: 'Rua das Flores, 100, Centro, Porto Alegre, RS',
  },
  items: [
    {
      code: '7891000100103',
      description: 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
      quantityMilli: 2000,
      unit: 'UN',
      unitPriceCents: 450,
      totalCents: 900,
    },
    {
      code: '20001',
      description: 'Banana prata',
      quantityMilli: 1255,
      unit: 'KG',
      unitPriceCents: 699,
      totalCents: 877,
    },
  ],
  surchargeCents: 0,
  discountCents: 77,
  totalCents: 1700,
  payments: [{ label: 'Dinheiro', amountCents: 2000 }],
  changeCents: 300,
  consumer: null,
  number: 123,
  series: 1,
  issuedAt: '2026-10-13T17:05:09-03:00',
  protocol: { number: '143260000012345', receivedAt: '2026-10-13T20:05:11Z' },
  contingency: false,
  accessKey,
  urlChave,
  qrCode,
};

const opcoes = { columns: 48, timeZone: 'America/Sao_Paulo' };
const textoDe = (data: DanfeNfceData, extra = {}) =>
  receiptToText(buildDanfeNfce(data, { ...opcoes, ...extra }), 48);

/** Lê o QR Code desenhado, como faria a câmera do celular. */
function lerQr(matrix: boolean[][]): string | null {
  const scale = 4;
  const side = (matrix.length + 8) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
      }
    }),
  );
  return jsQR(rgba, side, side)?.data ?? null;
}

describe('DANFE NFC-e (F3-13.b)', () => {
  it('traz as divisões do manual na ordem, sem passar da largura do papel', () => {
    const linhas = textoDe(nota);
    for (const linha of linhas) expect(linha.length).toBeLessThanOrEqual(48);
    const texto = linhas.join('\n');
    const ordem = [
      'CNPJ: 11.222.333/0001-81',
      'MERCADO BIPAÊ LTDA',
      'Documento Auxiliar da Nota Fiscal de Consumidor',
      '7891000100103 NOTA FISCAL EMITIDA EM AMBIENTE',
      'Qtde. total de itens',
      'FORMA PAGAMENTO',
      'Consulte pela Chave de Acesso em',
      'CONSUMIDOR NÃO IDENTIFICADO',
      'NFC-e nº 000000123 Série 001 13/10/2026 17:05:09',
      'Protocolo de autorização: 143260000012345',
      'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR',
      '[QR Code]',
    ];
    let ultimo = -1;
    for (const trecho of ordem) {
      const posicao = texto.indexOf(trecho);
      expect(posicao, trecho).toBeGreaterThan(ultimo);
      ultimo = posicao;
    }
  });

  it('mostra totais, desconto, pagamento e troco com vírgula e ponto de milhar', () => {
    const texto = textoDe(nota).join('\n');
    expect(texto).toMatch(/2 UN x 4,50 +9,00/);
    expect(texto).toMatch(/1,255 KG x 6,99 +8,77/);
    expect(texto).toMatch(/Qtde\. total de itens +2/);
    expect(texto).toMatch(/Valor total R\$ +17,77/);
    expect(texto).toMatch(/Desconto R\$ +-0,77/);
    expect(texto).toMatch(/Valor a pagar R\$ +17,00/);
    expect(texto).toMatch(/Dinheiro +20,00/);
    expect(texto).toMatch(/Troco R\$ +3,00/);
    expect(texto).not.toContain('Acréscimos');

    const grande = textoDe({
      ...nota,
      items: [{ ...nota.items[0]!, unitPriceCents: 123_456, totalCents: 246_912 }],
      discountCents: 0,
      surchargeCents: 500,
      totalCents: 247_412,
    }).join('\n');
    expect(grande).toMatch(/Valor total R\$ +2\.469,12/);
    expect(grande).toMatch(/Acréscimos R\$ +5,00/);
    expect(grande).toMatch(/Valor a pagar R\$ +2\.474,12/);
  });

  it('sem desconto nem acréscimo não imprime o "Valor a pagar"', () => {
    const texto = textoDe({ ...nota, discountCents: 0, totalCents: 1777 }).join('\n');
    expect(texto).not.toContain('Valor a pagar');
    expect(texto).not.toContain('Desconto');
  });

  it('mostra a chave em 11 blocos de 4, quebrando só entre blocos', () => {
    const linhas = accessKeyLines(accessKey, 48);
    expect(linhas.join(' ').split(' ')).toHaveLength(11);
    expect(linhas.join('').replace(/ /g, '')).toBe(accessKey);
    expect(accessKeyLines(accessKey, 32)).toHaveLength(2);
    expect(accessKeyLines('A'.repeat(44), 60)).toEqual([Array(11).fill('AAAA').join(' ')]);
    expect(() => accessKeyLines('123', 48)).toThrow('44 caracteres');
  });

  it('identifica o consumidor por CPF, CNPJ ou documento estrangeiro', () => {
    const cpf = textoDe({
      ...nota,
      consumer: { kind: 'cpf', id: '52998224725', name: 'Ana Souza', address: 'Rua A, 1' },
    }).join('\n');
    expect(cpf).toContain('CONSUMIDOR CPF: 529.982.247-25');
    expect(cpf).toContain('Ana Souza');
    expect(cpf).toContain('Rua A, 1');
    expect(cpf).not.toContain('NÃO IDENTIFICADO');
    expect(
      textoDe({ ...nota, consumer: { kind: 'cnpj', id: '11222333000181' } }).join('\n'),
    ).toContain('CONSUMIDOR CNPJ: 11.222.333/0001-81');
    expect(
      textoDe({ ...nota, consumer: { kind: 'estrangeiro', id: 'X1234567' } }).join('\n'),
    ).toContain('CONSUMIDOR Id. Estrangeiro: X1234567');
  });

  it('em contingência avisa duas vezes, sem protocolo, e marca a via do estabelecimento', () => {
    const linhas = textoDe({ ...nota, contingency: true }, { establishmentCopy: true });
    const texto = linhas.join('\n');
    expect(linhas.filter((l) => l.includes('EMITIDA EM CONTINGÊNCIA'))).toHaveLength(2);
    expect(linhas.filter((l) => l.includes('Pendente de autorização'))).toHaveLength(2);
    expect(texto).not.toContain('Protocolo de autorização');
    expect(texto).toContain('Via do Estabelecimento');
  });

  it('em produção não traz o aviso de homologação', () => {
    expect(textoDe({ ...nota, environment: 'producao' }).join('\n')).not.toContain('HOMOLOGAÇÃO');
  });

  it('o DANFE resumido não lista os itens, mas mantém os totais', () => {
    const texto = textoDe(nota, { summary: true }).join('\n');
    expect(texto).not.toContain('Banana prata');
    expect(texto).toMatch(/Qtde\. total de itens +2/);
  });

  it('imprime as mensagens fiscal, do contribuinte e os tributos da Lei 12.741', () => {
    const texto = textoDe({
      ...nota,
      fiscalMessage: 'Mensagem do fisco',
      taxpayerMessage: 'Volte sempre!',
      approximateTaxesCents: 312,
    })
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(texto).toContain('Mensagem do fisco');
    expect(texto).toContain('Volte sempre!');
    expect(texto).toContain('(Lei Federal 12.741/2012): R$ 3,12');
  });

  it('converte data e hora para o fuso pedido', () => {
    const manaus = textoDe(nota, { timeZone: 'America/Manaus' }).join('\n');
    expect(manaus).toContain('13/10/2026 16:05:09');
    expect(manaus).toContain('Data de autorização: 13/10/2026 16:05:11');
  });

  it('o QR Code da tela e do navegador é lido de volta com o conteúdo da nota', () => {
    expect(lerQr(qrMatrix(qrCode))).toBe(qrCode);
    const svg = qrSvg(qrCode);
    expect(svg).toMatch(/^<svg [^>]*width="30mm" height="30mm"/);
    expect(qrSvg(qrCode, 25)).toContain('width="25mm"');
  });

  it('o QR Code impresso tem pelo menos 22 mm de conteúdo', () => {
    const blocos = buildDanfeNfce(nota, opcoes);
    const qr = blocos.find((b) => b.kind === 'qrcode');
    expect(qr).toMatchObject({ kind: 'qrcode', data: qrCode });
    const lado = qrMatrix(qrCode).length;
    const pontos = (qr as { moduleDots: number }).moduleDots;
    expect((lado * pontos) / 8).toBeGreaterThanOrEqual(22);
    // Impressora de 300 dpi (≈ 12 pontos por mm) precisa de quadradinhos maiores.
    const maior = buildDanfeNfce(nota, { ...opcoes, dotsPerMm: 12 }).find(
      (b) => b.kind === 'qrcode',
    );
    expect((maior as { moduleDots: number }).moduleDots).toBeGreaterThan(pontos);
  });
});

describe('QR Code na impressora (ESC/POS)', () => {
  it('monta os comandos GS ( k com o conteúdo e o tamanho', () => {
    const bytes = encodeQrCode('ABC', 6);
    const gs = (...rest: number[]) => [0x1d, 0x28, 0x6b, ...rest];
    expect(bytes).toEqual([
      ...gs(4, 0, 0x31, 0x41, 0x32, 0),
      ...gs(3, 0, 0x31, 0x43, 6),
      ...gs(3, 0, 0x31, 0x45, 0x31),
      ...gs(6, 0, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43),
      ...gs(3, 0, 0x31, 0x51, 0x30),
      0x0a,
    ]);
    const longo = encodeQrCode('x'.repeat(300), 4);
    expect(longo.slice(28, 30)).toEqual([303 & 0xff, 303 >> 8]);
  });

  it('recusa tamanho fora de 1 a 16 e texto fora do ASCII', () => {
    expect(() => encodeQrCode('A', 0)).toThrow('1 a 16');
    expect(() => encodeQrCode('A', 17)).toThrow('1 a 16');
    expect(() => encodeQrCode('ação', 4)).toThrow('ASCII');
  });

  it('o DANFE vira bytes com o QR Code centralizado', () => {
    const bytes = Array.from(encodeReceipt(buildDanfeNfce(nota, opcoes)));
    const inicio = bytes.findIndex(
      (b, i) =>
        b === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b && bytes[i + 6] === 0x50,
    );
    expect(inicio).toBeGreaterThan(0);
    const tamanho = bytes[inicio + 3]! + bytes[inicio + 4]! * 256 - 3;
    expect(String.fromCharCode(...bytes.slice(inicio + 8, inicio + 8 + tamanho))).toBe(qrCode);
  });
});

describe('cupom em HTML', () => {
  it('escapa o texto, mantém o alinhamento e desenha o QR Code', () => {
    const html = receiptToHtml(
      [
        { kind: 'text', text: 'Loja <Teste> & "Cia"', align: 'center', bold: true },
        { kind: 'text', text: 'Grande', large: true },
        { kind: 'feed', lines: 2 },
        { kind: 'qrcode', data: 'https://exemplo.gov.br/?p=1', moduleDots: 4 },
      ],
      48,
    );
    expect(html).toContain('Loja &lt;Teste&gt; &amp; &quot;Cia&quot;');
    expect(html).toContain('text-align:center;font-weight:bold');
    expect(html).toContain('font-size:1.6em');
    expect(html.match(/bipae-feed/g)).toHaveLength(2);
    expect(html).toContain('<svg');
    expect(html).toContain('width:48ch');
    expect(html).not.toContain('<Teste>');
  });

  it('quebra textos longos sem perder palavras', () => {
    expect(wrapText('um dois três', 7)).toEqual(['um dois', 'três']);
    expect(wrapText('https://www.sefaz.rs.gov.br/nfce/consulta', 16)).toEqual([
      'https://www.sefa',
      'z.rs.gov.br/nfce',
      '/consulta',
    ]);
    expect(wrapText('a https://www.sefaz.rs.gov.br', 16)).toEqual([
      'a',
      'https://www.sefa',
      'z.rs.gov.br',
    ]);
    expect(wrapText('', 10)).toEqual([]);
  });
});
