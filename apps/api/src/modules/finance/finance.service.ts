import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  financialEntryInput,
  financialPaymentInput,
  purchaseOrderCancelInput,
  uuidv7,
  type CashFlowRow,
  type DreMonth,
  type DreReport,
  type FinancialEntryView,
  type FinancialSummary,
} from '@bipae/domain';
import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import {
  companies,
  customers,
  financialEntries,
  products,
  saleItems,
  salePayments,
  sales,
  suppliers,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type EntryInput = z.output<typeof financialEntryInput>;
type PaymentInput = z.output<typeof financialPaymentInput>;

/** Hoje no fuso de Brasília (AAAA-MM-DD). */
export const todayBr = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);

/** Soma meses mantendo o dia; se o mês não tem esse dia, fica no último (31/01 + 1 → 28/02). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Divide o valor em parcelas iguais; os centavos que sobram vão na primeira. */
export function splitInstallments(amountCents: number, count: number): number[] {
  const base = Math.floor(amountCents / count);
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? amountCents - base * (count - 1) : base,
  );
}

/**
 * Contas a pagar e a receber (F4-04). Cada parcela é um lançamento. A baixa registra a data, o
 * valor pago (pode ter juros ou desconto) e a forma; cancelar pede motivo e fica na auditoria.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async views(tx: Tx, where: SQL | undefined): Promise<FinancialEntryView[]> {
    const today = todayBr();
    const rows = await tx
      .select({ e: financialEntries, supplier: suppliers.name, customer: customers.name })
      .from(financialEntries)
      .leftJoin(suppliers, eq(suppliers.id, financialEntries.supplierId))
      .leftJoin(customers, eq(customers.id, financialEntries.customerId))
      .where(where)
      .orderBy(asc(financialEntries.dueDate), asc(financialEntries.installment))
      .limit(500);
    return rows.map(({ e, supplier, customer }) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      overdue: e.status === 'open' && e.dueDate < today,
      description: e.description,
      category: e.category,
      partyName: supplier ?? customer ?? null,
      supplierId: e.supplierId,
      customerId: e.customerId,
      document: e.document,
      amountCents: e.amountCents,
      dueDate: e.dueDate,
      installment: e.installment,
      installments: e.installments,
      groupId: e.groupId,
      paidAt: e.paidAt,
      paidCents: e.paidCents,
      paymentMethod: e.paymentMethod,
      cancelReason: e.cancelReason,
    }));
  }

  async list(
    ctx: RequestContext,
    filter: { kind?: string; status?: string; from?: string; to?: string; overdue?: boolean },
  ) {
    return withTenant(this.db, ctx, (tx) =>
      this.views(
        tx,
        and(
          filter.kind === 'payable' || filter.kind === 'receivable'
            ? eq(financialEntries.kind, filter.kind)
            : undefined,
          filter.status === 'open' || filter.status === 'paid' || filter.status === 'cancelled'
            ? eq(financialEntries.status, filter.status)
            : undefined,
          filter.from ? gte(financialEntries.dueDate, filter.from) : undefined,
          filter.to ? lte(financialEntries.dueDate, filter.to) : undefined,
          filter.overdue
            ? and(
                eq(financialEntries.status, 'open'),
                sql`${financialEntries.dueDate} < ${todayBr()}`,
              )
            : undefined,
        ),
      ),
    );
  }

  /**
   * Fluxo de caixa (F4-05) entre duas datas, por dia ou por mês, no fuso de Brasília.
   * Realizado: o que as vendas receberam (menos crediário, que ainda não é dinheiro, e menos as
   * devoluções pagas), mais as contas recebidas, menos as contas pagas. Previsto: contas em
   * aberto pelo vencimento. O saldo acumula só o realizado.
   */
  async cashFlow(
    ctx: RequestContext,
    from: string,
    to: string,
    group: 'day' | 'month',
  ): Promise<CashFlowRow[]> {
    const key = (iso: string) => (group === 'month' ? iso.slice(0, 7) : iso);
    const localDay = (column: unknown) =>
      sql<string>`to_char(${column} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
    return withTenant(this.db, ctx, async (tx) => {
      const day = localDay(sales.occurredAt);
      const inRange = and(sql`${day} >= ${from}`, sql`${day} <= ${to}`);
      const salesIn = await tx
        .select({ day, cents: sql<string>`sum(${salePayments.amountCents})::text` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(
          and(
            inRange,
            eq(sales.kind, 'sale'),
            eq(sales.status, 'completed'),
            sql`${salePayments.method} <> 'store_credit'`,
          ),
        )
        .groupBy(day);
      const refunds = await tx
        .select({ day, cents: sql<string>`sum(${sales.totalCents})::text` })
        .from(sales)
        .where(
          and(
            inRange,
            eq(sales.kind, 'return'),
            eq(sales.status, 'completed'),
            sql`coalesce(${sales.data} ->> 'refundMethod', '') <> 'store_credit'`,
          ),
        )
        .groupBy(day);
      const settled = await tx
        .select({
          day: financialEntries.paidAt,
          kind: financialEntries.kind,
          cents: sql<string>`sum(${financialEntries.paidCents})::text`,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.status, 'paid'),
            gte(financialEntries.paidAt, from),
            lte(financialEntries.paidAt, to),
          ),
        )
        .groupBy(financialEntries.paidAt, financialEntries.kind);
      const projected = await tx
        .select({
          day: financialEntries.dueDate,
          kind: financialEntries.kind,
          cents: sql<string>`sum(${financialEntries.amountCents})::text`,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.status, 'open'),
            gte(financialEntries.dueDate, from),
            lte(financialEntries.dueDate, to),
          ),
        )
        .groupBy(financialEntries.dueDate, financialEntries.kind);

      const rows = new Map<string, CashFlowRow>();
      const row = (iso: string) => {
        const period = key(iso);
        let r = rows.get(period);
        if (!r) {
          r = {
            period,
            salesCents: 0,
            receivedCents: 0,
            paidCents: 0,
            netCents: 0,
            projectedInCents: 0,
            projectedOutCents: 0,
            balanceCents: 0,
          };
          rows.set(period, r);
        }
        return r;
      };
      for (const s of salesIn) row(s.day).salesCents += Number(s.cents);
      for (const s of refunds) row(s.day).salesCents -= Number(s.cents);
      for (const s of settled) {
        if (!s.day) continue;
        if (s.kind === 'receivable') row(s.day).receivedCents += Number(s.cents);
        else row(s.day).paidCents += Number(s.cents);
      }
      for (const p of projected) {
        if (p.kind === 'receivable') row(p.day).projectedInCents += Number(p.cents);
        else row(p.day).projectedOutCents += Number(p.cents);
      }
      let balance = 0;
      return [...rows.values()]
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((r) => {
          r.netCents = r.salesCents + r.receivedCents - r.paidCents;
          balance += r.netCents;
          return { ...r, balanceCents: balance };
        });
    });
  }

  /**
   * DRE gerencial (F4-06) mês a mês, entre AAAA-MM e AAAA-MM. Receita das vendas menos
   * devoluções; impostos sobre a venda calculados pelo caixa em cada item (IBS e CBS só a
   * partir de 2027, quando deixam de ser teste); CMV pelo custo atual do cadastro; despesas são
   * as contas a pagar do mês (pelo vencimento), por categoria, sem a compra de mercadoria, que
   * já está no CMV.
   */
  async dre(ctx: RequestContext, from: string, to: string): Promise<DreReport> {
    const month = (column: unknown) =>
      sql<string>`to_char(${column} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;
    return withTenant(this.db, ctx, async (tx) => {
      const m = month(sales.occurredAt);
      const inRange = and(sql`${m} >= ${from}`, sql`${m} <= ${to}`, eq(sales.status, 'completed'));
      const revenue = await tx
        .select({
          month: m,
          sold: sql<string>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'sale'), 0)::text`,
          returned: sql<string>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'return'), 0)::text`,
        })
        .from(sales)
        .where(inRange)
        .groupBy(m);
      const tax = (field: string) => sql`coalesce((${saleItems.taxes} ->> ${field})::bigint, 0)`;
      const taxes = await tx
        .select({
          month: m,
          current: sql<string>`sum(${tax('icmsCents')} + ${tax('fcpCents')} + ${tax('pisCents')} + ${tax('cofinsCents')})::text`,
          reform: sql<string>`sum(${tax('ibsCents')} + ${tax('cbsCents')})::text`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(and(inRange, eq(sales.kind, 'sale')))
        .groupBy(m);
      const cogs = await tx
        .select({
          month: m,
          // milésimos × centavos ÷ 1000, arredondando meio para cima no total do mês.
          milliCents: sql<string>`coalesce(sum(${saleItems.quantityMilli} * ${products.costCents}), 0)::text`,
          missing: sql<string>`count(*) filter (where ${products.costCents} is null)::text`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .innerJoin(products, eq(products.id, saleItems.productId))
        .where(and(inRange, eq(sales.kind, 'sale')))
        .groupBy(m);
      const returnedCogs = rowsOf<{ month: string; milli_cents: string }>(
        await tx.execute(sql`
          select to_char(s.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as month,
                 coalesce(sum((i ->> 'quantityMilli')::bigint * p.cost_cents), 0)::text as milli_cents
          from sales s
          cross join lateral jsonb_array_elements(coalesce(s.data -> 'items', '[]'::jsonb)) i
          join products p on p.id = (i ->> 'productId')::uuid
          where s.kind = 'return' and s.status = 'completed'
            and to_char(s.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM') between ${from} and ${to}
          group by 1`),
      );
      const d = sql<string>`substr(${financialEntries.dueDate}::text, 1, 7)`;
      const expenses = await tx
        .select({
          month: d,
          category: sql<string>`coalesce(nullif(trim(${financialEntries.category}), ''), 'Sem categoria')`,
          cents: sql<string>`sum(${financialEntries.amountCents})::text`,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.kind, 'payable'),
            sql`${financialEntries.status} <> 'cancelled'`,
            sql`${d} >= ${from} and ${d} <= ${to}`,
            sql`lower(coalesce(${financialEntries.category}, '')) not in ('mercadoria', 'mercadorias', 'compra de mercadoria', 'compras')`,
          ),
        )
        .groupBy(d, sql`2`);

      const months = new Map<string, DreMonth>();
      const at = (key: string) => {
        let row = months.get(key);
        if (!row) {
          row = {
            month: key,
            grossRevenueCents: 0,
            returnsCents: 0,
            taxesCents: 0,
            netRevenueCents: 0,
            cogsCents: 0,
            grossProfitCents: 0,
            expenses: [],
            expensesCents: 0,
            resultCents: 0,
          };
          months.set(key, row);
        }
        return row;
      };
      const half = (milliCents: bigint) => Number((milliCents * 2n + 1000n) / 2000n);
      for (const r of revenue) {
        at(r.month).grossRevenueCents += Number(r.sold);
        at(r.month).returnsCents += Number(r.returned);
      }
      for (const t of taxes) {
        at(t.month).taxesCents += Number(t.current) + (t.month >= '2027-01' ? Number(t.reform) : 0);
      }
      let missingCost = 0;
      for (const g of cogs) {
        at(g.month).cogsCents += half(BigInt(g.milliCents));
        missingCost += Number(g.missing);
      }
      for (const g of returnedCogs) at(g.month).cogsCents -= half(BigInt(g.milli_cents));
      for (const e of expenses) {
        const row = at(e.month);
        row.expenses.push({ category: e.category, cents: Number(e.cents) });
        row.expensesCents += Number(e.cents);
      }
      const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
      for (const r of list) {
        r.expenses.sort((a, b) => b.cents - a.cents);
        r.netRevenueCents = r.grossRevenueCents - r.returnsCents - r.taxesCents;
        r.grossProfitCents = r.netRevenueCents - r.cogsCents;
        r.resultCents = r.grossProfitCents - r.expensesCents;
      }
      const notes = ['CMV pelo custo atual do cadastro de cada produto.'];
      if (missingCost > 0) {
        notes.push(`${missingCost} item(ns) vendido(s) sem custo no cadastro ficaram fora do CMV.`);
      }
      return { months: list, notes };
    });
  }

  async summary(ctx: RequestContext): Promise<FinancialSummary> {
    const today = todayBr();
    const week = new Date(`${today}T12:00:00Z`);
    week.setUTCDate(week.getUTCDate() + 7);
    const next7 = week.toISOString().slice(0, 10);
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          kind: financialEntries.kind,
          open: sql<string>`coalesce(sum(${financialEntries.amountCents}), 0)::text`,
          overdue: sql<string>`coalesce(sum(${financialEntries.amountCents}) filter (where ${financialEntries.dueDate} < ${today}), 0)::text`,
          next7: sql<string>`coalesce(sum(${financialEntries.amountCents}) filter (where ${financialEntries.dueDate} >= ${today} and ${financialEntries.dueDate} <= ${next7}), 0)::text`,
        })
        .from(financialEntries)
        .where(eq(financialEntries.status, 'open'))
        .groupBy(financialEntries.kind);
      const of = (kind: 'payable' | 'receivable') => {
        const r = rows.find((x) => x.kind === kind);
        return {
          openCents: Number(r?.open ?? 0),
          overdueCents: Number(r?.overdue ?? 0),
          dueNext7Cents: Number(r?.next7 ?? 0),
        };
      };
      return { payable: of('payable'), receivable: of('receivable') };
    });
  }

  private async checkParties(tx: Tx, input: EntryInput) {
    // As chaves estrangeiras ignoram o isolamento: confere que tudo é deste cliente.
    if (input.supplierId) {
      const [s] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.id, input.supplierId));
      if (!s) throw new AppError(422, 'invalid_supplier', 'Fornecedor não encontrado.');
    }
    if (input.customerId) {
      const [c] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, input.customerId));
      if (!c) throw new AppError(422, 'invalid_customer', 'Cliente não encontrado.');
    }
  }

  async create(ctx: RequestContext, input: EntryInput) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.checkParties(tx, input);
      const [company] = input.companyId
        ? await tx
            .select({ id: companies.id })
            .from(companies)
            .where(eq(companies.id, input.companyId))
        : await tx
            .select({ id: companies.id })
            .from(companies)
            .orderBy(asc(companies.createdAt))
            .limit(1);
      if (!company) throw new AppError(422, 'invalid_company', 'Empresa não encontrada.');
      const groupId = uuidv7();
      const amounts = splitInstallments(input.amountCents, input.installments);
      await tx.insert(financialEntries).values(
        amounts.map((amountCents, i) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          companyId: company.id,
          kind: input.kind,
          description: input.description,
          category: input.category ?? null,
          supplierId: input.supplierId ?? null,
          customerId: input.customerId ?? null,
          document: input.document ?? null,
          amountCents,
          dueDate: addMonths(input.dueDate, i),
          groupId,
          installment: i + 1,
          installments: input.installments,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })),
      );
      return this.views(tx, eq(financialEntries.groupId, groupId));
    });
  }

  private async requireOpen(tx: Tx, id: string) {
    const [entry] = await tx.select().from(financialEntries).where(eq(financialEntries.id, id));
    if (!entry) throw notFound('Lançamento');
    if (entry.status !== 'open') {
      throw new AppError(409, 'entry_closed', 'Esta conta já foi paga ou cancelada.');
    }
    return entry;
  }

  /** Edita uma parcela em aberto (valor, vencimento, descrição...). */
  async update(ctx: RequestContext, id: string, input: EntryInput) {
    return withTenant(this.db, ctx, async (tx) => {
      const entry = await this.requireOpen(tx, id);
      await this.checkParties(tx, input);
      await tx
        .update(financialEntries)
        .set({
          description: input.description,
          category: input.category ?? null,
          supplierId: input.supplierId ?? null,
          customerId: input.customerId ?? null,
          document: input.document ?? null,
          amountCents: input.amountCents,
          dueDate: input.dueDate,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, id));
      if (input.amountCents !== entry.amountCents) {
        await this.audit.record(tx, ctx, {
          action: 'finance.amount_changed',
          entity: 'financial_entry',
          entityId: id,
          data: { from: entry.amountCents, to: input.amountCents },
        });
      }
      const [view] = await this.views(tx, eq(financialEntries.id, id));
      return view!;
    });
  }

  /** Baixa: pago (ou recebido) na data, com o valor efetivo e a forma. */
  async pay(ctx: RequestContext, id: string, input: PaymentInput) {
    return withTenant(this.db, ctx, async (tx) => {
      const entry = await this.requireOpen(tx, id);
      await tx
        .update(financialEntries)
        .set({
          status: 'paid',
          paidAt: input.paidAt,
          paidCents: input.paidCents,
          paymentMethod: input.paymentMethod ?? null,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, id));
      await this.audit.record(tx, ctx, {
        action: entry.kind === 'payable' ? 'finance.paid' : 'finance.received',
        entity: 'financial_entry',
        entityId: id,
        data: { amountCents: entry.amountCents, paidCents: input.paidCents, paidAt: input.paidAt },
      });
      const [view] = await this.views(tx, eq(financialEntries.id, id));
      return view!;
    });
  }

  async cancel(ctx: RequestContext, id: string, reason: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const entry = await this.requireOpen(tx, id);
      await tx
        .update(financialEntries)
        .set({ status: 'cancelled', cancelReason: reason, updatedAt: new Date() })
        .where(eq(financialEntries.id, id));
      await this.audit.record(tx, ctx, {
        action: 'finance.cancelled',
        entity: 'financial_entry',
        entityId: id,
        data: { kind: entry.kind, amountCents: entry.amountCents, reason },
      });
      const [view] = await this.views(tx, eq(financialEntries.id, id));
      return view!;
    });
  }
}

/**
 * Financeiro é informação sensível do negócio: ver exige finance.read (dono, gerente e
 * contador) e lançar ou dar baixa, finance.write (dono e gerente). O operador de caixa não vê.
 */
@Controller('finance/entries')
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get()
  @RequirePermission('finance.read')
  list(
    @Ctx() ctx: RequestContext,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('overdue') overdue?: string,
  ) {
    return this.finance.list(ctx, { kind, status, from, to, overdue: overdue === 'true' });
  }

  /** Fluxo de caixa (F4-05): ?from=AAAA-MM-DD&to=AAAA-MM-DD&group=day|month */
  @Get('cash-flow')
  @RequirePermission('finance.read')
  cashFlow(
    @Ctx() ctx: RequestContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group') group?: string,
  ) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !iso.test(from) || !iso.test(to) || from > to) {
      throw new AppError(422, 'invalid_period', 'Informe o período (de e até) em datas válidas.');
    }
    return this.finance.cashFlow(ctx, from, to, group === 'month' ? 'month' : 'day');
  }

  /** DRE gerencial (F4-06): ?from=AAAA-MM&to=AAAA-MM */
  @Get('dre')
  @RequirePermission('finance.read')
  dre(@Ctx() ctx: RequestContext, @Query('from') from?: string, @Query('to') to?: string) {
    const ym = /^\d{4}-\d{2}$/;
    if (!from || !to || !ym.test(from) || !ym.test(to) || from > to) {
      throw new AppError(422, 'invalid_period', 'Informe os meses (de e até) no formato AAAA-MM.');
    }
    return this.finance.dre(ctx, from, to);
  }

  @Get('summary')
  @RequirePermission('finance.read')
  summary(@Ctx() ctx: RequestContext) {
    return this.finance.summary(ctx);
  }

  @Post()
  @RequirePermission('finance.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.finance.create(ctx, parse(financialEntryInput, body));
  }

  @Put(':id')
  @RequirePermission('finance.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.update(ctx, id, parse(financialEntryInput, body));
  }

  @Post(':id/pay')
  @RequirePermission('finance.write')
  pay(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.pay(ctx, id, parse(financialPaymentInput, body));
  }

  @Post(':id/cancel')
  @RequirePermission('finance.write')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.cancel(ctx, id, parse(purchaseOrderCancelInput, body).reason);
  }
}
