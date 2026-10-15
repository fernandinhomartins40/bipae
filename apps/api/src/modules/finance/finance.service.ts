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
  type FinancialEntryView,
  type FinancialSummary,
} from '@bipae/domain';
import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, customers, financialEntries, suppliers } from '../../db/schema';
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
