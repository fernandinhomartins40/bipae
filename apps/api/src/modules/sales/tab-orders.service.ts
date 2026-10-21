import { Body, Controller, Get, Inject, Injectable, Post, Query } from '@nestjs/common';
import { tabOrderInput, uuidv7, type TabOrderForTerminal, type TabOrderView } from '@bipae/domain';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { products, sellers, stores, tabOrders, terminals, users } from '../../db/schema';

/** Pedido pego por um caixa que não respondeu nesse tempo volta para a fila. */
const CLAIM_TIMEOUT_MS = 2 * 60_000;

/**
 * Pedidos do garçom (F5-08). O celular manda o pedido da mesa; um caixa da loja o pega na
 * sincronização seguinte e junta à comanda, porque a comanda vive no caixa (sem internet). O
 * caixa responde com tab.order_received. O celular precisa de internet; o caixa, não.
 */
@Injectable()
export class TabOrdersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(ctx: RequestContext, body: unknown): Promise<TabOrderView> {
    const input = parse(tabOrderInput, body);
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const found = await tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(and(inArray(products.id, ids), eq(products.active, true)));
      if (found.length !== ids.length) {
        throw new AppError(422, 'unknown_product', 'Um dos produtos não existe ou está inativo.');
      }
      const [waiter] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.userId));
      // Quem lança e é vendedor (F8-03) leva a comissão dos itens do pedido.
      const [seller] = await tx
        .select({ id: sellers.id })
        .from(sellers)
        .where(and(eq(sellers.userId, ctx.userId), eq(sellers.active, true)));
      const [row] = await tx
        .insert(tabOrders)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          label: input.label.trim(),
          items: input.items,
          waiterId: ctx.userId,
          waiterName: waiter?.name ?? 'Garçom',
          sellerId: seller?.id ?? null,
        })
        .returning();
      return this.view(row!, new Map(found.map((p) => [p.id, p.name])));
    });
  }

  private view(
    row: typeof tabOrders.$inferSelect,
    names: ReadonlyMap<string, string>,
  ): TabOrderView {
    return {
      id: row.id,
      storeId: row.storeId,
      label: row.label,
      items: row.items.map((i) => ({ ...i, name: names.get(i.productId) ?? 'Produto' })),
      waiterName: row.waiterName,
      status: row.status,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      receivedAt: row.receivedAt?.toISOString() ?? null,
    };
  }

  /** Os pedidos de hoje da loja (o garçom acompanha se o caixa recebeu). */
  async list(ctx: RequestContext, storeId?: string): Promise<TabOrderView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(tabOrders)
        .where(
          and(
            storeId ? eq(tabOrders.storeId, storeId) : undefined,
            storeCondition(ctx, tabOrders.storeId),
            gte(tabOrders.createdAt, sql`now() - interval '12 hours'`),
          ),
        )
        .orderBy(desc(tabOrders.createdAt))
        .limit(100);
      const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.productId)))];
      const names = new Map(
        (ids.length
          ? await tx
              .select({ id: products.id, name: products.name })
              .from(products)
              .where(inArray(products.id, ids))
          : []
        ).map((p) => [p.id, p.name]),
      );
      return rows.map((r) => this.view(r, names));
    });
  }

  /**
   * Na sincronização do caixa: pega os pedidos pendentes da loja dele (os sem dono, e os de um
   * caixa que pegou e não respondeu) e devolve os que são deste caixa.
   */
  async forTerminal(tx: Tx, terminalId: string | null): Promise<TabOrderForTerminal[]> {
    if (!terminalId) return [];
    const [terminal] = await tx
      .select({ storeId: terminals.storeId })
      .from(terminals)
      .where(eq(terminals.id, terminalId));
    if (!terminal) return [];
    const now = new Date();
    await tx
      .update(tabOrders)
      .set({ claimedBy: terminalId, claimedAt: now })
      .where(
        and(
          eq(tabOrders.storeId, terminal.storeId),
          eq(tabOrders.status, 'pending'),
          or(
            isNull(tabOrders.claimedBy),
            lt(tabOrders.claimedAt, new Date(now.getTime() - CLAIM_TIMEOUT_MS)),
          ),
        ),
      );
    const mine = await tx
      .select()
      .from(tabOrders)
      .where(and(eq(tabOrders.claimedBy, terminalId), eq(tabOrders.status, 'pending')))
      .orderBy(tabOrders.createdAt)
      .limit(50);
    return mine.map((o) => ({
      id: o.id,
      label: o.label,
      items: o.items,
      waiterName: o.waiterName,
      sellerId: o.sellerId,
    }));
  }

  /** O caixa juntou à comanda (ou não conseguiu). */
  async received(
    tx: Tx,
    payload: { orderId: string; tabId: string | null; rejected: string | null },
    at: Date,
  ) {
    await tx
      .update(tabOrders)
      .set(
        payload.rejected
          ? { status: 'rejected', reason: payload.rejected, receivedAt: at }
          : { status: 'received', tabId: payload.tabId, receivedAt: at },
      )
      .where(and(eq(tabOrders.id, payload.orderId), eq(tabOrders.status, 'pending')));
  }
}

@Controller('tabs/orders')
export class TabOrdersController {
  constructor(@Inject(TabOrdersService) private readonly orders: TabOrdersService) {}

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.orders.create(ctx, body);
  }

  @Get()
  @RequirePermission('pos.sell')
  list(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string) {
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return this.orders.list(ctx, storeId);
  }
}
