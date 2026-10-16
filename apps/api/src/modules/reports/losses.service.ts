import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import { formatBRL, cents, type LossDashboardView, type LossOperatorView } from '@bipae/domain';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import {
  cashMovements,
  cashSessions,
  products,
  sales,
  stockLots,
  stockMovements,
  terminals,
  users,
} from '../../db/schema';

/**
 * Regras dos alertas (não são fiscais: são sinais para o gerente olhar de perto). Um operador
 * chama atenção quando cancela ou devolve bem mais que a média dos colegas no mesmo período.
 */
const ALERT_MIN_EVENTS = 3;
const ALERT_RATE_FACTOR = 2;
const ALERT_DISCOUNTS = 5;
/** Falta no fechamento a partir de R$ 10,00 vira alerta. */
const ALERT_CASH_SHORT_CENTS = -1000;

const brl = (value: number) => formatBRL(cents(value));
const pct = (bp: number) => (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const todayInBrazil = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Valor a custo de uma quantidade em milésimos (meio para cima). */
const atCost = (milli: number, costCents: number | null) =>
  costCents === null ? null : Math.floor((Math.abs(milli) * costCents + 500) / 1000);

const dayOf = (column: unknown) =>
  sql<string>`to_char(${column} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;

/**
 * Painel de prevenção de perdas (F5-05): no período e na loja escolhidos, o que sai do caixa e do
 * estoque sem virar venda. Por operador: cancelamentos, devoluções, descontos acima do limite,
 * sangrias e diferenças no fechamento. No estoque: perdas (ajustes e contagens para menos) e
 * lotes vencidos. Os alertas apontam quem foge do padrão dos colegas.
 */
@Injectable()
export class LossesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async dashboard(
    ctx: RequestContext,
    input: { from: string; to: string; storeId?: string },
  ): Promise<LossDashboardView> {
    return withTenant(this.db, ctx, async (tx) => {
      const inPeriod = (column: unknown) =>
        sql`${dayOf(column)} >= ${input.from} and ${dayOf(column)} <= ${input.to}`;
      const saleStore = and(
        input.storeId ? eq(sales.storeId, input.storeId) : undefined,
        storeCondition(ctx, sales.storeId),
      );
      const bySales = await tx
        .select({
          operatorId: sales.operatorId,
          salesCount: sql<number>`count(*) filter (where ${sales.kind} = 'sale')::int`,
          salesCents: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'sale'), 0)::bigint`,
          cancelledCount: sql<number>`count(*) filter (where ${sales.kind} = 'sale' and ${sales.status} = 'cancelled')::int`,
          cancelledCents: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'sale' and ${sales.status} = 'cancelled'), 0)::bigint`,
          returnsCount: sql<number>`count(*) filter (where ${sales.kind} = 'return')::int`,
          returnsCents: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'return'), 0)::bigint`,
          discountCount: sql<number>`count(*) filter (where ${sales.discountAuthorizedBy} is not null and ${sales.status} = 'completed')::int`,
          discountCents: sql<number>`coalesce(sum(${sales.discountCents}) filter (where ${sales.discountAuthorizedBy} is not null and ${sales.status} = 'completed'), 0)::bigint`,
        })
        .from(sales)
        .where(and(inPeriod(sales.occurredAt), saleStore))
        .groupBy(sales.operatorId);

      // Sangrias e fechamentos: a loja vem do caixa (terminal) da sessão.
      const sessionStore = and(
        input.storeId ? eq(terminals.storeId, input.storeId) : undefined,
        storeCondition(ctx, terminals.storeId),
      );
      const withdrawals = await tx
        .select({
          operatorId: cashMovements.operatorId,
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${cashMovements.amountCents}), 0)::bigint`,
        })
        .from(cashMovements)
        .innerJoin(cashSessions, eq(cashSessions.id, cashMovements.sessionId))
        .innerJoin(terminals, eq(terminals.id, cashSessions.terminalId))
        .where(
          and(
            eq(cashMovements.kind, 'withdrawal'),
            inPeriod(cashMovements.occurredAt),
            sessionStore,
          ),
        )
        .groupBy(cashMovements.operatorId);
      const differences = await tx
        .select({
          operatorId: cashSessions.operatorId,
          total: sql<number>`coalesce(sum(${cashSessions.differenceCents}), 0)::bigint`,
        })
        .from(cashSessions)
        .innerJoin(terminals, eq(terminals.id, cashSessions.terminalId))
        .where(
          and(
            sql`${cashSessions.closedAt} is not null`,
            inPeriod(cashSessions.closedAt),
            sessionStore,
          ),
        )
        .groupBy(cashSessions.operatorId);

      // Estoque: ajustes e diferenças de contagem para menos, no período, a custo.
      const stockStore = and(
        input.storeId ? eq(stockMovements.storeId, input.storeId) : undefined,
        storeCondition(ctx, stockMovements.storeId),
      );
      const lost = await tx
        .select({
          productId: stockMovements.productId,
          name: products.name,
          costCents: products.costCents,
          lostMilli: sql<number>`(-sum(${stockMovements.deltaMilli}))::bigint`,
        })
        .from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId))
        .where(
          and(
            inArray(stockMovements.reason, ['adjustment', 'count']),
            lt(stockMovements.deltaMilli, 0),
            inPeriod(stockMovements.occurredAt),
            stockStore,
          ),
        )
        .groupBy(stockMovements.productId, products.name, products.costCents);

      // Lotes vencidos que ainda têm saldo (situação de hoje, não do período).
      const lotStore = and(
        input.storeId ? eq(stockLots.storeId, input.storeId) : undefined,
        storeCondition(ctx, stockLots.storeId),
      );
      const expired = await tx
        .select({
          productId: stockLots.productId,
          name: products.name,
          costCents: products.costCents,
          lotCode: stockLots.lotCode,
          expiresOn: stockLots.expiresOn,
          quantityMilli: stockLots.quantityMilli,
        })
        .from(stockLots)
        .innerJoin(products, eq(products.id, stockLots.productId))
        .where(
          and(lt(stockLots.expiresOn, todayInBrazil()), gt(stockLots.quantityMilli, 0), lotStore),
        )
        .orderBy(stockLots.expiresOn);

      const ids = [
        ...new Set([
          ...bySales.map((r) => r.operatorId),
          ...withdrawals.map((r) => r.operatorId),
          ...differences.map((r) => r.operatorId),
        ]),
      ];
      const names = new Map(
        (ids.length
          ? await tx
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, ids))
          : []
        ).map((u) => [u.id, u.name]),
      );

      const operators: LossOperatorView[] = ids.map((id) => {
        const s = bySales.find((r) => r.operatorId === id);
        const w = withdrawals.find((r) => r.operatorId === id);
        const d = differences.find((r) => r.operatorId === id);
        const salesCount = s?.salesCount ?? 0;
        const cancelledCount = s?.cancelledCount ?? 0;
        return {
          operatorId: id,
          name: names.get(id) ?? 'Operador',
          salesCount,
          salesCents: Number(s?.salesCents ?? 0),
          cancelledCount,
          cancelledCents: Number(s?.cancelledCents ?? 0),
          cancelRateBp: salesCount ? Math.round((cancelledCount * 10_000) / salesCount) : 0,
          returnsCount: s?.returnsCount ?? 0,
          returnsCents: Number(s?.returnsCents ?? 0),
          authorizedDiscountCount: s?.discountCount ?? 0,
          authorizedDiscountCents: Number(s?.discountCents ?? 0),
          withdrawalsCount: w?.count ?? 0,
          withdrawalsCents: Number(w?.total ?? 0),
          cashDifferenceCents: Number(d?.total ?? 0),
          alerts: [],
        };
      });

      const sum = (pick: (o: LossOperatorView) => number) =>
        operators.reduce((total, o) => total + pick(o), 0);
      const totals = {
        salesCount: sum((o) => o.salesCount),
        salesCents: sum((o) => o.salesCents),
        cancelledCount: sum((o) => o.cancelledCount),
        cancelledCents: sum((o) => o.cancelledCents),
        returnsCount: sum((o) => o.returnsCount),
        returnsCents: sum((o) => o.returnsCents),
        authorizedDiscountCount: sum((o) => o.authorizedDiscountCount),
        authorizedDiscountCents: sum((o) => o.authorizedDiscountCents),
        withdrawalsCount: sum((o) => o.withdrawalsCount),
        withdrawalsCents: sum((o) => o.withdrawalsCents),
        cashDifferenceCents: sum((o) => o.cashDifferenceCents),
        stockLossCostCents: 0,
        expiredCostCents: 0,
      };

      const productsLost = lost
        .map((r) => ({
          productId: r.productId,
          name: r.name,
          lostMilli: Number(r.lostMilli),
          lostCostCents: atCost(Number(r.lostMilli), r.costCents),
        }))
        .sort(
          (a, b) => (b.lostCostCents ?? 0) - (a.lostCostCents ?? 0) || b.lostMilli - a.lostMilli,
        );
      totals.stockLossCostCents = productsLost.reduce((t, p) => t + (p.lostCostCents ?? 0), 0);
      const expiredLots = expired.map((r) => ({
        productId: r.productId,
        name: r.name,
        lotCode: r.lotCode,
        expiresOn: r.expiresOn!,
        quantityMilli: Number(r.quantityMilli),
        costCents: atCost(Number(r.quantityMilli), r.costCents),
      }));
      totals.expiredCostCents = expiredLots.reduce((t, l) => t + (l.costCents ?? 0), 0);

      // Alertas: comparados com a média de todos os operadores do período.
      const alerts: string[] = [];
      const avgCancelBp = totals.salesCount
        ? Math.round((totals.cancelledCount * 10_000) / totals.salesCount)
        : 0;
      const avgReturns = operators.length ? totals.returnsCount / operators.length : 0;
      for (const o of operators) {
        if (
          o.cancelledCount >= ALERT_MIN_EVENTS &&
          operators.length > 1 &&
          o.cancelRateBp > avgCancelBp * ALERT_RATE_FACTOR
        ) {
          o.alerts.push(
            `Cancelou ${pct(o.cancelRateBp)}% das vendas; a média do período é ${pct(avgCancelBp)}%.`,
          );
        }
        if (
          o.returnsCount >= ALERT_MIN_EVENTS &&
          operators.length > 1 &&
          o.returnsCount > avgReturns * ALERT_RATE_FACTOR
        ) {
          o.alerts.push(
            `Fez ${o.returnsCount} devoluções; a média por operador é ${avgReturns.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}.`,
          );
        }
        if (o.authorizedDiscountCount >= ALERT_DISCOUNTS) {
          o.alerts.push(
            `${o.authorizedDiscountCount} vendas com desconto acima do limite (${brl(o.authorizedDiscountCents)}).`,
          );
        }
        if (o.cashDifferenceCents <= ALERT_CASH_SHORT_CENTS) {
          o.alerts.push(`Faltou ${brl(-o.cashDifferenceCents)} nos fechamentos de caixa.`);
        }
        for (const text of o.alerts) alerts.push(`${o.name}: ${text}`);
      }
      if (productsLost[0]?.lostCostCents) {
        alerts.push(
          `Perdas de estoque somam ${brl(totals.stockLossCostCents)} a custo; a maior é ${productsLost[0].name} (${brl(productsLost[0].lostCostCents)}).`,
        );
      }
      if (expiredLots.length > 0) {
        alerts.push(
          `${expiredLots.length} lote(s) vencido(s) ainda no estoque${totals.expiredCostCents ? ` (${brl(totals.expiredCostCents)} a custo)` : ''}: retire da venda e dê baixa como perda.`,
        );
      }
      operators.sort(
        (a, b) => b.alerts.length - a.alerts.length || b.cancelledCents - a.cancelledCents,
      );
      return {
        from: input.from,
        to: input.to,
        totals,
        operators,
        products: productsLost.slice(0, 20),
        expiredLots: expiredLots.slice(0, 50),
        alerts,
      };
    });
  }
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

@Controller('reports')
export class LossesController {
  constructor(@Inject(LossesService) private readonly losses: LossesService) {}

  /** ?from=AAAA-MM-DD&to=AAAA-MM-DD&storeId= */
  @Get('losses')
  @RequirePermission('audit.read')
  dashboard(
    @Ctx() ctx: RequestContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!from || !to || !isoDay.test(from) || !isoDay.test(to) || from > to) {
      throw new AppError(422, 'invalid_period', 'Informe um período válido (de/até).');
    }
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return this.losses.dashboard(ctx, { from, to, ...(storeId && { storeId }) });
  }
}
