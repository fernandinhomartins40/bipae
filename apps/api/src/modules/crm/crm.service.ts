import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  averageIntervalDays,
  CRM_FREQUENT_DAYS,
  CRM_SEGMENTS,
  crmSegment,
  formatBRL,
  type Cents,
  type CrmCustomerRow,
  type CrmSegment,
  type CustomerSummary,
} from '@bipae/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { notFound, parse } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { customers, saleItems, sales, stores } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { toCsv } from '../reports/report-export';

const DAY = 24 * 60 * 60_000;
const segmentQuery = z.object({
  segment: z.enum(CRM_SEGMENTS).optional(),
  consent: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/**
 * Relacionamento com o cliente (F6-08.a): as compras feitas com o CPF/CNPJ do cliente na nota
 * viram histórico e segmentos. Só entram vendas concluídas; devoluções descontam do total.
 */
@Injectable()
export class CrmService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async summary(
    ctx: RequestContext,
    customerId: string,
    now = new Date(),
  ): Promise<CustomerSummary> {
    return withTenant(this.db, ctx, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id, taxId: customers.taxId })
        .from(customers)
        .where(eq(customers.id, customerId));
      if (!customer) throw notFound('Cliente');
      const empty: CustomerSummary = {
        customerId,
        hasTaxId: Boolean(customer.taxId),
        purchases: 0,
        totalCents: 0,
        averageTicketCents: null,
        firstPurchaseAt: null,
        lastPurchaseAt: null,
        averageIntervalDays: null,
        segment: null,
        topProducts: [],
        recentSales: [],
      };
      if (!customer.taxId) return empty;
      const mine = and(
        eq(sales.customerTaxId, customer.taxId),
        eq(sales.status, 'completed'),
        storeCondition(ctx, sales.storeId),
      );
      const recentFrom = new Date(now.getTime() - CRM_FREQUENT_DAYS * DAY);
      const [stats] = await tx
        .select({
          purchases: sql<number>`count(*) filter (where ${sales.kind} = 'sale')`,
          sold: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'sale'), 0)`,
          returned: sql<number>`coalesce(sum(${sales.totalCents}) filter (where ${sales.kind} = 'return'), 0)`,
          first: sql<Date | null>`min(${sales.occurredAt}) filter (where ${sales.kind} = 'sale')`,
          last: sql<Date | null>`max(${sales.occurredAt}) filter (where ${sales.kind} = 'sale')`,
          recent: sql<number>`count(*) filter (where ${sales.kind} = 'sale' and ${sales.occurredAt} > ${recentFrom})`,
        })
        .from(sales)
        .where(mine);
      const purchases = Number(stats?.purchases ?? 0);
      const recentSales = await tx
        .select({
          id: sales.id,
          occurredAt: sales.occurredAt,
          kind: sales.kind,
          status: sales.status,
          totalCents: sales.totalCents,
          storeName: stores.name,
        })
        .from(sales)
        .innerJoin(stores, eq(stores.id, sales.storeId))
        .where(and(eq(sales.customerTaxId, customer.taxId), storeCondition(ctx, sales.storeId)))
        .orderBy(desc(sales.occurredAt))
        .limit(20);
      if (purchases === 0) {
        return {
          ...empty,
          recentSales: recentSales.map((s) => ({ ...s, occurredAt: s.occurredAt.toISOString() })),
        };
      }
      const top = await tx
        .select({
          productId: saleItems.productId,
          name: sql<string>`max(${saleItems.name})`,
          quantityMilli: sql<number>`sum(${saleItems.quantityMilli})`,
          totalCents: sql<number>`sum(${saleItems.totalCents})`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(and(mine, eq(sales.kind, 'sale')))
        .groupBy(saleItems.productId)
        .orderBy(desc(sql`sum(${saleItems.totalCents})`))
        .limit(5);
      const first = new Date(stats!.first!);
      const last = new Date(stats!.last!);
      const sold = Number(stats!.sold);
      return {
        customerId,
        hasTaxId: true,
        purchases,
        totalCents: sold - Number(stats!.returned),
        averageTicketCents: Math.round(sold / purchases),
        firstPurchaseAt: first.toISOString(),
        lastPurchaseAt: last.toISOString(),
        averageIntervalDays: averageIntervalDays(first, last, purchases),
        segment: crmSegment(
          { firstPurchaseAt: first, lastPurchaseAt: last, recentPurchases: Number(stats!.recent) },
          now,
        ),
        topProducts: top.map((t) => ({
          ...t,
          quantityMilli: Number(t.quantityMilli),
          totalCents: Number(t.totalCents),
        })),
        recentSales: recentSales.map((s) => ({ ...s, occurredAt: s.occurredAt.toISOString() })),
      };
    });
  }

  /** Clientes que já compraram com CPF/CNPJ, com o segmento de cada um. */
  private async rows(
    tx: Tx,
    ctx: RequestContext,
    filter: z.output<typeof segmentQuery>,
    now: Date,
  ): Promise<CrmCustomerRow[]> {
    const recentFrom = new Date(now.getTime() - CRM_FREQUENT_DAYS * DAY);
    const found = await tx
      .select({
        customerId: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        marketingConsent: customers.marketingConsent,
        purchases: sql<number>`count(*)`,
        totalCents: sql<number>`sum(${sales.totalCents})`,
        first: sql<Date>`min(${sales.occurredAt})`,
        last: sql<Date>`max(${sales.occurredAt})`,
        recent: sql<number>`count(*) filter (where ${sales.occurredAt} > ${recentFrom})`,
      })
      .from(sales)
      .innerJoin(customers, eq(customers.taxId, sales.customerTaxId))
      .where(
        and(
          eq(sales.kind, 'sale'),
          eq(sales.status, 'completed'),
          storeCondition(ctx, sales.storeId),
          filter.consent === undefined ? undefined : eq(customers.marketingConsent, filter.consent),
        ),
      )
      .groupBy(customers.id)
      .orderBy(desc(sql`max(${sales.occurredAt})`))
      .limit(5000);
    return found
      .map((r) => {
        const last = new Date(r.last);
        return {
          customerId: r.customerId,
          name: r.name,
          email: r.email,
          phone: r.phone,
          marketingConsent: r.marketingConsent,
          purchases: Number(r.purchases),
          totalCents: Number(r.totalCents),
          lastPurchaseAt: last.toISOString(),
          segment: crmSegment(
            {
              firstPurchaseAt: new Date(r.first),
              lastPurchaseAt: last,
              recentPurchases: Number(r.recent),
            },
            now,
          ) as CrmSegment,
        };
      })
      .filter((r) => !filter.segment || r.segment === filter.segment);
  }

  /** Quem aceitou receber ofertas, de um segmento ou de todos (campanhas, F6-08.c). */
  consentingRows(tx: Tx, ctx: RequestContext, segment: CrmSegment | undefined, now: Date) {
    return this.rows(tx, ctx, { segment, consent: true }, now);
  }

  list(ctx: RequestContext, query: unknown, now = new Date()) {
    const filter = parse(segmentQuery, query);
    return withTenant(this.db, ctx, async (tx) => {
      const all = await this.rows(tx, ctx, { consent: filter.consent }, now);
      const counts = Object.fromEntries(
        CRM_SEGMENTS.map((s) => [s, all.filter((r) => r.segment === s).length]),
      ) as Record<CrmSegment, number>;
      return {
        counts,
        items: (filter.segment ? all.filter((r) => r.segment === filter.segment) : all).slice(
          0,
          500,
        ),
      };
    });
  }

  /**
   * Lista para ofertas (LGPD): só quem aceitou receber e tem e-mail ou telefone. Quem exporta e
   * quantos saíram ficam na auditoria.
   */
  async exportCsv(ctx: RequestContext, query: unknown, now = new Date()) {
    const filter = parse(segmentQuery, query);
    return withTenant(this.db, ctx, async (tx) => {
      const rows = (await this.rows(tx, ctx, { ...filter, consent: true }, now)).filter(
        (r) => r.email || r.phone,
      );
      await this.audit.record(tx, ctx, {
        action: 'crm.exported',
        entity: 'customer',
        data: { segment: filter.segment ?? 'todos', count: rows.length },
      });
      const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
      return toCsv({
        title: 'Clientes que aceitaram ofertas',
        subtitle: '',
        columns: [
          { label: 'Nome' },
          { label: 'E-mail' },
          { label: 'Telefone' },
          { label: 'Segmento' },
          { label: 'Última compra' },
          { label: 'Compras' },
          { label: 'Total' },
        ],
        rows: rows.map((r) => [
          r.name,
          r.email ?? '',
          r.phone ?? '',
          r.segment,
          day(r.lastPurchaseAt),
          String(r.purchases),
          formatBRL(r.totalCents as Cents),
        ]),
      });
    });
  }
}

@Controller('crm')
export class CrmController {
  constructor(@Inject(CrmService) private readonly crm: CrmService) {}

  @Get('customers')
  @RequirePermission('parties.read')
  list(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.crm.list(ctx, query);
  }

  @Get('customers/:id/summary')
  @RequirePermission('parties.read')
  summary(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.crm.summary(ctx, id);
  }

  @Get('export.csv')
  @RequirePermission('crm.export')
  async export(
    @Ctx() ctx: RequestContext,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const csv = await this.crm.exportCsv(ctx, query);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="clientes-ofertas.csv"');
    return new StreamableFile(csv);
  }
}
