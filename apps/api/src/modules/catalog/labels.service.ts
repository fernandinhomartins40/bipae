import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Injectable,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { cents, formatBRL, labelsInput } from '@bipae/domain';
import { buildScaleLabelCode, eanModules, weighedTotalCents } from '@bipae/pdv-core/pure';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import { priceTableItems, productBarcodes, products, stores } from '../../db/schema';

type Input = z.output<typeof labelsInput>;

/** Uma etiqueta pronta para desenhar. */
export interface LabelData {
  name: string;
  /** Linha grande: o preço (gôndola) ou o total (balança). */
  price: string;
  /** Linhas pequenas: unidade, peso, preço do quilo, data. */
  details: string[];
  code: string | null;
}

const brl = (v: number) => formatBRL(cents(v));
const winAnsi = (text: string) =>
  text.replace(/[−–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const today = () =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Folha A4 de etiquetas adesivas: 3 colunas × 8 linhas.
const PAGE = { width: 595.28, height: 841.89, margin: 20, cols: 3, rows: 8 };

/** Corta o texto com reticências para caber na largura. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = winAnsi(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function drawBars(page: PDFPage, modules: string, x: number, y: number, module: number, h: number) {
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let run = 1;
      while (modules[i + run] === '1') run++;
      page.drawRectangle({
        x: x + i * module,
        y,
        width: run * module,
        height: h,
        color: rgb(0, 0, 0),
      });
      i += run;
    } else i++;
  }
}

/** PDF com as etiquetas em folha A4 (3 × 8), cada uma com nome, preço e código de barras. */
export async function labelsPdf(labels: LabelData[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Etiquetas Bipaê');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const w = (PAGE.width - PAGE.margin * 2) / PAGE.cols;
  const h = (PAGE.height - PAGE.margin * 2) / PAGE.rows;
  const perPage = PAGE.cols * PAGE.rows;
  let page: PDFPage | null = null;
  labels.forEach((label, index) => {
    if (index % perPage === 0) page = pdf.addPage([PAGE.width, PAGE.height]);
    const p = page!;
    const slot = index % perPage;
    const x = PAGE.margin + (slot % PAGE.cols) * w;
    const top = PAGE.height - PAGE.margin - Math.floor(slot / PAGE.cols) * h;
    const pad = 8;
    const inner = w - pad * 2;
    p.drawRectangle({
      x: x + 2,
      y: top - h + 2,
      width: w - 4,
      height: h - 4,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 0.5,
    });
    p.drawText(fit(label.name, bold, 10, inner), { x: x + pad, y: top - 16, size: 10, font: bold });
    p.drawText(winAnsi(label.price), { x: x + pad, y: top - 40, size: 20, font: bold });
    // Barras no canto de baixo à direita; os detalhes ficam à esquerda delas, sem encostar.
    const modules = label.code ? eanModules(label.code) : null;
    const module = 0.85;
    const barsWidth = modules ? modules.length * module : 0;
    const detailsWidth = modules ? inner - barsWidth - 6 : inner;
    label.details.forEach((line, i) =>
      p.drawText(fit(line, font, 7, detailsWidth), {
        x: x + pad,
        y: top - 52 - i * 8,
        size: 7,
        font,
      }),
    );
    if (modules && label.code) {
      const bx = x + w - pad - barsWidth;
      drawBars(p, modules, bx, top - h + 16, module, 24);
      p.drawText(label.code, { x: bx, y: top - h + 8, size: 6.5, font });
    } else if (label.code) {
      p.drawText(winAnsi(label.code), { x: x + pad, y: top - h + 10, size: 7, font });
    }
  });
  return Buffer.from(await pdf.save());
}

/** Etiquetas de gôndola e de balança (F5-01), em PDF para imprimir em folha adesiva. */
@Injectable()
export class LabelsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async build(ctx: RequestContext, input: Input): Promise<LabelData[]> {
    if (input.storeId) assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const rows = await tx.select().from(products).where(inArray(products.id, ids));
      const codes = await tx
        .select({ productId: productBarcodes.productId, code: productBarcodes.code })
        .from(productBarcodes)
        .where(inArray(productBarcodes.productId, ids));
      let tablePrices = new Map<string, number>();
      if (input.storeId) {
        const [store] = await tx
          .select({ priceTableId: stores.priceTableId })
          .from(stores)
          .where(eq(stores.id, input.storeId));
        if (!store) throw notFound('Loja');
        if (store.priceTableId) {
          const items = await tx
            .select({
              productId: priceTableItems.productId,
              priceCents: priceTableItems.priceCents,
            })
            .from(priceTableItems)
            .where(
              and(
                eq(priceTableItems.priceTableId, store.priceTableId),
                inArray(priceTableItems.productId, ids),
              ),
            );
          tablePrices = new Map(items.map((i) => [i.productId, i.priceCents]));
        }
      }
      const date = today();
      const labels: LabelData[] = [];
      for (const item of input.items) {
        const product = rows.find((r) => r.id === item.productId);
        if (!product) throw notFound('Produto');
        const price = tablePrices.get(product.id) ?? product.priceCents;
        let label: LabelData;
        if (input.kind === 'shelf') {
          label = {
            name: product.name,
            price: brl(price),
            details: [
              product.unit === 'UN' ? 'Preço por unidade' : `Preço por ${product.unit}`,
              `Preço de ${date}`,
            ],
            code:
              codes.find((c) => c.productId === product.id && eanModules(c.code))?.code ??
              codes.find((c) => c.productId === product.id)?.code ??
              null,
          };
        } else {
          if (!product.isWeighable) {
            throw new AppError(
              422,
              'not_weighable',
              `${product.name} não é vendido por peso: use a etiqueta de gôndola.`,
            );
          }
          if (!product.sku) {
            throw new AppError(
              422,
              'missing_plu',
              `${product.name} precisa de um código interno (só números) para ir na etiqueta da balança.`,
            );
          }
          const grams = item.grams!;
          const total = weighedTotalCents(grams, price);
          let code: string;
          try {
            code = buildScaleLabelCode({ plu: product.sku, totalCents: total });
          } catch (error) {
            throw new AppError(
              422,
              'invalid_scale_label',
              `${product.name}: ${(error as Error).message}`,
            );
          }
          label = {
            name: product.name,
            price: brl(total),
            details: [
              `Peso: ${(grams / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg`,
              `Preço do ${product.unit === 'KG' ? 'quilo' : product.unit}: ${brl(price)}`,
              `Embalado em ${date}`,
            ],
            code,
          };
        }
        for (let c = 0; c < item.copies; c++) labels.push(label);
      }
      if (labels.length > 1000) {
        throw new AppError(
          422,
          'too_many_labels',
          'São mais de 1.000 etiquetas: divida em partes.',
        );
      }
      return labels;
    });
  }
}

@Controller('labels')
export class LabelsController {
  constructor(@Inject(LabelsService) private readonly labels: LabelsService) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('catalog.read')
  async pdf(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(labelsInput, body);
    const data = await labelsPdf(await this.labels.build(ctx, input));
    reply.header('content-type', 'application/pdf');
    reply.header(
      'content-disposition',
      `attachment; filename="bipae-etiquetas-${input.kind === 'shelf' ? 'gondola' : 'balanca'}.pdf"`,
    );
    return new StreamableFile(data);
  }
}
