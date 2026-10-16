import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { TabView } from '@bipae/domain';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import { tabs } from '../../db/schema';

const toView = (t: typeof tabs.$inferSelect): TabView => ({
  id: t.id,
  storeId: t.storeId,
  terminalId: t.terminalId,
  label: t.label,
  status: t.status,
  items: t.items,
  totalCents: t.totalCents,
  saleId: t.saleId,
  cancelReason: t.cancelReason,
  openedAt: t.openedAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  closedAt: t.closedAt?.toISOString() ?? null,
});

/**
 * Comandas guardadas no servidor (F5-07): as abertas de cada loja, para a retaguarda, o garçom e
 * a cozinha. Quem lança e fecha é o caixa; aqui só se lê.
 */
@Controller('tabs')
export class TabsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** ?status=open|paid|cancelled (padrão: open)&storeId= ; as fechadas, só das últimas 24 horas. */
  @Get()
  @RequirePermission('pos.sell')
  list(
    @Ctx() ctx: RequestContext,
    @Query('status') status = 'open',
    @Query('storeId') storeId?: string,
  ) {
    if (!['open', 'paid', 'cancelled'].includes(status)) {
      throw new AppError(422, 'invalid_status', 'Situação da comanda inválida.');
    }
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select()
          .from(tabs)
          .where(
            and(
              eq(tabs.status, status as TabView['status']),
              storeId ? eq(tabs.storeId, storeId) : undefined,
              storeCondition(ctx, tabs.storeId),
              status === 'open' ? undefined : gte(tabs.closedAt, sql`now() - interval '1 day'`),
            ),
          )
          .orderBy(status === 'open' ? tabs.openedAt : desc(tabs.closedAt))
          .limit(500)
      ).map(toView),
    );
  }
}
