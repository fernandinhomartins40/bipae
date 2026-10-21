import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  cents,
  commissionExceptionInput,
  formatBRL,
  uuidv7,
  type CommissionExceptionView,
  type CommissionReport,
} from '@bipae/domain';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  commissionRates,
  financialEntries,
  products,
  saleItems,
  salePayments,
  sales,
  sellers,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { toCsv, toPdf, toXlsx, type ReportTable } from '../reports/report-export';
import {
  allocate,
  rateFor,
  totalize,
  type CommissionEntry,
  type CommissionRate,
} from './commission';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const todayBr = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const saleDay = sql<string>`to_char(${sales.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;

interface ItemRow {
  saleId: string;
  line: number;
  sellerId: string | null;
  productId: string;
  category: string | null;
  totalCents: number;
  day: string;
}

/** Comissão por vendedor (F8-02): taxas com vigência, exceções e o relatório do período. */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async allRates(tx: Tx): Promise<CommissionRate[]> {
    return (
      tx
        .select({
          sellerId: commissionRates.sellerId,
          productId: commissionRates.productId,
          category: commissionRates.category,
          rateBp: commissionRates.rateBp,
          startsOn: commissionRates.startsOn,
        })
        .from(commissionRates)
        // Mesma data: vale a criada por último (o cálculo fica com a última da lista).
        .orderBy(asc(commissionRates.startsOn), asc(commissionRates.createdAt))
    );
  }

  /** % de cada vendedor que vale hoje (para a tela de vendedores). */
  async sellerRates(tx: Tx): Promise<Map<string, number>> {
    const today = todayBr();
    const out = new Map<string, { bp: number; on: string }>();
    for (const r of await this.allRates(tx)) {
      if (!r.sellerId || r.rateBp === null || r.startsOn > today) continue;
      const prev = out.get(r.sellerId);
      if (!prev || r.startsOn >= prev.on) out.set(r.sellerId, { bp: r.rateBp, on: r.startsOn });
    }
    return new Map([...out].map(([id, v]) => [id, v.bp]));
  }

  /** Grava o % do vendedor a partir de hoje, só quando mudou. */
  async setSellerRate(tx: Tx, ctx: RequestContext, sellerId: string, rateBp: number) {
    const current = (await this.sellerRates(tx)).get(sellerId) ?? null;
    if (current === rateBp) return;
    await tx.insert(commissionRates).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      sellerId,
      rateBp,
      startsOn: todayBr(),
      createdBy: ctx.userId,
    });
    await this.audit.record(tx, ctx, {
      action: 'commission.seller_rate',
      entity: 'seller',
      entityId: sellerId,
      data: { before: current, after: rateBp },
    });
  }

  /** Exceções que valem hoje, por produto ou categoria. */
  exceptions(ctx: RequestContext): Promise<CommissionExceptionView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const today = todayBr();
      const rows = await tx
        .select({
          id: commissionRates.id,
          productId: commissionRates.productId,
          productName: products.name,
          category: commissionRates.category,
          rateBp: commissionRates.rateBp,
          startsOn: commissionRates.startsOn,
        })
        .from(commissionRates)
        .leftJoin(products, eq(products.id, commissionRates.productId))
        .where(
          sql`${commissionRates.sellerId} is null and ${commissionRates.startsOn} <= ${today}`,
        );
      // A linha mais recente de cada produto ou categoria; exceção encerrada some da lista.
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        const key = r.productId ?? `cat:${r.category!.trim().toLowerCase()}`;
        const prev = latest.get(key);
        if (!prev || r.startsOn >= prev.startsOn) latest.set(key, r);
      }
      return [...latest.values()]
        .filter((r) => r.rateBp !== null)
        .map((r) => ({ ...r, productName: r.productName ?? null, rateBp: r.rateBp! }))
        .sort((a, b) =>
          (a.productName ?? a.category ?? '').localeCompare(b.productName ?? b.category ?? ''),
        );
    });
  }

  async saveException(ctx: RequestContext, body: unknown) {
    const input = parse(commissionExceptionInput, body);
    return withTenant(this.db, ctx, async (tx) => {
      if (input.productId) {
        const [p] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, input.productId));
        if (!p) throw notFound('Produto');
      }
      const row = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        productId: input.productId ?? null,
        category: input.category?.trim() ?? null,
        rateBp: input.rateBp,
        startsOn: input.startsOn ?? todayBr(),
        createdBy: ctx.userId,
      };
      await tx.insert(commissionRates).values(row);
      await this.audit.record(tx, ctx, {
        action: input.rateBp === null ? 'commission.exception_ended' : 'commission.exception_set',
        entity: input.productId ? 'product' : 'category',
        entityId: input.productId ?? null,
        data: { category: row.category, rateBp: row.rateBp, startsOn: row.startsOn },
      });
      return { ok: true };
    });
  }

  async report(ctx: RequestContext, from: string, to: string): Promise<CommissionReport> {
    if (!DAY.test(from) || !DAY.test(to) || from > to) {
      throw new AppError(422, 'invalid_period', 'Período inválido.');
    }
    return withTenant(this.db, ctx, async (tx) => {
      const rates = await this.allRates(tx);
      const entries: CommissionEntry[] = [];
      const push = (item: ItemRow, kind: CommissionEntry['kind'], baseCents: number) => {
        if (!item.sellerId || baseCents === 0) return;
        entries.push({
          sellerId: item.sellerId,
          kind,
          baseCents,
          rateBp: rateFor(rates, {
            sellerId: item.sellerId,
            productId: item.productId,
            category: item.category,
            day: item.day,
          }),
        });
      };

      // 1. Vendas do período: só a parte paga na hora (o crediário conta quando for pago).
      const periodSales = await tx
        .select({ id: sales.id, total: sales.totalCents })
        .from(sales)
        .where(
          and(
            eq(sales.kind, 'sale'),
            eq(sales.status, 'completed'),
            sql`${saleDay} >= ${from} and ${saleDay} <= ${to}`,
            storeCondition(ctx, sales.storeId),
          ),
        );
      const credit = await this.creditBySale(
        tx,
        periodSales.map((s) => s.id),
      );
      const saleItemsOf = await this.items(
        tx,
        periodSales.map((s) => s.id),
      );
      for (const sale of periodSales) {
        const items = saleItemsOf.get(sale.id) ?? [];
        const onCredit = Math.min(credit.get(sale.id) ?? 0, sale.total);
        const creditShare = allocate(
          onCredit,
          items.map((i) => i.totalCents),
        );
        items.forEach((item, i) => push(item, 'sale', item.totalCents - creditShare[i]!));
      }

      // 2. Crediário recebido no período, de vendas de qualquer data, com o % do dia da venda.
      const received = await tx
        .select({ saleId: financialEntries.saleId, amount: financialEntries.amountCents })
        .from(financialEntries)
        .innerJoin(sales, eq(sales.id, financialEntries.saleId))
        .where(
          and(
            eq(financialEntries.kind, 'receivable'),
            eq(financialEntries.status, 'paid'),
            isNotNull(financialEntries.saleId),
            sql`${financialEntries.paidAt} >= ${from} and ${financialEntries.paidAt} <= ${to}`,
            eq(sales.status, 'completed'),
            storeCondition(ctx, sales.storeId),
          ),
        );
      const receivedItems = await this.items(tx, [...new Set(received.map((r) => r.saleId!))]);
      for (const r of received) {
        const items = receivedItems.get(r.saleId!) ?? [];
        const share = allocate(
          r.amount,
          items.map((i) => i.totalCents),
        );
        items.forEach((item, i) => push(item, 'credit', share[i]!));
      }

      // 3. Devoluções do período descontam do vendedor do item, com o % do dia da venda.
      const returns = await tx
        .select({ originalSaleId: sales.originalSaleId, data: sales.data })
        .from(sales)
        .where(
          and(
            eq(sales.kind, 'return'),
            eq(sales.status, 'completed'),
            sql`${saleDay} >= ${from} and ${saleDay} <= ${to}`,
            storeCondition(ctx, sales.storeId),
          ),
        );
      const returnedItems = await this.items(tx, [
        ...new Set(returns.map((r) => r.originalSaleId!).filter(Boolean)),
      ]);
      for (const r of returns) {
        const data = r.data as {
          refundMethod?: string;
          items?: { line: number; refundCents: number }[];
        };
        // Reembolso que só abateu o crediário: aquela parte nunca contou.
        if (data.refundMethod === 'store_credit') continue;
        const items = returnedItems.get(r.originalSaleId!) ?? [];
        for (const back of data.items ?? []) {
          const item = items.find((i) => i.line === back.line);
          if (item) push(item, 'return', -back.refundCents);
        }
      }

      const totals = totalize(entries);
      const people = totals.length
        ? await tx
            .select({ id: sellers.id, name: sellers.name, code: sellers.code })
            .from(sellers)
            .where(
              inArray(
                sellers.id,
                totals.map((t) => t.sellerId),
              ),
            )
        : [];
      const rows = totals
        .map((t) => {
          const p = people.find((x) => x.id === t.sellerId);
          return { ...t, sellerName: p?.name ?? 'Vendedor não encontrado', code: p?.code ?? '' };
        })
        .sort(
          (a, b) =>
            b.commissionCents - a.commissionCents || a.sellerName.localeCompare(b.sellerName),
        );
      return {
        from,
        to,
        rows,
        totalCommissionCents: rows.reduce((s, r) => s + r.commissionCents, 0),
      };
    });
  }

  /** Quanto de cada venda foi no crediário. */
  private async creditBySale(tx: Tx, saleIds: string[]) {
    if (saleIds.length === 0) return new Map<string, number>();
    const rows = await tx
      .select({
        saleId: salePayments.saleId,
        cents: sql<string>`sum(${salePayments.amountCents})::text`,
      })
      .from(salePayments)
      .where(and(inArray(salePayments.saleId, saleIds), eq(salePayments.method, 'store_credit')))
      .groupBy(salePayments.saleId);
    return new Map(rows.map((r) => [r.saleId, Number(r.cents)]));
  }

  /** Itens das vendas (todos, com e sem vendedor: a divisão do crediário usa a venda inteira). */
  private async items(tx: Tx, saleIds: string[]): Promise<Map<string, ItemRow[]>> {
    const out = new Map<string, ItemRow[]>();
    if (saleIds.length === 0) return out;
    const rows = await tx
      .select({
        saleId: saleItems.saleId,
        line: saleItems.line,
        sellerId: saleItems.sellerId,
        productId: saleItems.productId,
        category: products.category,
        totalCents: saleItems.totalCents,
        day: saleDay,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(products.id, saleItems.productId))
      .where(inArray(saleItems.saleId, saleIds))
      .orderBy(saleItems.saleId, saleItems.line);
    for (const r of rows) {
      const list = out.get(r.saleId) ?? [];
      list.push({ ...r, category: r.category ?? null });
      out.set(r.saleId, list);
    }
    return out;
  }
}

const brl = (v: number) => formatBRL(cents(v));
const day = (iso: string) => iso.split('-').reverse().join('/');

@Controller('commissions')
export class CommissionController {
  constructor(@Inject(CommissionService) private readonly commissions: CommissionService) {}

  /** ?from=AAAA-MM-DD&to=AAAA-MM-DD */
  @Get()
  @RequirePermission('finance.read')
  report(@Ctx() ctx: RequestContext, @Query('from') from = '', @Query('to') to = '') {
    return this.commissions.report(ctx, from, to);
  }

  /** O mesmo relatório em arquivo: &format=csv|xlsx|pdf */
  @Get('export')
  @RequirePermission('finance.read')
  async export(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('format') format = 'csv',
  ) {
    const r = await this.commissions.report(ctx, from, to);
    const right = { align: 'right' as const };
    const table: ReportTable = {
      title: 'Comissões',
      subtitle: `De ${day(r.from)} a ${day(r.to)} · total ${brl(r.totalCommissionCents)}`,
      columns: [
        { label: 'Código' },
        { label: 'Vendedor' },
        { label: 'Vendas pagas', ...right },
        { label: 'Crediário recebido', ...right },
        { label: 'Devoluções', ...right },
        { label: 'Base', ...right },
        { label: 'Comissão', ...right },
      ],
      rows: r.rows.map((x) => [
        x.code,
        x.sellerName,
        brl(x.salesCents),
        brl(x.creditReceivedCents),
        brl(x.returnsCents),
        brl(x.baseCents),
        brl(x.commissionCents),
      ]),
    };
    const name = `bipae-comissoes-${r.from}-a-${r.to}`;
    const out =
      format === 'xlsx'
        ? {
            data: toXlsx(table),
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ext: 'xlsx',
          }
        : format === 'pdf'
          ? { data: await toPdf(table), type: 'application/pdf', ext: 'pdf' }
          : format === 'csv'
            ? { data: toCsv(table), type: 'text/csv; charset=utf-8', ext: 'csv' }
            : null;
    if (!out) throw new AppError(422, 'invalid_format', 'Formato inválido: use csv, xlsx ou pdf.');
    reply.header('content-type', out.type);
    reply.header('content-disposition', `attachment; filename="${name}.${out.ext}"`);
    return new StreamableFile(out.data);
  }

  @Get('exceptions')
  @RequirePermission('finance.read')
  exceptions(@Ctx() ctx: RequestContext) {
    return this.commissions.exceptions(ctx);
  }

  @Post('exceptions')
  @RequirePermission('admin.users')
  saveException(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.commissions.saveException(ctx, body);
  }
}
