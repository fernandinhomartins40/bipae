import { Controller, Get, Header, Inject, Injectable, Query } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, Public, PublicApi, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { parse } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import {
  customers,
  products,
  sales,
  stockMovements,
  stores,
} from '../../db/schema';
import { ApiKeysService } from './api-keys.service';
import { OPENAPI } from './openapi';
import { publicProducts, publicSales } from './public-shapes';

/** Página da API pública: `cursor` é o último id da página anterior (ids UUIDv7, em ordem). */
const page = z.object({
  cursor: z.string().uuid('cursor inválido').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const since = z.string().datetime({ offset: true, message: 'Data e hora no formato ISO 8601' });

function nextCursor<T extends { id: string }>(items: T[], limit: number): string | null {
  return items.length === limit ? items[items.length - 1]!.id : null;
}

/**
 * Leitura pela API pública (F6-01.b, ADR-0016). Dinheiro em centavos (inteiros) e quantidades
 * em milésimos, como no resto do Bipaê. Tudo em `withTenant`: a chave só vê o próprio cliente.
 */
@Injectable()
export class PublicDataService {
  constructor(@Inject(DB) private readonly db: Db) {}

  stores(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ id: stores.id, name: stores.name, companyId: stores.companyId })
        .from(stores)
        .where(storeCondition(ctx, stores.id))
        .orderBy(asc(stores.id));
      return { items: rows };
    });
  }

  products(ctx: RequestContext, query: unknown) {
    const q = parse(page.extend({ updatedSince: since.optional() }), query);
    return withTenant(this.db, ctx, async (tx) => {
      const items = await publicProducts(
        tx,
        and(
          q.cursor ? gt(products.id, q.cursor) : undefined,
          q.updatedSince ? gte(products.updatedAt, new Date(q.updatedSince)) : undefined,
        ),
        q.limit,
      );
      return { items, nextCursor: nextCursor(items, q.limit) };
    });
  }

  stock(ctx: RequestContext, query: unknown) {
    const q = parse(
      z.object({
        productId: z.union([z.string().uuid(), z.array(z.string().uuid()).max(200)]).optional(),
        storeId: z.string().uuid().optional(),
      }),
      query,
    );
    const ids = q.productId === undefined ? undefined : [q.productId].flat();
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          productId: stockMovements.productId,
          storeId: stockMovements.storeId,
          quantityMilli: sql<number>`sum(${stockMovements.deltaMilli})`,
        })
        .from(stockMovements)
        .where(
          and(
            ids ? inArray(stockMovements.productId, ids) : undefined,
            q.storeId ? eq(stockMovements.storeId, q.storeId) : undefined,
            storeCondition(ctx, stockMovements.storeId),
          ),
        )
        .groupBy(stockMovements.productId, stockMovements.storeId)
        .orderBy(asc(stockMovements.productId), asc(stockMovements.storeId));
      return { items: rows.map((r) => ({ ...r, quantityMilli: Number(r.quantityMilli) })) };
    });
  }

  customers(ctx: RequestContext, query: unknown) {
    const q = parse(page.extend({ updatedSince: since.optional() }), query);
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          id: customers.id,
          name: customers.name,
          taxId: customers.taxId,
          email: customers.email,
          phone: customers.phone,
          marketingConsent: customers.marketingConsent,
          updatedAt: customers.updatedAt,
        })
        .from(customers)
        .where(
          and(
            q.cursor ? gt(customers.id, q.cursor) : undefined,
            q.updatedSince ? gte(customers.updatedAt, new Date(q.updatedSince)) : undefined,
          ),
        )
        .orderBy(asc(customers.id))
        .limit(q.limit);
      return {
        items: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
        nextCursor: nextCursor(rows, q.limit),
      };
    });
  }

  sales(ctx: RequestContext, query: unknown) {
    const q = parse(page.extend({ from: since.optional(), to: since.optional() }), query);
    return withTenant(this.db, ctx, async (tx) => {
      const items = await publicSales(
        tx,
        and(
          storeCondition(ctx, sales.storeId),
          q.cursor ? gt(sales.id, q.cursor) : undefined,
          q.from ? gte(sales.occurredAt, new Date(q.from)) : undefined,
          q.to ? lt(sales.occurredAt, new Date(q.to)) : undefined,
        ),
        q.limit,
      );
      return { items, nextCursor: nextCursor(items, q.limit) };
    });
  }
}

/** Rotas da API pública (ADR-0016): aceitam a chave, além do login normal. */
@Controller('public')
export class PublicApiController {
  constructor(
    @Inject(ApiKeysService) private readonly keys: ApiKeysService,
    @Inject(PublicDataService) private readonly data: PublicDataService,
  ) {}

  /** O contrato, aberto para quem for integrar (sem dado de cliente). */
  @Get('openapi.json')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  openapi() {
    return OPENAPI;
  }

  @Get('me')
  @PublicApi()
  me(@Ctx() ctx: RequestContext) {
    return this.keys.me(ctx);
  }

  @Get('stores')
  @PublicApi()
  @RequirePermission('catalog.read')
  stores(@Ctx() ctx: RequestContext) {
    return this.data.stores(ctx);
  }

  @Get('products')
  @PublicApi()
  @RequirePermission('catalog.read')
  products(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.data.products(ctx, query);
  }

  @Get('stock')
  @PublicApi()
  @RequirePermission('catalog.read')
  stock(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.data.stock(ctx, query);
  }

  @Get('customers')
  @PublicApi()
  @RequirePermission('parties.read')
  customers(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.data.customers(ctx, query);
  }

  @Get('sales')
  @PublicApi()
  @RequirePermission('catalog.read')
  sales(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.data.sales(ctx, query);
  }
}
