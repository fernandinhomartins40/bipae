import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@bipae/domain';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { assertStore, canUseStore, storeCondition } from '../../common/stores';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import {
  companies,
  products,
  saleItems,
  salePayments,
  sales,
  stockMovements,
  stores,
  terminals,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

export const stockAdjustmentInput = z.object({
  productId: z.string().uuid(),
  storeId: z.string().uuid(),
  /** 'adjustment' adds a delta; 'count' sets the counted quantity (inventory). */
  mode: z.enum(['adjustment', 'count']),
  quantityMilli: z.number().int(),
  note: z.string().trim().max(200).optional(),
});

@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, limit: number, offset: number) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          id: sales.id,
          kind: sales.kind,
          status: sales.status,
          terminalSeq: sales.terminalSeq,
          terminalName: terminals.name,
          totalCents: sales.totalCents,
          discountCents: sales.discountCents,
          customerTaxId: sales.customerTaxId,
          occurredAt: sales.occurredAt,
        })
        .from(sales)
        .innerJoin(terminals, eq(terminals.id, sales.terminalId))
        .where(storeCondition(ctx, sales.storeId))
        .orderBy(desc(sales.occurredAt))
        .limit(limit)
        .offset(offset);
      const [total] = await tx
        .select({ n: count() })
        .from(sales)
        .where(storeCondition(ctx, sales.storeId));
      const payments = rows.length
        ? await tx
            .select()
            .from(salePayments)
            .where(
              inArray(
                salePayments.saleId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      return {
        items: rows.map((r) => ({
          ...r,
          occurredAt: r.occurredAt.toISOString(),
          methods: [...new Set(payments.filter((p) => p.saleId === r.id).map((p) => p.method))],
        })),
        total: total?.n ?? 0,
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, id));
      // Venda de outra loja: para quem não tem acesso, é como se não existisse.
      if (!sale || !canUseStore(ctx, sale.storeId)) throw notFound('Venda');
      const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
      const payments = await tx.select().from(salePayments).where(eq(salePayments.saleId, id));
      return { ...sale, items, payments };
    });
  }

  /** Stock balance per product and store (sum of the ledger). */
  async balances(ctx: RequestContext, productIds?: string[]) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          productId: stockMovements.productId,
          storeId: stockMovements.storeId,
          quantityMilli: sql<number>`sum(${stockMovements.deltaMilli})`,
        })
        .from(stockMovements)
        .where(
          and(
            productIds?.length ? inArray(stockMovements.productId, productIds) : undefined,
            storeCondition(ctx, stockMovements.storeId),
          ),
        )
        .groupBy(stockMovements.productId, stockMovements.storeId);
      return rows.map((r) => ({ ...r, quantityMilli: Number(r.quantityMilli) }));
    });
  }

  async adjust(ctx: RequestContext, input: z.output<typeof stockAdjustmentInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [product] = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(eq(products.id, input.productId));
      if (!product) throw notFound('Produto');
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      assertStore(ctx, input.storeId);
      const [current] = await tx
        .select({ q: sql<number>`coalesce(sum(${stockMovements.deltaMilli}), 0)` })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.productId, input.productId),
            eq(stockMovements.storeId, input.storeId),
          ),
        );
      const balance = Number(current?.q ?? 0);
      const delta = input.mode === 'count' ? input.quantityMilli - balance : input.quantityMilli;
      if (input.mode === 'count' && input.quantityMilli < 0) {
        throw new AppError(400, 'validation', 'A quantidade contada não pode ser negativa.');
      }
      if (delta === 0)
        return { productId: input.productId, storeId: input.storeId, quantityMilli: balance };
      await tx.insert(stockMovements).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        storeId: input.storeId,
        productId: input.productId,
        deltaMilli: delta,
        reason: input.mode,
        note: input.note ?? null,
        actorId: ctx.userId,
        occurredAt: new Date(),
      });
      await this.audit.record(tx, ctx, {
        action: input.mode === 'count' ? 'stock.counted' : 'stock.adjusted',
        entity: 'product',
        entityId: input.productId,
        data: { before: balance, after: balance + delta, note: input.note },
      });
      return { productId: input.productId, storeId: input.storeId, quantityMilli: balance + delta };
    });
  }

  /** What a register needs to print receipts and label itself. */
  async terminalContext(ctx: RequestContext, terminalId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          terminal: terminals,
          storeName: stores.name,
          companyName: companies.legalName,
          tradeName: companies.tradeName,
          companyTaxId: companies.taxId,
        })
        .from(terminals)
        .innerJoin(stores, eq(stores.id, terminals.storeId))
        .innerJoin(companies, eq(companies.id, terminals.companyId))
        .where(eq(terminals.id, terminalId));
      if (!row) throw notFound('Caixa');
      assertStore(ctx, row.terminal.storeId);
      // Último número de venda já recebido deste caixa (F3-12): um aparelho novo ligado a este caixa
      // continua daqui, em vez de recomeçar em 1 e repetir números (venda e NFC-e).
      const [last] = await tx
        .select({ seq: sql<number>`coalesce(max(${sales.terminalSeq}), 0)` })
        .from(sales)
        .where(eq(sales.terminalId, terminalId));
      return {
        terminal: {
          id: row.terminal.id,
          name: row.terminal.name,
          platform: row.terminal.platform,
          nfceSeries: row.terminal.nfceSeries,
          status: row.terminal.status,
          storeId: row.terminal.storeId,
        },
        storeName: row.storeName,
        businessName: row.tradeName ?? row.companyName,
        taxId: row.companyTaxId,
        lastTerminalSeq: Number(last?.seq ?? 0),
      };
    });
  }

  async activeTerminals(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          id: terminals.id,
          name: terminals.name,
          platform: terminals.platform,
          nfceSeries: terminals.nfceSeries,
          storeId: terminals.storeId,
        })
        .from(terminals)
        .where(and(eq(terminals.status, 'active'), storeCondition(ctx, terminals.storeId)))
        .orderBy(terminals.nfceSeries),
    );
  }
}
