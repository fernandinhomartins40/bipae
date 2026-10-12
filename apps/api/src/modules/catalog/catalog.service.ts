import { Inject, Injectable } from '@nestjs/common';
import {
  fiscalProfileInput,
  hasPermission,
  priceTableInput,
  productInput,
  unitInput,
  uuidv7,
  type Page,
  type Product,
} from '@bipae/domain';
import { asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, forbidden, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  fiscalProfiles,
  priceTableItems,
  priceTables,
  productBarcodes,
  productComponents,
  products,
  units,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type ProductData = z.output<typeof productInput>;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- products

  async listProducts(
    ctx: RequestContext,
    query: { q?: string | undefined; limit: number; offset: number },
  ): Promise<Page<Product>> {
    return withTenant(this.db, ctx, async (tx) => {
      let where: SQL | undefined;
      if (query.q) {
        const term = query.q.trim();
        where = or(
          ilike(products.name, `%${term.replace(/[%_\\]/g, '\\$&')}%`),
          eq(products.sku, term),
          sql`exists (select 1 from product_barcodes b where b.product_id = ${products.id} and b.code = ${term})`,
        );
      }
      const rows = await tx
        .select()
        .from(products)
        .where(where)
        .orderBy(asc(sql`lower(${products.name})`))
        .limit(query.limit)
        .offset(query.offset);
      const [total] = await tx.select({ n: count() }).from(products).where(where);
      return { items: await this.hydrate(tx, rows), total: total?.n ?? 0 };
    });
  }

  async getProduct(ctx: RequestContext, id: string): Promise<Product> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(products).where(eq(products.id, id));
      if (!row) throw notFound('Produto');
      return (await this.hydrate(tx, [row]))[0]!;
    });
  }

  async createProduct(ctx: RequestContext, input: ProductData): Promise<Product> {
    return withTenant(this.db, ctx, async (tx) => {
      const id = uuidv7();
      await tx.insert(products).values({ id, tenantId: ctx.tenantId, ...this.columns(input) });
      await this.replaceChildren(tx, ctx.tenantId, id, input);
      await this.audit.record(tx, ctx, {
        action: 'product.created',
        entity: 'product',
        entityId: id,
        data: { name: input.name, priceCents: input.priceCents },
      });
      const [row] = await tx.select().from(products).where(eq(products.id, id));
      return (await this.hydrate(tx, [row!]))[0]!;
    });
  }

  async updateProduct(ctx: RequestContext, id: string, input: ProductData): Promise<Product> {
    return withTenant(this.db, ctx, async (tx) => {
      const [current] = await tx.select().from(products).where(eq(products.id, id));
      if (!current) throw notFound('Produto');
      if (input.parentId === id) {
        throw new AppError(400, 'validation', 'Um produto não pode ser variação de si mesmo.');
      }
      const priceChanged = current.priceCents !== input.priceCents;
      if (priceChanged && !hasPermission(ctx.permissions, 'catalog.price.write')) throw forbidden();

      await tx
        .update(products)
        .set({
          ...this.columns(input),
          version: sql`${products.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));
      await this.replaceChildren(tx, ctx.tenantId, id, input);
      await this.audit.record(tx, ctx, {
        action: priceChanged ? 'product.price_changed' : 'product.updated',
        entity: 'product',
        entityId: id,
        data: priceChanged
          ? { before: current.priceCents, after: input.priceCents }
          : { name: input.name },
      });
      const [row] = await tx.select().from(products).where(eq(products.id, id));
      return (await this.hydrate(tx, [row!]))[0]!;
    });
  }

  private columns(input: ProductData) {
    return {
      name: input.name,
      sku: input.sku ?? null,
      unit: input.unit,
      priceCents: input.priceCents,
      costCents: input.costCents ?? null,
      ncm: input.ncm ?? null,
      cest: input.cest ?? null,
      isWeighable: input.isWeighable,
      tracksLot: input.tracksLot,
      active: input.active,
      fiscalProfileId: input.fiscalProfileId ?? null,
      parentId: input.parentId ?? null,
      attributes: input.attributes ?? null,
    };
  }

  private async replaceChildren(tx: Tx, tenantId: string, productId: string, input: ProductData) {
    await tx.delete(productBarcodes).where(eq(productBarcodes.productId, productId));
    const codes = [...new Set(input.barcodes)];
    if (codes.length > 0) {
      await tx.insert(productBarcodes).values(codes.map((code) => ({ tenantId, code, productId })));
    }
    await tx.delete(productComponents).where(eq(productComponents.productId, productId));
    if (input.components.length > 0) {
      if (input.components.some((c) => c.productId === productId)) {
        throw new AppError(400, 'validation', 'Um kit não pode conter a si mesmo.');
      }
      await tx.insert(productComponents).values(
        input.components.map((c) => ({
          tenantId,
          productId,
          componentId: c.productId,
          quantity: c.quantity,
        })),
      );
    }
  }

  private async hydrate(tx: Tx, rows: (typeof products.$inferSelect)[]): Promise<Product[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const barcodes = await tx
      .select()
      .from(productBarcodes)
      .where(inArray(productBarcodes.productId, ids))
      .orderBy(asc(productBarcodes.code));
    const components = await tx
      .select()
      .from(productComponents)
      .where(inArray(productComponents.productId, ids));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcodes: barcodes.filter((b) => b.productId === r.id).map((b) => b.code),
      unit: r.unit,
      priceCents: r.priceCents,
      costCents: r.costCents,
      ncm: r.ncm,
      cest: r.cest,
      isWeighable: r.isWeighable,
      tracksLot: r.tracksLot,
      active: r.active,
      fiscalProfileId: r.fiscalProfileId,
      parentId: r.parentId,
      attributes: r.attributes,
      components: components
        .filter((c) => c.productId === r.id)
        .map((c) => ({ productId: c.componentId, quantity: Number(c.quantity) })),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- units

  listUnits(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) => tx.select().from(units).orderBy(asc(units.code)));
  }

  async createUnit(ctx: RequestContext, input: z.output<typeof unitInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({ tenantId: ctx.tenantId, ...input })
        .returning();
      return row!;
    });
  }

  // ---------------------------------------------------------------- fiscal profiles

  listFiscalProfiles(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx.select().from(fiscalProfiles).orderBy(asc(fiscalProfiles.name)),
    );
  }

  async saveFiscalProfile(
    ctx: RequestContext,
    id: string | null,
    input: z.output<typeof fiscalProfileInput>,
  ) {
    const { name, ...data } = input;
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = id
        ? await tx
            .update(fiscalProfiles)
            .set({ name, data, updatedAt: new Date() })
            .where(eq(fiscalProfiles.id, id))
            .returning()
        : await tx
            .insert(fiscalProfiles)
            .values({ id: uuidv7(), tenantId: ctx.tenantId, name, data })
            .returning();
      if (!row) throw notFound('Perfil fiscal');
      await this.audit.record(tx, ctx, {
        action: id ? 'fiscal_profile.updated' : 'fiscal_profile.created',
        entity: 'fiscal_profile',
        entityId: row.id,
        data: input,
      });
      return row;
    });
  }

  // ---------------------------------------------------------------- price tables

  listPriceTables(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const tables = await tx.select().from(priceTables).orderBy(asc(priceTables.name));
      const items = tables.length
        ? await tx
            .select()
            .from(priceTableItems)
            .where(
              inArray(
                priceTableItems.priceTableId,
                tables.map((t) => t.id),
              ),
            )
        : [];
      return tables.map((t) => ({
        ...t,
        items: items
          .filter((i) => i.priceTableId === t.id)
          .map((i) => ({ productId: i.productId, priceCents: i.priceCents })),
      }));
    });
  }

  async savePriceTable(
    ctx: RequestContext,
    id: string | null,
    input: z.output<typeof priceTableInput>,
  ) {
    return withTenant(this.db, ctx, async (tx) => {
      const tableId = id ?? uuidv7();
      if (id) {
        const [row] = await tx
          .update(priceTables)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(priceTables.id, id))
          .returning();
        if (!row) throw notFound('Tabela de preço');
        await tx.delete(priceTableItems).where(eq(priceTableItems.priceTableId, id));
      } else {
        await tx
          .insert(priceTables)
          .values({ id: tableId, tenantId: ctx.tenantId, name: input.name });
      }
      if (input.items.length > 0) {
        await tx.insert(priceTableItems).values(
          input.items.map((i) => ({
            tenantId: ctx.tenantId,
            priceTableId: tableId,
            productId: i.productId,
            priceCents: i.priceCents,
          })),
        );
      }
      await this.audit.record(tx, ctx, {
        action: id ? 'price_table.updated' : 'price_table.created',
        entity: 'price_table',
        entityId: tableId,
        data: { name: input.name, items: input.items.length },
      });
      return { id: tableId, name: input.name, items: input.items };
    });
  }
}

