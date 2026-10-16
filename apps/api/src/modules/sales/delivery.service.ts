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
import { deliveryZoneInput, uuidv7, type DeliveryView, type DeliveryZoneView } from '@bipae/domain';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import { deliveryZones, sales, stores } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const zoneView = (z: typeof deliveryZones.$inferSelect): DeliveryZoneView => ({
  id: z.id,
  storeId: z.storeId,
  name: z.name,
  feeCents: z.feeCents,
  active: z.active,
});

const NEXT: Record<'out' | 'delivered', string[]> = {
  out: ['pending'],
  delivered: ['pending', 'out'],
};

/**
 * Delivery com taxa por bairro (F5-10). Cada loja cadastra os bairros que atende e a taxa; os
 * bairros vão ao caixa no retrato de preços. A venda para entrega chega pela sincronização com
 * o endereço; aqui se acompanha de "a sair" até "entregue". A taxa é preço: mudar entra na
 * auditoria.
 */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  zones(ctx: RequestContext, storeId?: string): Promise<DeliveryZoneView[]> {
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select()
          .from(deliveryZones)
          .where(
            and(
              storeId ? eq(deliveryZones.storeId, storeId) : undefined,
              storeCondition(ctx, deliveryZones.storeId),
            ),
          )
          .orderBy(asc(deliveryZones.name))
      ).map(zoneView),
    );
  }

  async saveZone(ctx: RequestContext, id: string | null, body: unknown) {
    const input = parse(deliveryZoneInput, body);
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const [same] = await tx
        .select({ id: deliveryZones.id })
        .from(deliveryZones)
        .where(
          and(
            eq(deliveryZones.storeId, input.storeId),
            sql`lower(${deliveryZones.name}) = lower(${input.name})`,
          ),
        );
      if (same && same.id !== id) {
        throw new AppError(409, 'duplicate_zone', `O bairro ${input.name} já está cadastrado.`);
      }
      let row: typeof deliveryZones.$inferSelect | undefined;
      if (id) {
        const [before] = await tx.select().from(deliveryZones).where(eq(deliveryZones.id, id));
        if (!before) throw notFound('Bairro');
        [row] = await tx
          .update(deliveryZones)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(deliveryZones.id, id))
          .returning();
        await this.audit.record(tx, ctx, {
          action: 'delivery_zone.updated',
          entity: 'delivery_zone',
          entityId: id,
          data: { name: input.name, before: before.feeCents, after: input.feeCents },
        });
      } else {
        [row] = await tx
          .insert(deliveryZones)
          .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
          .returning();
        await this.audit.record(tx, ctx, {
          action: 'delivery_zone.created',
          entity: 'delivery_zone',
          entityId: row!.id,
          data: { name: input.name, feeCents: input.feeCents },
        });
      }
      return zoneView(row!);
    });
  }

  /** Entregas das últimas 24 horas (as entregues ficam para conferência). */
  deliveries(ctx: RequestContext, storeId?: string): Promise<DeliveryView[]> {
    return withTenant(this.db, ctx, async (tx) =>
      (
        await tx
          .select()
          .from(sales)
          .where(
            and(
              sql`${sales.delivery} is not null`,
              eq(sales.status, 'completed'),
              storeId ? eq(sales.storeId, storeId) : undefined,
              storeCondition(ctx, sales.storeId),
              gte(sales.occurredAt, sql`now() - interval '1 day'`),
            ),
          )
          .orderBy(desc(sales.occurredAt))
          .limit(300)
      ).map((s) => ({
        saleId: s.id,
        storeId: s.storeId,
        terminalSeq: s.terminalSeq,
        totalCents: s.totalCents,
        occurredAt: s.occurredAt.toISOString(),
        status: s.deliveryStatus ?? 'pending',
        updatedAt: (s.deliveryUpdatedAt ?? s.occurredAt).toISOString(),
        delivery: s.delivery!,
      })),
    );
  }

  async advance(ctx: RequestContext, saleId: string, to: 'out' | 'delivered') {
    return withTenant(this.db, ctx, async (tx) => {
      const [sale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, saleId), storeCondition(ctx, sales.storeId)));
      if (!sale?.delivery) throw notFound('Entrega');
      if (!NEXT[to].includes(sale.deliveryStatus ?? 'pending')) {
        throw new AppError(409, 'invalid_state', 'Esta entrega já mudou de situação.');
      }
      await tx
        .update(sales)
        .set({ deliveryStatus: to, deliveryUpdatedAt: new Date() })
        .where(and(eq(sales.id, saleId), inArray(sales.deliveryStatus, NEXT[to] as never)));
      return { saleId, status: to };
    });
  }
}

@Controller()
export class DeliveryController {
  constructor(@Inject(DeliveryService) private readonly delivery: DeliveryService) {}

  @Get('delivery-zones')
  @RequirePermission('catalog.read')
  zones(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string) {
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return this.delivery.zones(ctx, storeId);
  }

  @Post('delivery-zones')
  @RequirePermission('catalog.price.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.delivery.saveZone(ctx, null, body);
  }

  @Put('delivery-zones/:id')
  @RequirePermission('catalog.price.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.delivery.saveZone(ctx, id, body);
  }

  @Get('deliveries')
  @RequirePermission('pos.sell')
  deliveries(@Ctx() ctx: RequestContext, @Query('storeId') storeId?: string) {
    if (storeId && !/^[0-9a-f-]{36}$/i.test(storeId)) {
      throw new AppError(422, 'invalid_store', 'Loja inválida.');
    }
    return this.delivery.deliveries(ctx, storeId);
  }

  @Post('deliveries/:saleId/out')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  out(@Ctx() ctx: RequestContext, @Param('saleId', new ParseUUIDPipe()) saleId: string) {
    return this.delivery.advance(ctx, saleId, 'out');
  }

  @Post('deliveries/:saleId/delivered')
  @HttpCode(200)
  @RequirePermission('pos.sell')
  delivered(@Ctx() ctx: RequestContext, @Param('saleId', new ParseUUIDPipe()) saleId: string) {
    return this.delivery.advance(ctx, saleId, 'delivered');
  }
}
