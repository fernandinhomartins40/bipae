import { code128KeyModules } from './code128';
import {
  accessKeyBR,
  cepBR,
  crtBR,
  dateBR,
  decimalBR,
  freightBR,
  nfNumberBR,
  phoneBR,
  quantityBR,
  rateBR,
  taxIdBR,
  timeBR,
} from './format';
import type { DanfeItem, DanfeNfe } from './nfe-data';

/**
 * Leiaute do DANFE da NF-e em A4 retrato: posições e tamanhos do Anexo II do MOC 7.0 (item
 * 3.8.1, folhas soltas), com os quadros da NT 2026.010 (CRT do emitente, "Total do IBS/CBS/IS" e
 * IBS/CBS de cada item). Sai uma lista de desenhos por folha, em pontos, com a origem no canto
 * superior esquerdo; quem desenha o PDF só converte.
 */
export type DrawOp =
  | {
      kind: 'text';
      x: number;
      /** Linha de base do texto. */
      y: number;
      text: string;
      size: number;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  | { kind: 'bars'; x: number; y: number; h: number; module: number; widths: number[] }
  | { kind: 'watermark'; text: string };

export interface DanfePage {
  ops: DrawOp[];
}

/** Largura de um texto na fonte do DANFE (Times New Roman, como manda o item 3.7). */
export type Measure = (text: string, size: number, bold: boolean) => number;

export interface DanfeLayoutOptions {
  /** Prévia de nota ainda não autorizada: marca d'água e aviso no lugar do protocolo. */
  preview?: boolean;
}

export const A4 = { width: 595.28, height: 841.89 };
const CM = 28.3465;
const cm = (value: number) => value * CM;
const LEFT = cm(0.25);
const WIDTH = cm(20.57);
const RIGHT = LEFT + WIDTH;
const BOTTOM = A4.height - cm(0.3);
const FIELD_H = cm(0.85);
const TITLE_H = cm(0.42);

/** Tamanhos mínimos do item 3.7 (em pontos). */
export const FONT = {
  blockTitle: 6,
  label: 6,
  value: 10,
  minValue: 7,
  emitterName: 12,
  emitterData: 8,
  danfe: 14,
  docData: 10,
  docLabel: 8,
  productHeader: 5.5,
  product: 6.5,
  additional: 7,
};

const HOMOLOGACAO = 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL';

export class DanfeLayoutError extends Error {}

class Writer {
  readonly ops: DrawOp[] = [];
  constructor(private readonly measure: Measure) {}

  text(
    x: number,
    y: number,
    text: string,
    size: number,
    opts: { bold?: boolean; align?: 'left' | 'center' | 'right' } = {},
  ) {
    if (text) this.ops.push({ kind: 'text', x, y, text, size, ...opts });
  }

  /** Reduz a fonte até caber (sem passar do mínimo) e, se ainda não couber, corta com reticências. */
  fit(
    text: string,
    width: number,
    size: number,
    min: number,
    bold = false,
  ): { text: string; size: number } {
    let current = size;
    while (current > min && this.measure(text, current, bold) > width) current -= 0.5;
    if (this.measure(text, current, bold) <= width) return { text, size: current };
    let cut = text;
    while (cut.length > 1 && this.measure(`${cut}…`, current, bold) > width) cut = cut.slice(0, -1);
    return { text: `${cut}…`, size: current };
  }

  wrap(text: string, width: number, size: number, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.measure(candidate, size, bold) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        // Palavra maior que a linha (URL, código): quebra no meio.
        let rest = word;
        while (this.measure(rest, size, bold) > width && rest.length > 1) {
          let n = rest.length - 1;
          while (n > 1 && this.measure(rest.slice(0, n), size, bold) > width) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  rect(x: number, y: number, w: number, h: number) {
    this.ops.push({ kind: 'rect', x, y, w, h });
  }

  /** Campo com descritivo em caixa alta (6 pt) e conteúdo (10 pt, reduzido se não couber). */
  field(
    x: number,
    y: number,
    w: number,
    label: string,
    value: string,
    opts: { align?: 'left' | 'center' | 'right'; bold?: boolean; h?: number } = {},
  ) {
    const h = opts.h ?? FIELD_H;
    this.rect(x, y, w, h);
    const caption = this.fit(label.toUpperCase(), w - 3, FONT.label, 5);
    this.text(x + 2, y + FONT.label + 1, caption.text, caption.size);
    if (!value) return;
    const fitted = this.fit(value, w - 4, FONT.value, FONT.minValue, opts.bold);
    const tx = opts.align === 'right' ? x + w - 2 : opts.align === 'center' ? x + w / 2 : x + 2;
    this.text(tx, y + h - 4, fitted.text, fitted.size, { bold: opts.bold, align: opts.align });
  }

  /** Linha de campos lado a lado, com larguras em cm que somam a largura útil. */
  row(
    y: number,
    fields: [label: string, value: string, widthCm: number, align?: 'right' | 'center'][],
  ) {
    let x = LEFT;
    const total = fields.reduce((sum, f) => sum + f[2], 0);
    for (const [label, value, w, align] of fields) {
      const width = (w / total) * WIDTH;
      this.field(x, y, width, label, value, { align });
      x += width;
    }
    return y + FIELD_H;
  }

  title(y: number, text: string) {
    this.text(LEFT, y + TITLE_H - 3, text.toUpperCase(), FONT.blockTitle, { bold: true });
    return y + TITLE_H;
  }
}

const money = (value: string | undefined) => decimalBR(value ?? '0');
const positive = (value: string | undefined) => value !== undefined && /[1-9]/.test(value);

// ------------------------------------------------------------------ produtos

interface Column {
  label: string;
  width: number;
  align: 'left' | 'center' | 'right';
  value: (item: DanfeItem) => string;
}

/** Colunas obrigatórias do item 3.1.7 (mais desconto e alíquota do IPI), na ordem do modelo. */
const COLUMNS: Column[] = [
  { label: 'CÓDIGO', width: 1.6, align: 'left', value: (i) => i.code },
  {
    label: 'DESCRIÇÃO DO PRODUTO / SERVIÇO',
    width: 4.6,
    align: 'left',
    value: (i) => i.description,
  },
  { label: 'NCM/SH', width: 1.25, align: 'center', value: (i) => i.ncm },
  { label: 'O/CST', width: 0.8, align: 'center', value: (i) => i.cst },
  { label: 'CFOP', width: 0.8, align: 'center', value: (i) => i.cfop },
  { label: 'UN', width: 0.75, align: 'center', value: (i) => i.unit },
  { label: 'QUANT', width: 1.35, align: 'right', value: (i) => quantityBR(i.quantity) },
  { label: 'VALOR UNIT', width: 1.45, align: 'right', value: (i) => decimalBR(i.unitPrice) },
  { label: 'VALOR DESC', width: 1.1, align: 'right', value: (i) => decimalBR(i.discount) },
  { label: 'VALOR TOTAL', width: 1.5, align: 'right', value: (i) => decimalBR(i.total) },
  { label: 'B.CÁLC ICMS', width: 1.45, align: 'right', value: (i) => decimalBR(i.icmsBase) },
  { label: 'VALOR ICMS', width: 1.2, align: 'right', value: (i) => decimalBR(i.icmsValue) },
  { label: 'VALOR IPI', width: 1.1, align: 'right', value: (i) => decimalBR(i.ipiValue) },
  { label: 'ALÍQ ICMS', width: 0.82, align: 'right', value: (i) => rateBR(i.icmsRate) },
  { label: 'ALÍQ IPI', width: 0.8, align: 'right', value: (i) => rateBR(i.ipiRate) },
];
const PRODUCT_LINE = FONT.product + 2;

/** Linhas extras abaixo do item: IBS/CBS/IS (NT 2026.010, 4.3) e informações adicionais. */
function itemNotes(item: DanfeItem): string[] {
  const notes: string[] = [];
  const r = item.reform;
  if (r) {
    const parts = [`IBS/CBS cClassTrib ${r.cClassTrib}`];
    if (r.base !== undefined) parts.push(`BC ${decimalBR(r.base)}`);
    if (r.ibsUf !== undefined) parts.push(`IBS UF ${rateBR(r.ibsUfRate)}% ${decimalBR(r.ibsUf)}`);
    if (r.ibsMun !== undefined)
      parts.push(`IBS Mun ${rateBR(r.ibsMunRate)}% ${decimalBR(r.ibsMun)}`);
    if (r.cbs !== undefined) parts.push(`CBS ${rateBR(r.cbsRate)}% ${decimalBR(r.cbs)}`);
    if (r.is !== undefined)
      parts.push(`IS BC ${decimalBR(r.isBase)} ${rateBR(r.isRate)}% ${decimalBR(r.is)}`);
    notes.push(parts.join(' · '));
  }
  if (item.gtin) notes.push(`EAN ${item.gtin}`);
  if (item.additional) notes.push(item.additional);
  return notes;
}

interface ItemBlock {
  height: number;
  draw: (w: Writer, y: number) => void;
}

function itemBlocks(w: Writer, items: DanfeItem[]): ItemBlock[] {
  const total = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const widths = COLUMNS.map((c) => (c.width / total) * WIDTH);
  const descX = LEFT + widths[0]!;
  const notesWidth = RIGHT - descX - 4;
  return items.map((item) => {
    const description = w.wrap(item.description, widths[1]! - 4, FONT.product);
    const notes = itemNotes(item).flatMap((n) => w.wrap(n, notesWidth, FONT.product));
    const lines = description.length + notes.length;
    const height = lines * PRODUCT_LINE + 3;
    return {
      height,
      draw: (writer, y) => {
        let x = LEFT;
        COLUMNS.forEach((column, i) => {
          const width = widths[i]!;
          const baseline = y + FONT.product + 1;
          if (i === 1) {
            description.forEach((line, n) =>
              writer.text(x + 2, baseline + n * PRODUCT_LINE, line, FONT.product),
            );
          } else {
            const fitted = writer.fit(column.value(item), width - 3, FONT.product, 5);
            const tx =
              column.align === 'right'
                ? x + width - 1.5
                : column.align === 'center'
                  ? x + width / 2
                  : x + 1.5;
            writer.text(tx, baseline, fitted.text, fitted.size, { align: column.align });
          }
          x += width;
        });
        notes.forEach((line, n) =>
          writer.text(
            descX + 2,
            y + FONT.product + 1 + (description.length + n) * PRODUCT_LINE,
            line,
            FONT.product,
          ),
        );
        // Destaque divisório entre itens (item 3.1.7).
        writer.ops.push({
          kind: 'line',
          x1: LEFT,
          y1: y + height,
          x2: RIGHT,
          y2: y + height,
          dashed: true,
        });
      },
    };
  });
}

function productHeader(w: Writer, y: number): number {
  const total = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const h = cm(0.6);
  let x = LEFT;
  for (const column of COLUMNS) {
    const width = (column.width / total) * WIDTH;
    w.rect(x, y, width, h);
    const lines = w.wrap(column.label, width - 2, FONT.productHeader);
    lines
      .slice(0, 2)
      .forEach((line, n) =>
        w.text(
          x + width / 2,
          y + FONT.productHeader + 2 + n * (FONT.productHeader + 1),
          line,
          FONT.productHeader,
          { align: 'center' },
        ),
      );
    x += width;
  }
  return y + h;
}

// ------------------------------------------------------------------ cabeçalho

function header(
  w: Writer,
  nfe: DanfeNfe,
  page: number,
  pages: number,
  options: DanfeLayoutOptions,
  top: number,
): number {
  const y = top;
  // Quadro do emitente (laser: 10 cm), do "DANFE" (2,54 cm) e do código de barras (8 cm).
  const emitterW = cm(10);
  const danfeX = LEFT + emitterW;
  const danfeW = cm(2.54);
  const keyX = danfeX + danfeW;
  const keyW = RIGHT - keyX;
  const boxH = cm(3.92);
  w.rect(LEFT, y, emitterW, boxH);
  const e = nfe.emitter;
  let ey = y + FONT.emitterName + 6;
  for (const line of w
    .wrap(e.tradeName ?? e.name, emitterW - 8, FONT.emitterName, true)
    .slice(0, 2)) {
    w.text(LEFT + emitterW / 2, ey, line, FONT.emitterName, { bold: true, align: 'center' });
    ey += FONT.emitterName + 2;
  }
  const a = e.address;
  const emitterLines = [
    ...(e.tradeName ? [e.name] : []),
    a.street,
    [a.district, a.cep && `CEP ${cepBR(a.cep)}`].filter(Boolean).join(' - '),
    `${a.cityName} - ${a.uf}`,
    a.phone ? `Fone: ${phoneBR(a.phone)}` : '',
  ].filter(Boolean);
  for (const text of emitterLines) {
    for (const line of w.wrap(text, emitterW - 8, FONT.emitterData, true)) {
      if (ey > y + boxH - 3) break;
      w.text(LEFT + emitterW / 2, ey + 2, line, FONT.emitterData, { bold: true, align: 'center' });
      ey += FONT.emitterData + 2;
    }
  }

  w.rect(danfeX, y, danfeW, boxH);
  const cx = danfeX + danfeW / 2;
  w.text(cx, y + 15, 'DANFE', FONT.danfe, { bold: true, align: 'center' });
  let dy = y + 24;
  for (const line of w.wrap(
    'DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA',
    danfeW - 4,
    FONT.docLabel,
  )) {
    w.text(cx, dy, line, FONT.docLabel, { align: 'center' });
    dy += FONT.docLabel + 0.5;
  }
  w.text(danfeX + 4, dy + 6, '0 - ENTRADA', FONT.docLabel);
  w.text(danfeX + 4, dy + 15, '1 - SAÍDA', FONT.docLabel);
  w.rect(danfeX + danfeW - 16, dy - 1, 13, 17);
  w.text(danfeX + danfeW - 9.5, dy + 12, nfe.direction, FONT.docData, {
    bold: true,
    align: 'center',
  });
  w.text(cx, y + boxH - 25, `Nº ${nfNumberBR(nfe.number)}`, FONT.docData, {
    bold: true,
    align: 'center',
  });
  w.text(cx, y + boxH - 14, `SÉRIE ${nfe.series.padStart(3, '0')}`, FONT.docData, {
    bold: true,
    align: 'center',
  });
  w.text(cx, y + boxH - 3.5, `FOLHA ${page}/${pages}`, FONT.docData, {
    bold: true,
    align: 'center',
  });

  // Código de barras da chave (CODE-128C; com letras do CNPJ alfanumérico, híbrido C/A da NT
  // Conjunta 2025.001), chave e consulta de autenticidade (campos 1 e 2).
  const barsH = cm(1.48);
  w.rect(keyX, y, keyW, barsH);
  if (/^\d{4}[0-9A-Z]{40}$/.test(nfe.accessKey)) {
    const widths = code128KeyModules(nfe.accessKey);
    const modules = widths.reduce((sum, n) => sum + n, 0);
    const module = Math.min((keyW - cm(0.6)) / modules, 1.2);
    const barsWidth = module * modules;
    w.ops.push({
      kind: 'bars',
      x: keyX + (keyW - barsWidth) / 2,
      y: y + cm(0.24),
      h: cm(1),
      module,
      widths,
    });
  }
  w.field(keyX, y + barsH, keyW, 'Chave de acesso', accessKeyBR(nfe.accessKey), {
    bold: true,
    align: 'center',
  });
  const consultY = y + barsH + FIELD_H;
  const consultH = y + boxH - consultY;
  w.rect(keyX, consultY, keyW, consultH);
  w.text(
    keyX + keyW / 2,
    consultY + 12,
    'Consulta de autenticidade no portal nacional da NF-e',
    8,
    { align: 'center' },
  );
  w.text(
    keyX + keyW / 2,
    consultY + 22,
    'www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora',
    8,
    { align: 'center' },
  );

  // Natureza da operação e protocolo; inscrições, CRT e CNPJ.
  let row = y + boxH;
  const protocol = nfe.protocol
    ? `${nfe.protocol.number} ${dateBR(nfe.protocol.receivedAt)} ${timeBR(nfe.protocol.receivedAt)}`
    : options.preview
      ? 'PRÉVIA: NOTA AINDA NÃO AUTORIZADA'
      : '';
  w.field(LEFT, row, keyX - LEFT, 'Natureza da operação', nfe.nature);
  w.field(keyX, row, keyW, 'Protocolo de autorização de uso', protocol, { align: 'center' });
  row += FIELD_H;
  return w.row(row, [
    ['Inscrição estadual', e.ie ?? '', 5],
    ['Inscrição estadual do subst. tributário', e.ieSt ?? '', 5],
    ['Código do regime tributário', crtBR(e.crt), 5.2],
    [e.cpf ? 'CPF' : 'CNPJ', taxIdBR(e.cnpj ?? e.cpf), 5.37],
  ]);
}

function canhoto(w: Writer, nfe: DanfeNfe): number {
  const y = cm(0.42);
  const nfX = LEFT + cm(16.1);
  const received = `RECEBEMOS DE ${nfe.emitter.name.toUpperCase()} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`;
  w.rect(LEFT, y, cm(16.1), FIELD_H);
  w.wrap(received, cm(16.1) - 4, FONT.label)
    .slice(0, 2)
    .forEach((line, n) => w.text(LEFT + 2, y + 8 + n * 8, line, FONT.label));
  w.field(LEFT, y + FIELD_H, cm(4.1), 'Data de recebimento', '');
  w.field(LEFT + cm(4.1), y + FIELD_H, cm(12), 'Identificação e assinatura do recebedor', '');
  w.rect(nfX, y, RIGHT - nfX, FIELD_H * 2);
  w.text(nfX + (RIGHT - nfX) / 2, y + 14, 'NF-e', 12, { bold: true, align: 'center' });
  w.text(nfX + (RIGHT - nfX) / 2, y + 28, `Nº ${nfNumberBR(nfe.number)}`, FONT.docData, {
    bold: true,
    align: 'center',
  });
  w.text(nfX + (RIGHT - nfX) / 2, y + 41, `SÉRIE ${nfe.series.padStart(3, '0')}`, FONT.docData, {
    bold: true,
    align: 'center',
  });
  const cut = y + FIELD_H * 2 + cm(0.3);
  w.ops.push({ kind: 'line', x1: LEFT, y1: cut, x2: RIGHT, y2: cut, dashed: true });
  return cm(2.54);
}

// ------------------------------------------------------------------ quadros da primeira folha

function recipient(w: Writer, nfe: DanfeNfe, top: number): number {
  let y = w.title(top, 'Destinatário / remetente');
  const r = nfe.recipient;
  const a = r?.address;
  y = w.row(y, [
    ['Nome / razão social', r?.name ?? '', 12.32],
    ['CNPJ / CPF', r?.foreignId ?? taxIdBR(r?.cnpj ?? r?.cpf), 5.33],
    ['Data da emissão', dateBR(nfe.issuedAt), 2.92, 'center'],
  ]);
  y = w.row(y, [
    ['Endereço', a?.street ?? '', 10.16],
    ['Bairro / distrito', a?.district ?? '', 4.83],
    ['CEP', cepBR(a?.cep), 2.67],
    ['Data da saída/entrada', dateBR(nfe.leavesAt), 2.92, 'center'],
  ]);
  return w.row(y, [
    ['Município', a?.cityName ?? '', 7.11],
    ['Fone / fax', phoneBR(a?.phone), 4.06],
    ['UF', a?.uf ?? '', 1.14, 'center'],
    ['Inscrição estadual', r?.ie ?? '', 5.33],
    ['Hora da saída/entrada', timeBR(nfe.leavesAt), 2.92, 'center'],
  ]);
}

function duplicates(w: Writer, nfe: DanfeNfe, top: number): number {
  if (nfe.duplicates.length === 0) return top;
  let y = w.title(top, 'Fatura / duplicatas');
  const perRow = 6;
  const cellW = WIDTH / perRow;
  for (let i = 0; i < nfe.duplicates.length; i += perRow) {
    nfe.duplicates.slice(i, i + perRow).forEach((d, n) => {
      const x = LEFT + n * cellW;
      w.rect(x, y, cellW, FIELD_H);
      w.text(x + 2, y + 8, `Núm.: ${d.number}`, FONT.label);
      w.text(x + 2, y + 15.5, `Venc.: ${dateBR(d.dueDate)}`, FONT.label);
      w.text(x + 2, y + 23, `Valor: R$ ${decimalBR(d.value)}`, FONT.label, { bold: true });
    });
    y += FIELD_H;
  }
  return y;
}

function taxes(w: Writer, nfe: DanfeNfe, top: number): number {
  const t = nfe.totals;
  let y = w.title(top, 'Cálculo do imposto');
  y = w.row(y, [
    ['Base de cálc. do ICMS', money(t.vBC), 4.06, 'right'],
    ['Valor do ICMS', money(t.vICMS), 4.06, 'right'],
    ['Base de cálc. ICMS S.T.', money(t.vBCST), 4.06, 'right'],
    ['Valor do ICMS subst.', money(t.vST), 4.06, 'right'],
    ['Valor total dos produtos', money(t.vProd), 4.33, 'right'],
  ]);
  y = w.row(y, [
    ['Valor do frete', money(t.vFrete), 3.3, 'right'],
    ['Valor do seguro', money(t.vSeg), 3.3, 'right'],
    ['Desconto', money(t.vDesc), 3.3, 'right'],
    ['Outras despesas', money(t.vOutro), 3.3, 'right'],
    ['Valor do IPI', money(t.vIPI), 3.3, 'right'],
    ['Valor total da nota', money(t.vNF), 4.07, 'right'],
  ]);
  // Campos condicionados à existência da informação no XML (NT 2026.010, 4.4).
  const optional: [string, string | undefined][] = [
    ['Valor do FCP', t.vFCP],
    ['Valor do FCP retido por ST', t.vFCPST],
    ['Valor do DIFAL na UF de destino', t.vICMSUFDest],
    ['Valor do FCP na UF de destino', t.vFCPUFDest],
    ['Valor aproximado dos tributos', t.vTotTrib],
  ];
  const shown = optional.filter(([, value]) => positive(value));
  if (shown.length > 0)
    y = w.row(
      y,
      shown.map(([label, value]) => [label, money(value), 4, 'right']),
    );
  const r = nfe.reformTotals;
  if (r && Object.keys(r).length > 0) {
    y = w.title(y, 'Total do IBS / CBS / IS');
    const labels: [keyof NonNullable<DanfeNfe['reformTotals']>, string][] = [
      ['vCBS', 'Valor da CBS'],
      ['vIBSUF', 'Valor do IBS UF'],
      ['vIBSMun', 'Valor do IBS município'],
      ['vIS', 'Valor do imposto seletivo'],
      ['vIBSMono', 'Valor do IBS monofásico'],
      ['vCBSMono', 'Valor da CBS monofásica'],
      ['vIBSMonoReten', 'IBS monofásico por retenção'],
      ['vCBSMonoReten', 'CBS monofásica por retenção'],
    ];
    const fields = labels
      .filter(([key]) => r[key] !== undefined)
      .map(([key, label]): [string, string, number, 'right'] => [label, money(r[key]), 4, 'right']);
    for (let i = 0; i < fields.length; i += 5) y = w.row(y, fields.slice(i, i + 5));
  }
  return y;
}

function transport(w: Writer, nfe: DanfeNfe, top: number): number {
  const t = nfe.transport;
  const c = t.carrier;
  let y = w.title(top, 'Transportador / volumes transportados');
  y = w.row(y, [
    ['Nome / razão social', c?.name ?? '', 9.02],
    ['Frete por conta', freightBR(t.freightMode), 3.6],
    ['Código ANTT', '', 1.8],
    ['Placa do veículo', '', 2.0],
    ['UF', '', 0.8, 'center'],
    ['CNPJ / CPF', taxIdBR(c?.cnpj ?? c?.cpf), 3.35],
  ]);
  y = w.row(y, [
    ['Endereço', c?.address ?? '', 9.02],
    ['Município', c?.cityName ?? '', 6.86],
    ['UF', c?.uf ?? '', 0.76, 'center'],
    ['Inscrição estadual', c?.ie ?? '', 3.94],
  ]);
  const volumes = t.volumes.length > 0 ? t.volumes : [{}];
  for (const v of volumes as DanfeNfe['transport']['volumes']) {
    y = w.row(y, [
      ['Quantidade', v.quantity ?? '', 2.92, 'right'],
      ['Espécie', v.species ?? '', 3.05],
      ['Marca', v.brand ?? '', 3.05],
      ['Numeração', v.numbering ?? '', 4.83],
      ['Peso bruto', v.grossKg ? decimalBR(v.grossKg, 3) : '', 3.43, 'right'],
      ['Peso líquido', v.netKg ? decimalBR(v.netKg, 3) : '', 3.3, 'right'],
    ]);
  }
  return y;
}

function additionalLines(
  w: Writer,
  nfe: DanfeNfe,
  width: number,
  options: DanfeLayoutOptions,
): string[] {
  const texts = [
    nfe.environment === 'homologacao' ? HOMOLOGACAO : '',
    options.preview && !nfe.protocol
      ? 'PRÉVIA SEM VALOR FISCAL: A NOTA AINDA NÃO FOI AUTORIZADA PELA SEFAZ.'
      : '',
    nfe.fiscalInfo ? `Inf. fisco: ${nfe.fiscalInfo}` : '',
    nfe.additionalInfo ?? '',
  ].filter(Boolean);
  return texts.flatMap((text) => w.wrap(text, width - 6, FONT.additional));
}

// ------------------------------------------------------------------ folhas

const ADDITIONAL_H = cm(3.07);
const LINE_H = FONT.additional + 1.5;

export function layoutDanfeNfe(
  nfe: DanfeNfe,
  measure: Measure,
  options: DanfeLayoutOptions = {},
): DanfePage[] {
  if (!nfe.protocol && !options.preview) {
    throw new DanfeLayoutError('O DANFE só sai depois da autorização: o XML não traz o protocolo.');
  }
  // Primeira passada só para medir quantas folhas a nota ocupa; a segunda desenha com o total.
  const draft = paginate(nfe, measure, options, 1);
  return paginate(nfe, measure, options, draft.length);
}

function paginate(
  nfe: DanfeNfe,
  measure: Measure,
  options: DanfeLayoutOptions,
  totalPages: number,
): DanfePage[] {
  const pages: DanfePage[] = [];
  const probe = new Writer(measure);
  const blocks = itemBlocks(probe, nfe.items);
  const infoWidth = cm(12.95);
  let info = additionalLines(probe, nfe, infoWidth, options);

  // Primeira folha.
  let w = new Writer(measure);
  let y = canhoto(w, nfe);
  y = header(w, nfe, 1, totalPages, options, y);
  y = recipient(w, nfe, y);
  y = duplicates(w, nfe, y);
  y = taxes(w, nfe, y);
  y = transport(w, nfe, y);
  y = w.title(y, 'Dados dos produtos / serviços');
  y = productHeader(w, y);
  const additionalTop = BOTTOM - TITLE_H - ADDITIONAL_H;
  if (y > additionalTop - PRODUCT_LINE * 2)
    throw new DanfeLayoutError('Os quadros da nota não cabem na primeira folha.');
  let index = 0;
  const tableTop = y;
  while (index < blocks.length && y + blocks[index]!.height <= additionalTop) {
    blocks[index]!.draw(w, y);
    y += blocks[index]!.height;
    index++;
  }
  w.rect(LEFT, tableTop, WIDTH, additionalTop - tableTop);

  // Dados adicionais: informações complementares e reservado ao fisco.
  const ay = w.title(additionalTop, 'Dados adicionais');
  w.rect(LEFT, ay, infoWidth, ADDITIONAL_H);
  w.text(LEFT + 2, ay + FONT.label + 1, 'INFORMAÇÕES COMPLEMENTARES', FONT.label);
  w.rect(LEFT + infoWidth, ay, WIDTH - infoWidth, ADDITIONAL_H);
  w.text(LEFT + infoWidth + 2, ay + FONT.label + 1, 'RESERVADO AO FISCO', FONT.label);
  const fit = Math.floor((ADDITIONAL_H - FONT.label - 6) / LINE_H);
  const shown = info.length > fit ? info.slice(0, fit - 1) : info;
  shown.forEach((line, n) =>
    w.text(LEFT + 3, ay + FONT.label + 4 + (n + 1) * LINE_H, line, FONT.additional),
  );
  if (info.length > fit)
    w.text(
      LEFT + 3,
      ay + FONT.label + 4 + fit * LINE_H,
      'CONTINUA NA PRÓXIMA FOLHA',
      FONT.additional,
      { bold: true },
    );
  info = info.slice(shown.length);
  watermark(w, nfe, options);
  pages.push({ ops: w.ops });

  // Folhas adicionais: cabeçalho, os itens que faltaram e o resto das informações complementares.
  while (index < blocks.length || info.length > 0) {
    w = new Writer(measure);
    y = header(w, nfe, pages.length + 1, totalPages, options, cm(0.42));
    if (index < blocks.length) {
      y = w.title(y, 'Dados dos produtos / serviços');
      y = productHeader(w, y);
      const top = y;
      while (index < blocks.length && y + blocks[index]!.height <= BOTTOM) {
        blocks[index]!.draw(w, y);
        y += blocks[index]!.height;
        index++;
      }
      w.rect(LEFT, top, WIDTH, y - top);
    }
    if (info.length > 0 && index >= blocks.length) {
      y = w.title(y + 4, 'Dados adicionais (continuação)');
      const room = Math.floor((BOTTOM - y - FONT.label - 6) / LINE_H);
      const part = info.slice(0, room);
      w.rect(LEFT, y, WIDTH, FONT.label + 8 + part.length * LINE_H);
      w.text(LEFT + 2, y + FONT.label + 1, 'INFORMAÇÕES COMPLEMENTARES', FONT.label);
      part.forEach((line, n) =>
        w.text(LEFT + 3, y + FONT.label + 4 + (n + 1) * LINE_H, line, FONT.additional),
      );
      info = info.slice(part.length);
    }
    watermark(w, nfe, options);
    pages.push({ ops: w.ops });
    if (pages.length > 500) throw new DanfeLayoutError('A nota passou de 500 folhas.');
  }
  return pages;
}

function watermark(w: Writer, nfe: DanfeNfe, options: DanfeLayoutOptions) {
  // Vai antes dos outros desenhos, para ficar por baixo do texto.
  if (nfe.environment === 'homologacao')
    w.ops.unshift({ kind: 'watermark', text: 'SEM VALOR FISCAL' });
  else if (options.preview && !nfe.protocol) w.ops.unshift({ kind: 'watermark', text: 'PRÉVIA' });
}
