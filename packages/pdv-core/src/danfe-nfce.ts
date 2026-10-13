import { formatBRL, formatTaxId, type Cents } from '@bipae/domain';
import type { ReceiptBlock } from './escpos';
import { qrMatrix } from './receipt-html';

/**
 * Dados do DANFE NFC-e, tirados da nota autorizada (ou emitida em contingência). Valores em
 * centavos, quantidades em milésimos, como no resto do caixa.
 */
export interface DanfeNfceData {
  environment: 'producao' | 'homologacao';
  emitter: { cnpj: string; legalName: string; address: string };
  items: {
    code: string;
    description: string;
    quantityMilli: number;
    unit: string;
    unitPriceCents: number;
    totalCents: number;
  }[];
  /** Soma de frete, seguro e outras despesas (vFrete + vSeg + vOutro). */
  surchargeCents: number;
  discountCents: number;
  /** vNF. */
  totalCents: number;
  /** Uma linha por forma de pagamento: o nome do tPag e o vPag. */
  payments: { label: string; amountCents: number }[];
  changeCents: number;
  consumer: {
    kind: 'cpf' | 'cnpj' | 'estrangeiro';
    id: string;
    name?: string;
    address?: string;
  } | null;
  number: number;
  series: number;
  /** dhEmi como veio no XML; o DANFE mostra no horário local. */
  issuedAt: string;
  /** Protocolo de autorização. Fica de fora quando a nota foi emitida em contingência. */
  protocol: { number: string; receivedAt: string } | null;
  contingency: boolean;
  accessKey: string;
  urlChave: string;
  qrCode: string;
  /** infAdFisco. */
  fiscalMessage?: string;
  /** infCpl. */
  taxpayerMessage?: string;
  /** vTotTrib, para quem quiser mostrar a carga tributária da Lei 12.741/2012. */
  approximateTaxesCents?: number;
}

export interface DanfeNfceOptions {
  columns: number;
  /** DANFE resumido: sem a divisão II (só quando a UF permite e o consumidor concorda). */
  summary?: boolean;
  /** 2ª via da contingência, que fica com o estabelecimento. */
  establishmentCopy?: boolean;
  /** Fuso para mostrar as datas. Sem ele, vale o do aparelho, que é o horário local da loja. */
  timeZone?: string;
  /** Pontos por milímetro da impressora (8 nas térmicas comuns de 203 dpi). */
  dotsPerMm?: number;
}

const money = (cents: number) => formatBRL(cents as Cents).replace('R$ ', '');

function quantity(milli: number) {
  const value = milli / 1000;
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function twoColumns(left: string, right: string, columns: number) {
  const space = Math.max(1, columns - left.length - right.length);
  return (left + ' '.repeat(space) + right).slice(0, columns);
}

/** Quebra o texto em linhas que cabem no papel; palavras longas (URLs) são cortadas. */
export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= columns) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (rest.length > columns) {
      lines.push(rest.slice(0, columns));
      rest = rest.slice(columns);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Chave de acesso em 11 blocos de 4 dígitos, quebrando a linha só entre blocos. */
export function accessKeyLines(accessKey: string, columns: number): string[] {
  // O CNPJ alfanumérico (NT DFe Conjunta 2025) também entra na chave.
  if (!/^[0-9A-Z]{44}$/.test(accessKey)) {
    throw new Error('A chave de acesso precisa ter 44 caracteres.');
  }
  const groups = accessKey.match(/.{4}/g)!;
  return wrapText(groups.join(' '), columns);
}

function localDateTime(iso: string, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    ...(timeZone && { timeZone }),
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

const CONSUMER_LABEL = { cpf: 'CPF', cnpj: 'CNPJ', estrangeiro: 'Id. Estrangeiro' } as const;

/** Lado mínimo do conteúdo do QR Code, sem a margem: 22 mm (manual do DANFE NFC-e, 3.4). */
const QR_CONTENT_MM = 22;

/**
 * DANFE NFC-e em blocos de cupom (impressora térmica, tela ou navegador), nas divisões do
 * "Manual de Especificações Técnicas do DANFE NFC-e e QR Code", versão 5.1. O QR Code fica
 * centralizado (figura 5 do manual).
 */
export function buildDanfeNfce(data: DanfeNfceData, options: DanfeNfceOptions): ReceiptBlock[] {
  const { columns } = options;
  const line: ReceiptBlock = { kind: 'text', text: '-'.repeat(columns) };
  const text = (value: string, extra: Partial<Extract<ReceiptBlock, { kind: 'text' }>> = {}) =>
    wrapText(value, columns).map((t): ReceiptBlock => ({ kind: 'text', text: t, ...extra }));
  const pair = (left: string, right: string, bold = false): ReceiptBlock => ({
    kind: 'text',
    text: twoColumns(left, right, columns),
    bold,
  });
  const contingency: ReceiptBlock[] = data.contingency
    ? [
        { kind: 'text', text: 'EMITIDA EM CONTINGÊNCIA', align: 'center', bold: true },
        { kind: 'text', text: 'Pendente de autorização', align: 'center', bold: true },
      ]
    : [];
  const blocks: ReceiptBlock[] = [];

  // Divisão I: cabeçalho.
  blocks.push(
    ...text(`CNPJ: ${formatTaxId(data.emitter.cnpj)}`, { align: 'center' }),
    ...text(data.emitter.legalName, { align: 'center', bold: true }),
    ...text(data.emitter.address, { align: 'center' }),
    ...text('Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', { align: 'center' }),
    line,
  );
  if (data.contingency) blocks.push(...contingency, line);

  // Divisão II: itens (fora do DANFE resumido).
  if (!options.summary) {
    blocks.push(pair('Código Descrição', 'Qtde Un x Vl Unit = Vl Total'));
    for (const item of data.items) {
      blocks.push(...text(`${item.code} ${item.description}`));
      blocks.push(
        pair(
          `  ${quantity(item.quantityMilli)} ${item.unit} x ${money(item.unitPriceCents)}`,
          money(item.totalCents),
        ),
      );
    }
    blocks.push(line);
  }

  // Divisão III: totais e pagamentos.
  const itemsTotal = data.items.reduce((sum, item) => sum + item.totalCents, 0);
  blocks.push(
    pair('Qtde. total de itens', String(data.items.length)),
    pair('Valor total R$', money(itemsTotal)),
  );
  if (data.surchargeCents > 0) blocks.push(pair('Acréscimos R$', money(data.surchargeCents)));
  if (data.discountCents > 0) blocks.push(pair('Desconto R$', `-${money(data.discountCents)}`));
  if (data.surchargeCents > 0 || data.discountCents > 0) {
    blocks.push(pair('Valor a pagar R$', money(data.totalCents), true));
  }
  blocks.push(pair('FORMA PAGAMENTO', 'VALOR PAGO R$', true));
  for (const payment of data.payments) blocks.push(pair(payment.label, money(payment.amountCents)));
  blocks.push(pair('Troco R$', money(data.changeCents)), line);

  // Divisão IV: consulta pela chave.
  blocks.push(
    ...text(`Consulte pela Chave de Acesso em ${data.urlChave}`, { align: 'center' }),
    ...accessKeyLines(data.accessKey, columns).map((t): ReceiptBlock => ({
      kind: 'text',
      text: t,
      align: 'center',
    })),
    line,
  );

  // Divisão VI: consumidor.
  if (data.consumer) {
    const id =
      data.consumer.kind === 'estrangeiro' ? data.consumer.id : formatTaxId(data.consumer.id);
    blocks.push(
      ...text(`CONSUMIDOR ${CONSUMER_LABEL[data.consumer.kind]}: ${id}`, { align: 'center' }),
    );
    if (data.consumer.name) blocks.push(...text(data.consumer.name, { align: 'center' }));
    if (data.consumer.address) blocks.push(...text(data.consumer.address, { align: 'center' }));
  } else {
    blocks.push({ kind: 'text', text: 'CONSUMIDOR NÃO IDENTIFICADO', align: 'center' });
  }

  // Divisão VII: identificação da nota e protocolo.
  const issued = localDateTime(data.issuedAt, options.timeZone);
  blocks.push(
    ...text(
      `NFC-e nº ${String(data.number).padStart(9, '0')} Série ${String(data.series).padStart(3, '0')} ${issued}`,
      { align: 'center', bold: true },
    ),
  );
  if (options.establishmentCopy) {
    blocks.push({ kind: 'text', text: 'Via do Estabelecimento', align: 'center' });
  }
  if (data.protocol && !data.contingency) {
    blocks.push(
      ...text(`Protocolo de autorização: ${data.protocol.number}`, { align: 'center' }),
      ...text(`Data de autorização: ${localDateTime(data.protocol.receivedAt, options.timeZone)}`, {
        align: 'center',
      }),
    );
  }
  blocks.push(...contingency);

  // Divisão VIII: mensagem fiscal.
  if (data.environment === 'homologacao') {
    blocks.push(
      ...text('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL', {
        align: 'center',
        bold: true,
      }),
    );
  }
  if (data.fiscalMessage) blocks.push(...text(data.fiscalMessage, { align: 'center' }));

  // Divisão V: QR Code centralizado, com o conteúdo de no mínimo 22 mm.
  const modules = qrMatrix(data.qrCode).length;
  const dotsPerMm = options.dotsPerMm ?? 8;
  const moduleDots = Math.min(16, Math.ceil((QR_CONTENT_MM * dotsPerMm) / modules));
  blocks.push({ kind: 'feed', lines: 1 }, { kind: 'qrcode', data: data.qrCode, moduleDots });

  // Divisão IX: mensagem do contribuinte.
  if (data.approximateTaxesCents !== undefined || data.taxpayerMessage) blocks.push(line);
  if (data.approximateTaxesCents !== undefined) {
    blocks.push(
      ...text(
        `Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${money(data.approximateTaxesCents)}`,
      ),
    );
  }
  if (data.taxpayerMessage) blocks.push(...text(data.taxpayerMessage));
  return blocks;
}
