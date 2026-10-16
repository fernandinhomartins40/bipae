import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { uuidv7, type KitchenTicketView } from '@bipae/domain';
import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { kitchenTickets, products, tabs } from '../../db/schema';

type TabItem = (typeof tabs.$inferSelect)['items'][number];

const toView = (t: typeof kitchenTickets.$inferSelect): KitchenTicketView => ({
  id: t.id,
  storeId: t.storeId,
  tabId: t.tabId,
  tabLabel: t.tabLabel,
  line: t.line,
  productId: t.productId,
  name: t.name,
  quantityMilli: t.quantityMilli,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  readyAt: t.readyAt?.toISOString() ?? null,
  deliveredAt: t.deliveredAt?.toISOString() ?? null,
});

/**
 * Tela da cozinha (F5-09). A cada rodada da comanda (evento tab.updated), o que é novo nos
 * produtos "preparados na cozinha" vira pedido: o item novo inteiro, ou só a quantidade a mais.
 * Item que saiu da comanda cancela o pedido que ainda não ficou pronto.
 */
@Injectable()
export class KitchenService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Na transação do evento da comanda: compara a rodada anterior com a nova. */
  async onTabUpdated(tx: Tx, tab: typeof tabs.$inferSelect, next: TabItem[]): Promise<void> {
    const previous = new Map(tab.items.map((i) => [i.line, i]));
    const ids = [...new Set(next.map((i) => i.productId))];
    const kitchen = new Set(
      ids.length
        ? (
            await tx
              .select({ id: products.id })
              .from(products)
              .where(and(inArray(products.id, ids), eq(products.kitchen, true)))
          ).map((p) => p.id)
        : [],
    );
    const fresh = [];
    for (const item of next) {
      if (!kitchen.has(item.productId)) continue;
      const before = previous.get(item.line);
      const already = before && before.productId === item.productId ? before.quantityMilli : 0;
      const delta = item.quantityMilli - already;
      if (delta > 0) {
        fresh.push({
          id: uuidv7(),
          tenantId: tab.tenantId,
          storeId: tab.storeId,
          tabId: tab.id,
          tabLabel: tab.label,
          line: item.line,
          productId: item.productId,
          name: item.name,
          quantityMilli: delta,
        });
      }
    }
    if (fresh.length) await tx.insert(kitchenTickets).values(fresh);
    const removed = [...previous.keys()].filter((line) => !next.some((i) => i.line === line));
    if (removed.length) {
      await tx
        .update(kitchenTickets)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(kitchenTickets.tabId, tab.id),
            inArray(kitchenTickets.line, removed),
            eq(kitchenTickets.status, 'pending'),
          ),
        );
    }
  }

  /** Comanda cancelada: o que ainda não ficou pronto sai da fila. */
  async onTabCancelled(tx: Tx, tabId: string) {
    await tx
      .update(kitchenTickets)
      .set({ status: 'cancelled' })
      .where(and(eq(kitchenTickets.tabId, tabId), eq(kitchenTickets.status, 'pending')));
  }

  /** A fila: pendentes e prontos, e os entregues da última meia hora. */
  async queue(ctx: RequestContext, storeId?: string): Promise<KitchenTicketView[]> {
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select()
          .from(kitchenTickets)
          .where(
            and(
              storeId ? eq(kitchenTickets.storeId, storeId) : undefined,
              storeCondition(ctx, kitchenTickets.storeId),
              or(
                inArray(kitchenTickets.status, ['pending', 'ready']),
                and(
                  eq(kitchenTickets.status, 'delivered'),
                  gte(kitchenTickets.deliveredAt, sql`now() - interval '30 minutes'`),
                ),
              ),
            ),
          )
          .orderBy(asc(kitchenTickets.createdAt))
          .limit(500)
      ).map(toView),
    );
  }

  async advance(ctx: RequestContext, id: string, to: 'ready' | 'delivered') {
    return withTenant(this.db, ctx, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(kitchenTickets)
        .where(and(eq(kitchenTickets.id, id), storeCondition(ctx, kitchenTickets.storeId)));
      if (!ticket) throw notFound('Pedido da cozinha');
      const allowed = to === 'ready' ? ['pending'] : ['pending', 'ready'];
      if (!allowed.includes(ticket.status)) {
        throw new AppError(409, 'invalid_state', 'Este pedido já mudou de situação.');
      }
      const now = new Date();
      const [row] = await tx
        .update(kitchenTickets)
        .set(
          to === 'ready'
            ? { status: 'ready' as const, readyAt: now }
            : { status: 'delivered' as const, deliveredAt: now, readyAt: ticket.readyAt ?? now },
        )
        .where(eq(kitchenTickets.id, id))
        .returning();
      return toView(row!);
    });
  }
}

@Controller('kitchen')
export class KitchenController {
  constructor(@Inject(KitchenService) private readonly kitchen: KitchenService) {}

  @Get('tickets')
  @RequirePermission('pos.sell')
  queue(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string) {
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return this.kitchen.queue(ctx, storeId);
  }

  @Post('tickets/:id/ready')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  ready(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.kitchen.advance(ctx, id, 'ready');
  }

  @Post('tickets/:id/delivered')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  delivered(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.kitchen.advance(ctx, id, 'delivered');
  }
}
