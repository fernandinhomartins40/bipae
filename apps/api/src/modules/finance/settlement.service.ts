import { Body, Controller, Get, Inject, Injectable, Put, Query } from '@nestjs/common';
import {
  SETTLEMENT_METHODS,
  settlementRulesInput,
  type SettlementDay,
  type SettlementMethod,
  type SettlementRuleView,
} from '@bipae/domain';
import { and, eq, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { bankTransactions, salePayments, sales, settlementRules } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Prazos usuais quando a loja ainda não configurou (taxa zero, para não inventar custo). */
const DEFAULT_DAYS: Record<SettlementMethod, number> = {
  debit: 1,
  credit: 30,
  pix: 0,
  voucher: 30,
};

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Taxa sobre o bruto, arredondando meio para cima. */
export const feeOf = (grossCents: number, feeBp: number) =>
  Number((BigInt(grossCents) * BigInt(feeBp) * 2n + 10_000n) / 20_000n);

/**
 * Recebíveis de cartão e Pix (F4-08): as vendas de cada forma viram recebimentos previstos
 * (data da venda + prazo, bruto, taxa e líquido) e cada dia é conferido com as entradas do
 * extrato importado na conciliação bancária.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async rules(tx: Tx): Promise<SettlementRuleView[]> {
    const saved = await tx.select().from(settlementRules);
    return SETTLEMENT_METHODS.map((method) => {
      const rule = saved.find((r) => r.method === method);
      return rule
        ? { method, feeBp: rule.feeBp, days: rule.days, configured: true }
        : { method, feeBp: 0, days: DEFAULT_DAYS[method], configured: false };
    });
  }

  getRules(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) => this.rules(tx));
  }

  async saveRules(
    ctx: RequestContext,
    rules: { method: SettlementMethod; feeBp: number; days: number }[],
  ) {
    return withTenant(this.db, ctx, async (tx) => {
      for (const rule of rules) {
        await tx
          .insert(settlementRules)
          .values({ tenantId: ctx.tenantId, ...rule })
          .onConflictDoUpdate({
            target: [settlementRules.tenantId, settlementRules.method],
            set: { feeBp: rule.feeBp, days: rule.days, updatedAt: new Date() },
          });
      }
      await this.audit.record(tx, ctx, {
        action: 'finance.settlement_rules_changed',
        entity: 'tenant',
        entityId: ctx.tenantId,
        data: { rules },
      });
      return this.rules(tx);
    });
  }

  /** Recebimentos previstos das vendas do período (pela data da venda, no fuso de Brasília). */
  async settlements(ctx: RequestContext, from: string, to: string): Promise<SettlementDay[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rules = await this.rules(tx);
      const day = sql<string>`to_char(${sales.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
      const rows = await tx
        .select({
          day,
          method: salePayments.method,
          count: sql<number>`count(distinct ${sales.id})::int`,
          gross: sql<string>`sum(${salePayments.amountCents})::text`,
        })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(
          and(
            eq(sales.kind, 'sale'),
            eq(sales.status, 'completed'),
            sql`${salePayments.method} in ('credit', 'debit', 'pix', 'voucher')`,
            sql`${day} >= ${from} and ${day} <= ${to}`,
          ),
        )
        .groupBy(day, salePayments.method);
      const byKey = new Map<string, SettlementDay>();
      for (const r of rows) {
        const rule = rules.find((x) => x.method === r.method)!;
        const date = addDays(r.day, rule.days);
        const key = `${date}|${rule.method}`;
        const current =
          byKey.get(key) ??
          ({
            date,
            method: rule.method,
            salesCount: 0,
            grossCents: 0,
            feeCents: 0,
            netCents: 0,
            received: false,
          } as SettlementDay);
        current.salesCount += r.count;
        current.grossCents += Number(r.gross);
        byKey.set(key, current);
      }
      const list = [...byKey.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.method.localeCompare(b.method),
      );
      for (const item of list) {
        const rule = rules.find((x) => x.method === item.method)!;
        item.feeCents = feeOf(item.grossCents, rule.feeBp);
        item.netCents = item.grossCents - item.feeCents;
      }
      // Confere com as entradas do extrato: mesmo valor líquido, na data ou no dia seguinte.
      if (list.length) {
        const credits = await tx
          .select({ postedOn: bankTransactions.postedOn, amount: bankTransactions.amountCents })
          .from(bankTransactions)
          .where(
            and(
              sql`${bankTransactions.amountCents} > 0`,
              sql`${bankTransactions.postedOn} >= ${list[0]!.date}`,
              sql`${bankTransactions.postedOn} <= ${addDays(list.at(-1)!.date, 1)}`,
            ),
          );
        const used = new Set<number>();
        for (const item of list) {
          const index = credits.findIndex(
            (c, i) =>
              !used.has(i) &&
              c.amount === item.netCents &&
              (c.postedOn === item.date || c.postedOn === addDays(item.date, 1)),
          );
          if (index >= 0) {
            used.add(index);
            item.received = true;
          }
        }
      }
      return list;
    });
  }
}

@Controller('finance')
export class SettlementController {
  constructor(@Inject(SettlementService) private readonly settlement: SettlementService) {}

  @Get('settlement-rules')
  @RequirePermission('finance.read')
  rules(@Ctx() ctx: RequestContext) {
    return this.settlement.getRules(ctx);
  }

  @Put('settlement-rules')
  @RequirePermission('finance.write')
  save(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.settlement.saveRules(ctx, parse(settlementRulesInput, body).rules);
  }

  /** ?from=AAAA-MM-DD&to=AAAA-MM-DD (datas das vendas). */
  @Get('settlements')
  @RequirePermission('finance.read')
  list(@Ctx() ctx: RequestContext, @Query('from') from?: string, @Query('to') to?: string) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !iso.test(from) || !iso.test(to) || from > to) {
      throw new AppError(422, 'invalid_period', 'Informe o período (de e até) em datas válidas.');
    }
    return this.settlement.settlements(ctx, from, to);
  }
}
