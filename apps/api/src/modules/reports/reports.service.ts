import { Controller, Get, Inject, Injectable, Query, Res, StreamableFile } from '@nestjs/common';
import {
  cents,
  formatBRL,
  PAYMENT_LABELS,
  type PaymentMethod,
  type SalesReport,
  type SalesReportGroup,
  type SalesReportRow,
} from '@bipae/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import { products, saleItems, salePayments, sales, stores, users } from '../../db/schema';
import { toCsv, toPdf, toXlsx, type ReportTable } from './report-export';

const GROUPS: SalesReportGroup[] = ['product', 'operator', 'store', 'payment', 'day'];
const GROUP_LABEL: Record<SalesReportGroup, string> = {
  product: 'Produto',
  operator: 'Operador',
  store: 'Loja',
  payment: 'Forma de pagamento',
  day: 'Dia',
};

/** Curva ABC pela receita acumulada antes do item: A abaixo de 80%, B abaixo de 95%, C o resto. */
export function abcClass(cumulativeBeforeBp: number): 'A' | 'B' | 'C' {
  return cumulativeBeforeBp < 8000 ? 'A' : cumulativeBeforeBp < 9500 ? 'B' : 'C';
}

const brl = (v: number) => formatBRL(cents(v));
const pct = (bp: number | null) =>
  bp === null
    ? '—'
    : `${(bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const qty = (milli: number | null) =>
  milli === null ? '—' : (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Relatórios de vendas (F4-10) por produto, operador, loja, forma de pagamento ou dia, com
 * receita, custo, margem, número de vendas e ticket médio, e curva ABC dos produtos.
 * Vendas concluídas no período (fuso de Brasília); devoluções e canceladas ficam de fora.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async sales(
    ctx: RequestContext,
    input: { from: string; to: string; group: SalesReportGroup; storeId?: string },
  ): Promise<SalesReport> {
    const day = sql<string>`to_char(${sales.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`;
    const where = and(
      eq(sales.kind, 'sale'),
      eq(sales.status, 'completed'),
      sql`${day} >= ${input.from} and ${day} <= ${input.to}`,
      input.storeId ? eq(sales.storeId, input.storeId) : undefined,
      storeCondition(ctx, sales.storeId),
    );
    return withTenant(this.db, ctx, async (tx) => {
      const [totals] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          revenue: sql<string>`coalesce(sum(${sales.totalCents}), 0)::text`,
        })
        .from(sales)
        .where(where);
      let rows: SalesReportRow[];
      if (input.group === 'payment') {
        const r = await tx
          .select({
            key: salePayments.method,
            count: sql<number>`count(distinct ${sales.id})::int`,
            revenue: sql<string>`sum(${salePayments.amountCents})::text`,
          })
          .from(salePayments)
          .innerJoin(sales, eq(sales.id, salePayments.saleId))
          .where(where)
          .groupBy(salePayments.method);
        rows = r.map((x) => ({
          key: x.key,
          label: PAYMENT_LABELS[x.key as PaymentMethod] ?? x.key,
          quantityMilli: null,
          salesCount: x.count,
          revenueCents: Number(x.revenue),
          costCents: null,
          marginCents: null,
          marginBp: null,
          avgTicketCents: x.count ? Math.round(Number(x.revenue) / x.count) : 0,
          abc: null,
        }));
      } else {
        const keyCol: SQL<string> =
          input.group === 'product'
            ? sql`${saleItems.productId}::text`
            : input.group === 'operator'
              ? sql`${sales.operatorId}::text`
              : input.group === 'store'
                ? sql`${sales.storeId}::text`
                : day;
        const labelCol: SQL<string> =
          input.group === 'product'
            ? sql`max(${products.name})`
            : input.group === 'operator'
              ? sql`max(coalesce(${users.name}, 'Operador'))`
              : input.group === 'store'
                ? sql`max(${stores.name})`
                : sql`max(${day})`;
        const r = await tx
          .select({
            key: keyCol,
            label: labelCol,
            quantityMilli: sql<string>`sum(${saleItems.quantityMilli})::text`,
            count: sql<number>`count(distinct ${sales.id})::int`,
            revenue: sql<string>`sum(${saleItems.totalCents})::text`,
            // Custo pelo cadastro atual; item sem custo fica fora da margem.
            costMilli: sql<string>`sum(${saleItems.quantityMilli} * ${products.costCents})::text`,
            withoutCost: sql<number>`count(*) filter (where ${products.costCents} is null)::int`,
          })
          .from(saleItems)
          .innerJoin(sales, eq(sales.id, saleItems.saleId))
          .innerJoin(products, eq(products.id, saleItems.productId))
          .leftJoin(stores, eq(stores.id, sales.storeId))
          .leftJoin(users, eq(users.id, sales.operatorId))
          .where(where)
          .groupBy(keyCol);
        rows = r.map((x) => {
          const revenue = Number(x.revenue);
          const cost =
            x.withoutCost > 0 ? null : Number((BigInt(x.costMilli ?? '0') * 2n + 1000n) / 2000n);
          const margin = cost === null ? null : revenue - cost;
          return {
            key: x.key,
            label: input.group === 'day' ? x.label.split('-').reverse().join('/') : x.label,
            quantityMilli: input.group === 'product' ? Number(x.quantityMilli) : null,
            salesCount: x.count,
            revenueCents: revenue,
            costCents: cost,
            marginCents: margin,
            marginBp:
              margin === null || revenue === 0 ? null : Math.round((margin * 10_000) / revenue),
            avgTicketCents: x.count ? Math.round(revenue / x.count) : 0,
            abc: null,
          };
        });
      }
      if (input.group === 'day') rows.sort((a, b) => a.key.localeCompare(b.key));
      else rows.sort((a, b) => b.revenueCents - a.revenueCents);
      if (input.group === 'product') {
        const total = rows.reduce((s, r) => s + r.revenueCents, 0);
        let before = 0;
        for (const row of rows) {
          // A classe sai do acumulado ANTES do item: o maior produto é sempre A, e o que cruza
          // os 80% ainda é A.
          row.abc = total ? abcClass(Math.round((before * 10_000) / total)) : 'C';
          before += row.revenueCents;
        }
      }
      const revenueCents = Number(totals?.revenue ?? 0);
      const count = totals?.count ?? 0;
      return {
        from: input.from,
        to: input.to,
        group: input.group,
        salesCount: count,
        revenueCents,
        avgTicketCents: count ? Math.round(revenueCents / count) : 0,
        rows,
      };
    });
  }

  table(report: SalesReport): ReportTable {
    const isProduct = report.group === 'product';
    const columns = [
      { label: GROUP_LABEL[report.group] },
      ...(isProduct ? [{ label: 'Qtd.', align: 'right' as const }, { label: 'ABC' }] : []),
      { label: 'Vendas', align: 'right' as const },
      { label: 'Receita', align: 'right' as const },
      ...(report.group !== 'payment'
        ? [
            { label: 'Custo', align: 'right' as const },
            { label: 'Margem', align: 'right' as const },
            { label: 'Margem %', align: 'right' as const },
          ]
        : []),
      { label: 'Ticket médio', align: 'right' as const },
    ];
    const rows = report.rows.map((r) => [
      r.label,
      ...(isProduct ? [qty(r.quantityMilli), r.abc ?? ''] : []),
      String(r.salesCount),
      brl(r.revenueCents),
      ...(report.group !== 'payment'
        ? [
            r.costCents === null ? '—' : brl(r.costCents),
            r.marginCents === null ? '—' : brl(r.marginCents),
            pct(r.marginBp),
          ]
        : []),
      brl(r.avgTicketCents),
    ]);
    const [fy, fm, fd] = report.from.split('-');
    const [ty, tm, td] = report.to.split('-');
    return {
      title: `Vendas por ${GROUP_LABEL[report.group].toLowerCase()}`,
      subtitle: `${fd}/${fm}/${fy} a ${td}/${tm}/${ty} · ${report.salesCount} venda(s) · ${brl(report.revenueCents)} · ticket médio ${brl(report.avgTicketCents)}`,
      columns,
      rows,
    };
  }
}

const parseInput = (q: { from?: string; to?: string; group?: string; storeId?: string }) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!q.from || !q.to || !iso.test(q.from) || !iso.test(q.to) || q.from > q.to) {
    throw new AppError(422, 'invalid_period', 'Informe o período (de e até) em datas válidas.');
  }
  const group = (q.group ?? 'product') as SalesReportGroup;
  if (!GROUPS.includes(group)) throw new AppError(422, 'invalid_group', 'Agrupamento inválido.');
  if (q.storeId && !/^[0-9a-f-]{36}$/i.test(q.storeId)) {
    throw new AppError(422, 'invalid_store', 'Loja inválida.');
  }
  return { from: q.from, to: q.to, group, ...(q.storeId && { storeId: q.storeId }) };
};

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** ?from=AAAA-MM-DD&to=AAAA-MM-DD&group=product|operator|store|payment|day&storeId= */
  @Get('sales')
  @RequirePermission('finance.read')
  sales(
    @Ctx() ctx: RequestContext,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group') group?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.reports.sales(ctx, parseInput({ from, to, group, storeId }));
  }

  /** Mesmo relatório em arquivo: &format=csv|xlsx|pdf */
  @Get('sales/export')
  @RequirePermission('finance.read')
  async export(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('group') group?: string,
    @Query('storeId') storeId?: string,
    @Query('format') format?: string,
  ) {
    const input = parseInput({ from, to, group, storeId });
    const table = this.reports.table(await this.reports.sales(ctx, input));
    const name = `bipae-vendas-${input.group}-${input.from}-a-${input.to}`;
    const out =
      format === 'xlsx'
        ? {
            data: toXlsx(table),
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ext: 'xlsx',
          }
        : format === 'pdf'
          ? { data: await toPdf(table), type: 'application/pdf', ext: 'pdf' }
          : format === 'csv' || !format
            ? { data: toCsv(table), type: 'text/csv; charset=utf-8', ext: 'csv' }
            : null;
    if (!out) throw new AppError(422, 'invalid_format', 'Formato inválido: use csv, xlsx ou pdf.');
    reply.header('content-type', out.type);
    reply.header('content-disposition', `attachment; filename="${name}.${out.ext}"`);
    return new StreamableFile(out.data);
  }
}
