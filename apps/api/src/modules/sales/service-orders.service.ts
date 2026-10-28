import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  serviceInput,
  serviceOrderDeliverInput,
  serviceOrderInput,
  serviceOrderStatusInput,
  uuidv7,
  type ServiceOrderView,
  type ServiceView,
} from '@bipae/domain';
import { findNfseService } from '@bipae/fiscal/tables';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, canUseStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  customers,
  financialEntries,
  products,
  serviceOrderItems,
  serviceOrders,
  services,
  stockMovements,
  stores,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { localToday } from './conditionals.service';

type OrderRow = typeof serviceOrders.$inferSelect;
type OrderInput = z.output<typeof serviceOrderInput>;
const lineTotal = (priceCents: number, milli: number) => Math.round((priceCents * milli) / 1000);

const serviceView = (row: typeof services.$inferSelect): ServiceView => ({
  id: row.id,
  name: row.name,
  code: row.code,
  codeDescription: findNfseService(row.code)?.description ?? null,
  nbs: row.nbs,
  issRate: row.issRate,
  priceCents: row.priceCents,
  active: row.active,
});

/**
 * Serviços e ordem de serviço (F5-13.c). O serviço leva o código da lista nacional (para a
 * NFS-e) e a alíquota do ISSQN do município. A OS junta o cliente, o que ele trouxe, os serviços
 * e as peças; ao entregar, as peças saem do estoque e o total vira conta a receber. A NFS-e dos
 * serviços sai da OS (F5-13.d).
 */
@Injectable()
export class ServiceOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- serviços

  listServices(ctx: RequestContext, q?: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(services)
        .where(q?.trim() ? sql`${services.name} ilike ${`%${q.trim()}%`}` : undefined)
        .orderBy(asc(services.name))
        .limit(300);
      return rows.map(serviceView);
    });
  }

  private assertCode(code: string) {
    if (!findNfseService(code)) {
      throw new AppError(422, 'invalid_service_code', 'Código fora da lista nacional de serviços.');
    }
  }

  createService(ctx: RequestContext, input: z.output<typeof serviceInput>) {
    this.assertCode(input.code);
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(services)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
        .returning();
      return serviceView(row!);
    });
  }

  updateService(ctx: RequestContext, id: string, input: z.output<typeof serviceInput>) {
    this.assertCode(input.code);
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(services)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(services.id, id))
        .returning();
      if (!row) throw notFound('Serviço');
      return serviceView(row);
    });
  }

  // ---------------------------------------------------------------- ordens de serviço

  private async views(tx: Tx, rows: OrderRow[]): Promise<ServiceOrderView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [storeRows, customerRows, items] = await Promise.all([
      tx
        .select({ id: stores.id, name: stores.name })
        .from(stores)
        .where(inArray(stores.id, [...new Set(rows.map((r) => r.storeId))])),
      tx
        .select({ id: customers.id, name: customers.name, taxId: customers.taxId })
        .from(customers)
        .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))])),
      tx
        .select()
        .from(serviceOrderItems)
        .where(inArray(serviceOrderItems.orderId, ids))
        .orderBy(asc(serviceOrderItems.line)),
    ]);
    return rows.map((r) => {
      const mine = items
        .filter((i) => i.orderId === r.id)
        .map((i) => ({
          line: i.line,
          kind: i.kind,
          serviceId: i.serviceId,
          productId: i.productId,
          description: i.description,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          totalCents: lineTotal(i.unitPriceCents, i.quantityMilli),
        }));
      const sum = (kind: 'service' | 'product') =>
        mine.filter((i) => i.kind === kind).reduce((t, i) => t + i.totalCents, 0);
      const customer = customerRows.find((c) => c.id === r.customerId);
      return {
        id: r.id,
        number: r.number,
        storeId: r.storeId,
        storeName: storeRows.find((s) => s.id === r.storeId)?.name ?? 'Loja',
        customerId: r.customerId,
        customerName: customer?.name ?? 'Cliente',
        customerTaxId: customer?.taxId ?? null,
        status: r.status,
        equipment: r.equipment,
        problem: r.problem,
        notes: r.notes,
        dueOn: r.dueOn,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        items: mine,
        servicesCents: sum('service'),
        productsCents: sum('product'),
        totalCents: sum('service') + sum('product'),
      };
    });
  }

  list(ctx: RequestContext, status?: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(serviceOrders)
        .where(
          and(
            storeCondition(ctx, serviceOrders.storeId),
            (SERVICE_STATUS as readonly string[]).includes(status ?? '')
              ? eq(serviceOrders.status, status as OrderRow['status'])
              : undefined,
          ),
        )
        .orderBy(desc(serviceOrders.createdAt))
        .limit(200);
      return this.views(tx, rows);
    });
  }

  private async load(tx: Tx, ctx: RequestContext, id: string) {
    const [row] = await tx.select().from(serviceOrders).where(eq(serviceOrders.id, id));
    if (!row || !canUseStore(ctx, row.storeId)) throw notFound('Ordem de serviço');
    return row;
  }

  get(ctx: RequestContext, id: string) {
    return withTenant(
      this.db,
      ctx,
      async (tx) => (await this.views(tx, [await this.load(tx, ctx, id)]))[0]!,
    );
  }

  /** Grava os itens da OS, com a descrição do cadastro quando a pessoa não escreveu outra. */
  private async writeItems(tx: Tx, ctx: RequestContext, orderId: string, input: OrderInput) {
    const serviceIds = input.items.flatMap((i) => (i.serviceId ? [i.serviceId] : []));
    const productIds = input.items.flatMap((i) => (i.productId ? [i.productId] : []));
    const [svc, prod] = await Promise.all([
      serviceIds.length
        ? tx.select().from(services).where(inArray(services.id, serviceIds))
        : Promise.resolve([] as (typeof services.$inferSelect)[]),
      productIds.length
        ? tx.select().from(products).where(inArray(products.id, productIds))
        : Promise.resolve([] as (typeof products.$inferSelect)[]),
    ]);
    await tx.delete(serviceOrderItems).where(eq(serviceOrderItems.orderId, orderId));
    if (input.items.length === 0) return;
    await tx.insert(serviceOrderItems).values(
      input.items.map((i, index) => {
        const name =
          i.kind === 'service'
            ? svc.find((s) => s.id === i.serviceId)?.name
            : prod.find((p) => p.id === i.productId)?.name;
        if (!name) throw notFound(i.kind === 'service' ? 'Serviço' : 'Produto');
        return {
          tenantId: ctx.tenantId,
          orderId,
          line: index + 1,
          kind: i.kind,
          serviceId: i.kind === 'service' ? i.serviceId! : null,
          productId: i.kind === 'product' ? i.productId! : null,
          description: i.description || name,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
        };
      }),
    );
  }

  async create(ctx: RequestContext, input: OrderInput) {
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [customer] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.id, input.customerId));
      if (!customer) throw notFound('Cliente');
      // Número em sequência por loja, sem repetir com criações simultâneas (PIE R3-07).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`service-order:${input.storeId}`}, 0))`,
      );
      const [last] = await tx
        .select({ n: sql<number>`coalesce(max(${serviceOrders.number}), 0)` })
        .from(serviceOrders)
        .where(eq(serviceOrders.storeId, input.storeId));
      const number = Number(last?.n ?? 0) + 1;
      const id = uuidv7();
      const [row] = await tx
        .insert(serviceOrders)
        .values({
          id,
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          number,
          customerId: customer.id,
          equipment: input.equipment ?? null,
          problem: input.problem ?? null,
          notes: input.notes ?? null,
          dueOn: input.dueOn ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      await this.writeItems(tx, ctx, id, input);
      await this.audit.record(tx, ctx, {
        action: 'service_order.created',
        entity: 'service_order',
        entityId: id,
        data: { number, customer: customer.name },
      });
      return (await this.views(tx, [row!]))[0]!;
    });
  }

  async update(ctx: RequestContext, id: string, input: OrderInput) {
    return withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status === 'delivered' || row.status === 'cancelled') {
        throw new AppError(409, 'service_order_closed', 'Esta OS já foi entregue ou cancelada.');
      }
      const [customer] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, input.customerId));
      if (!customer) throw notFound('Cliente');
      const [updated] = await tx
        .update(serviceOrders)
        .set({
          customerId: customer.id,
          equipment: input.equipment ?? null,
          problem: input.problem ?? null,
          notes: input.notes ?? null,
          dueOn: input.dueOn ?? null,
          updatedAt: new Date(),
        })
        .where(eq(serviceOrders.id, id))
        .returning();
      await this.writeItems(tx, ctx, id, input);
      return (await this.views(tx, [updated!]))[0]!;
    });
  }

  async setStatus(
    ctx: RequestContext,
    id: string,
    status: z.output<typeof serviceOrderStatusInput>['status'],
  ) {
    return withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status === 'delivered' || row.status === 'cancelled') {
        throw new AppError(409, 'service_order_closed', 'Esta OS já foi entregue ou cancelada.');
      }
      const [updated] = await tx
        .update(serviceOrders)
        .set({ status, updatedAt: new Date() })
        .where(eq(serviceOrders.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: status === 'cancelled' ? 'service_order.cancelled' : 'service_order.status',
        entity: 'service_order',
        entityId: id,
        data: { number: row.number, from: row.status, to: status },
      });
      return (await this.views(tx, [updated!]))[0]!;
    });
  }

  /** Entrega: as peças saem do estoque e o total vira conta a receber do cliente. */
  async deliver(ctx: RequestContext, id: string, input: z.output<typeof serviceOrderDeliverInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status === 'delivered' || row.status === 'cancelled') {
        throw new AppError(409, 'service_order_closed', 'Esta OS já foi entregue ou cancelada.');
      }
      const [view] = await this.views(tx, [row]);
      if (!view || view.items.length === 0) {
        throw new AppError(
          422,
          'service_order_empty',
          'A OS precisa de pelo menos um serviço ou peça.',
        );
      }
      const now = new Date();
      for (const item of view.items.filter((i) => i.kind === 'product')) {
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: row.storeId,
          productId: item.productId!,
          deltaMilli: -item.quantityMilli,
          reason: 'service_order',
          refId: row.id,
          note: `OS nº ${row.number} · ${view.customerName}`,
          actorId: ctx.userId,
          occurredAt: now,
        });
      }
      const [store] = await tx
        .select({ companyId: stores.companyId })
        .from(stores)
        .where(eq(stores.id, row.storeId));
      if (view.totalCents > 0) {
        await tx.insert(financialEntries).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          companyId: store!.companyId,
          kind: 'receivable',
          description: `OS nº ${row.number} · ${view.customerName}`,
          category: 'Serviços',
          customerId: row.customerId,
          document: view.customerTaxId,
          amountCents: view.totalCents,
          dueDate: input.dueDate ?? localToday(),
          groupId: uuidv7(),
          serviceOrderId: row.id,
          createdBy: ctx.userId,
        });
      }
      const [updated] = await tx
        .update(serviceOrders)
        .set({ status: 'delivered', deliveredAt: now, updatedAt: now })
        .where(eq(serviceOrders.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'service_order.delivered',
        entity: 'service_order',
        entityId: id,
        data: { number: row.number, totalCents: view.totalCents },
      });
      return (await this.views(tx, [updated!]))[0]!;
    });
  }
}

const SERVICE_STATUS = ['open', 'in_progress', 'ready', 'delivered', 'cancelled'] as const;

@Controller('services')
export class ServicesController {
  constructor(@Inject(ServiceOrdersService) private readonly orders: ServiceOrdersService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext, @Query('q') q?: string) {
    return this.orders.listServices(ctx, q);
  }

  @Post()
  @RequirePermission('catalog.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.orders.createService(ctx, parse(serviceInput, body));
  }

  @Put(':id')
  @RequirePermission('catalog.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.updateService(ctx, id, parse(serviceInput, body));
  }
}

@Controller('service-orders')
export class ServiceOrdersController {
  constructor(@Inject(ServiceOrdersService) private readonly orders: ServiceOrdersService) {}

  @Get()
  @RequirePermission('pos.sell')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.orders.list(ctx, status);
  }

  @Get(':id')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.get(ctx, id);
  }

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.orders.create(ctx, parse(serviceOrderInput, body));
  }

  @Put(':id')
  @RequirePermission('pos.sell')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.update(ctx, id, parse(serviceOrderInput, body));
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  status(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.setStatus(ctx, id, parse(serviceOrderStatusInput, body).status);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  deliver(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.orders.deliver(ctx, id, parse(serviceOrderDeliverInput, body));
  }
}
