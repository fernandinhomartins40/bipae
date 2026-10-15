import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { uuidv7 } from '@bipae/domain';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { products, sales, stockLotMoves, stockLots, stockMovements, stores } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');

export const lotInput = z.object({
  storeId: z.string().uuid('Escolha a loja'),
  productId: z.string().uuid('Escolha o produto'),
  lotCode: z.string().trim().min(1, 'Informe o lote').max(40),
  expiresOn: isoDay.nullable().default(null),
  manufacturedOn: isoDay.nullable().default(null),
  quantityMilli: z.number().int().positive('Quantidade inválida'),
  /** true: mercadoria nova (soma no estoque); false: só identifica o estoque que já existe. */
  addsStock: z.boolean().default(false),
});

export const lotDiscardInput = z.object({
  quantityMilli: z.number().int().positive('Quantidade inválida'),
  reason: z.string().trim().min(3, 'Diga o motivo do descarte').max(200),
});

export interface LotRow {
  id: string;
  expiresOn: string | null;
  createdAt: Date;
  quantityMilli: number;
}

/**
 * Ordem de saída (FEFO): primeiro os lotes dentro da validade, do que vence antes; depois os
 * sem validade, do mais antigo; por último os vencidos, que só saem se não houver outro.
 */
export function fefoOrder<T extends LotRow>(lots: readonly T[], today: string): T[] {
  const group = (l: LotRow) => (l.expiresOn === null ? 1 : l.expiresOn >= today ? 0 : 2);
  return [...lots].sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.expiresOn ?? '').localeCompare(b.expiresOn ?? '') ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** Quanto sai de cada lote para atender `need`; o que faltar fica sem lote. */
export function allocateFefo(
  lots: readonly LotRow[],
  need: number,
  today: string,
): { taken: { lotId: string; milli: number }[]; missingMilli: number } {
  const taken: { lotId: string; milli: number }[] = [];
  let rest = need;
  for (const lot of fefoOrder(lots, today)) {
    if (rest === 0) break;
    const milli = Math.min(rest, lot.quantityMilli);
    if (milli <= 0) continue;
    taken.push({ lotId: lot.id, milli });
    rest -= milli;
  }
  return { taken, missingMilli: rest };
}

const todayInBrazil = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Lote e validade (F5-04). A venda baixa pelo lote que vence primeiro e cada movimento guarda a
 * venda, para o recall; cancelamento e devolução voltam aos lotes de onde a venda tirou.
 */
@Injectable()
export class LotsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Chamado pelo movimento de estoque da venda, na mesma transação. */
  async applySale(
    tx: Tx,
    ctx: RequestContext,
    input: {
      storeId: string;
      reason: 'sale' | 'sale_cancelled' | 'return';
      saleId: string;
      refId: string;
      at: Date;
      deltas: [productId: string, deltaMilli: number][];
    },
  ) {
    const ids = [...new Set(input.deltas.map(([id]) => id))];
    if (ids.length === 0) return;
    const tracked = new Set(
      (
        await tx
          .select({ id: products.id })
          .from(products)
          .where(and(inArray(products.id, ids), eq(products.tracksLot, true)))
      ).map((p) => p.id),
    );
    if (tracked.size === 0) return;
    const day = input.at.toISOString().slice(0, 10);
    for (const [productId, delta] of input.deltas) {
      if (!tracked.has(productId) || delta === 0) continue;
      if (input.reason === 'sale' && delta < 0) {
        const lots = await tx
          .select()
          .from(stockLots)
          .where(
            and(
              eq(stockLots.storeId, input.storeId),
              eq(stockLots.productId, productId),
              gt(stockLots.quantityMilli, 0),
            ),
          );
        const { taken } = allocateFefo(lots, -delta, day);
        for (const t of taken) await this.move(tx, ctx, t.lotId, -t.milli, input);
      } else if (delta > 0) {
        // Volta aos lotes que esta venda levou, começando pelo último que saiu.
        const net = await tx
          .select({
            lotId: stockLotMoves.lotId,
            expiresOn: stockLots.expiresOn,
            consumed: sql<string>`(-sum(${stockLotMoves.deltaMilli}))::text`,
          })
          .from(stockLotMoves)
          .innerJoin(stockLots, eq(stockLots.id, stockLotMoves.lotId))
          .where(and(eq(stockLotMoves.saleId, input.saleId), eq(stockLots.productId, productId)))
          .groupBy(stockLotMoves.lotId, stockLots.expiresOn);
        let rest = delta;
        const order = net.sort((a, b) => (b.expiresOn ?? '').localeCompare(a.expiresOn ?? ''));
        for (const n of order) {
          if (rest === 0) break;
          const milli = Math.min(rest, Number(n.consumed));
          if (milli <= 0) continue;
          await this.move(tx, ctx, n.lotId, milli, input);
          rest -= milli;
        }
      }
    }
  }

  private async move(
    tx: Tx,
    ctx: RequestContext,
    lotId: string,
    deltaMilli: number,
    m: {
      reason: 'entry' | 'purchase' | 'sale' | 'sale_cancelled' | 'return' | 'discard';
      saleId?: string | null;
      refId?: string | null;
      at: Date;
    },
  ) {
    await tx
      .update(stockLots)
      .set({
        quantityMilli: sql`${stockLots.quantityMilli} + ${deltaMilli}`,
        updatedAt: new Date(),
      })
      .where(eq(stockLots.id, lotId));
    await tx.insert(stockLotMoves).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      lotId,
      deltaMilli,
      reason: m.reason,
      saleId: m.saleId ?? null,
      refId: m.refId ?? null,
      actorId: ctx.userId,
      occurredAt: m.at,
    });
  }

  /**
   * Entrada de lote: soma ao lote (cria se for novo). Com `addsStock`, é mercadoria nova e
   * também entra no estoque; sem, só identifica o estoque que já existe.
   */
  async register(
    ctx: RequestContext,
    input: z.output<typeof lotInput>,
    tx?: Tx,
    reason: 'entry' | 'purchase' = 'entry',
    refId: string | null = null,
  ) {
    assertStore(ctx, input.storeId);
    const run = async (t: Tx) => {
      const [product] = await t
        .select({
          id: products.id,
          name: products.name,
          tracksLot: products.tracksLot,
          weighable: products.isWeighable,
        })
        .from(products)
        .where(eq(products.id, input.productId));
      if (!product) throw notFound('Produto');
      if (!product.tracksLot) {
        throw new AppError(
          422,
          'lot_not_tracked',
          `Ative "controla lote e validade" no cadastro de ${product.name} antes de informar o lote.`,
        );
      }
      // Na compra, a quantidade do lote vem do fornecedor e pode ser fracionada pelo fator.
      if (reason === 'entry' && !product.weighable && input.quantityMilli % 1000 !== 0) {
        throw new AppError(
          422,
          'invalid_quantity',
          `${product.name} é contado por unidade inteira.`,
        );
      }
      const [store] = await t
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const lookup = async (code: string) =>
        (
          await t
            .select()
            .from(stockLots)
            .where(
              and(
                eq(stockLots.storeId, input.storeId),
                eq(stockLots.productId, input.productId),
                eq(stockLots.lotCode, code),
              ),
            )
        )[0];
      let lotCode = input.lotCode;
      let existing = await lookup(lotCode);
      if (
        existing &&
        existing.expiresOn &&
        input.expiresOn &&
        existing.expiresOn !== input.expiresOn
      ) {
        if (reason === 'entry') {
          throw new AppError(
            409,
            'lot_expiry_mismatch',
            `O lote ${input.lotCode} já está cadastrado com outra validade.`,
          );
        }
        // Na nota de compra não trava a entrada: o lote fica separado, com a validade no nome.
        lotCode = `${input.lotCode} (val. ${input.expiresOn.split('-').reverse().join('/')})`;
        existing = await lookup(lotCode);
      }
      const lotId = existing?.id ?? uuidv7();
      if (!existing) {
        await t.insert(stockLots).values({
          id: lotId,
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          productId: input.productId,
          lotCode,
          expiresOn: input.expiresOn,
          manufacturedOn: input.manufacturedOn,
        });
      } else if (!existing.expiresOn && input.expiresOn) {
        await t
          .update(stockLots)
          .set({ expiresOn: input.expiresOn })
          .where(eq(stockLots.id, lotId));
      }
      const at = new Date();
      await this.move(t, ctx, lotId, input.quantityMilli, { reason, refId, at });
      if (input.addsStock) {
        await t.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          productId: input.productId,
          deltaMilli: input.quantityMilli,
          reason: 'adjustment',
          refId: lotId,
          note: `Entrada do lote ${input.lotCode}`,
          actorId: ctx.userId,
          occurredAt: at,
        });
      }
      if (reason === 'entry') {
        await this.audit.record(t, ctx, {
          action: 'stock.lot_registered',
          entity: 'stock_lot',
          entityId: lotId,
          data: input,
        });
      }
      return this.view(t, lotId);
    };
    return tx ? run(tx) : withTenant(this.db, ctx, run);
  }

  /** Descarte (vencido, avariado): sai do lote e do estoque, com motivo na auditoria. */
  async discard(ctx: RequestContext, lotId: string, input: z.output<typeof lotDiscardInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId));
      if (!lot) throw notFound('Lote');
      assertStore(ctx, lot.storeId);
      if (input.quantityMilli > lot.quantityMilli) {
        throw new AppError(422, 'invalid_quantity', 'O lote não tem tudo isso em estoque.');
      }
      const at = new Date();
      await this.move(tx, ctx, lotId, -input.quantityMilli, { reason: 'discard', refId: null, at });
      await tx.insert(stockMovements).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        storeId: lot.storeId,
        productId: lot.productId,
        deltaMilli: -input.quantityMilli,
        reason: 'adjustment',
        refId: lotId,
        note: `Descarte do lote ${lot.lotCode}: ${input.reason}`,
        actorId: ctx.userId,
        occurredAt: at,
      });
      await this.audit.record(tx, ctx, {
        action: 'stock.lot_discarded',
        entity: 'stock_lot',
        entityId: lotId,
        data: { lotCode: lot.lotCode, quantityMilli: input.quantityMilli, reason: input.reason },
      });
      return this.view(tx, lotId);
    });
  }

  private async view(tx: Tx, lotId: string) {
    const [row] = await tx
      .select({
        lot: stockLots,
        productName: products.name,
        unit: products.unit,
        storeName: stores.name,
      })
      .from(stockLots)
      .innerJoin(products, eq(products.id, stockLots.productId))
      .innerJoin(stores, eq(stores.id, stockLots.storeId))
      .where(eq(stockLots.id, lotId));
    if (!row) throw notFound('Lote');
    return {
      id: row.lot.id,
      storeId: row.lot.storeId,
      storeName: row.storeName,
      productId: row.lot.productId,
      productName: row.productName,
      unit: row.unit,
      lotCode: row.lot.lotCode,
      expiresOn: row.lot.expiresOn,
      manufacturedOn: row.lot.manufacturedOn,
      quantityMilli: row.lot.quantityMilli,
    };
  }

  /** Lotes com saldo; por produto, ou os que vencem em até `days` dias (vencidos incluídos). */
  async list(ctx: RequestContext, q: { productId?: string; days?: number }) {
    return withTenant(this.db, ctx, async (tx) => {
      const today = todayInBrazil();
      const rows = await tx
        .select({
          lot: stockLots,
          productName: products.name,
          unit: products.unit,
          storeName: stores.name,
        })
        .from(stockLots)
        .innerJoin(products, eq(products.id, stockLots.productId))
        .innerJoin(stores, eq(stores.id, stockLots.storeId))
        .where(
          and(
            gt(stockLots.quantityMilli, 0),
            storeCondition(ctx, stockLots.storeId),
            q.productId ? eq(stockLots.productId, q.productId) : undefined,
            q.days !== undefined
              ? sql`${stockLots.expiresOn} is not null and ${stockLots.expiresOn} <= ${addDays(today, q.days)}`
              : undefined,
          ),
        )
        .orderBy(sql`${stockLots.expiresOn} asc nulls last`, asc(stockLots.createdAt))
        .limit(500);
      return rows.map(({ lot, productName, unit, storeName }) => ({
        id: lot.id,
        storeId: lot.storeId,
        storeName,
        productId: lot.productId,
        productName,
        unit,
        lotCode: lot.lotCode,
        expiresOn: lot.expiresOn,
        manufacturedOn: lot.manufacturedOn,
        quantityMilli: lot.quantityMilli,
        /** Dias até vencer (negativo = vencido); null sem validade. */
        daysLeft:
          lot.expiresOn === null
            ? null
            : Math.round(
                (Date.parse(`${lot.expiresOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
                  86_400_000,
              ),
      }));
    });
  }

  /** Recall: as vendas que levaram unidades do lote, com a quantidade líquida de cada uma. */
  async trace(ctx: RequestContext, lotId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId));
      if (!lot) throw notFound('Lote');
      assertStore(ctx, lot.storeId);
      const rows = await tx
        .select({
          saleId: stockLotMoves.saleId,
          milli: sql<string>`(-sum(${stockLotMoves.deltaMilli}))::text`,
          customerTaxId: sql<string | null>`max(${sales.customerTaxId})`,
          occurredAt: sql<string>`min(${sales.occurredAt})::text`,
          terminalSeq: sql<number>`max(${sales.terminalSeq})`,
        })
        .from(stockLotMoves)
        .innerJoin(sales, eq(sales.id, stockLotMoves.saleId))
        .where(eq(stockLotMoves.lotId, lotId))
        .groupBy(stockLotMoves.saleId);
      return rows
        .map((r) => ({
          saleId: r.saleId!,
          quantityMilli: Number(r.milli),
          customerTaxId: r.customerTaxId,
          occurredAt: new Date(r.occurredAt).toISOString(),
          terminalSeq: r.terminalSeq,
        }))
        .filter((r) => r.quantityMilli > 0);
    });
  }
}

@Controller('stock/lots')
export class LotsController {
  constructor(@Inject(LotsService) private readonly lots: LotsService) {}

  /** ?productId= (lotes do produto) ou ?days=30 (vencendo em até 30 dias e vencidos). */
  @Get()
  @RequirePermission('catalog.read')
  list(
    @Ctx() ctx: RequestContext,
    @Query('productId') productId?: string,
    @Query('days') days?: string,
  ) {
    if (productId && !/^[0-9a-f-]{36}$/i.test(productId)) {
      throw new AppError(422, 'invalid_product', 'Produto inválido.');
    }
    const n = days === undefined ? undefined : Number(days);
    if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 3650)) {
      throw new AppError(422, 'invalid_days', 'Número de dias inválido.');
    }
    return this.lots.list(ctx, {
      ...(productId && { productId }),
      ...(n !== undefined && { days: n }),
    });
  }

  @Get(':id/sales')
  @RequirePermission('catalog.read')
  trace(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.lots.trace(ctx, id);
  }

  @Post()
  @RequirePermission('catalog.write')
  register(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.lots.register(ctx, parse(lotInput, body));
  }

  @Post(':id/discard')
  @RequirePermission('catalog.write')
  discard(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.lots.discard(ctx, id, parse(lotDiscardInput, body));
  }
}
