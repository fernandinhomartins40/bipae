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
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
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
  productPacks,
  productComponents,
  products,
  units,
} from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';
import { assertFiscalProfile, assertProductFiscal } from '../fiscal/fiscal-validation';
import { MercadoflowContributions } from '../mercadoflow/mercadoflow.contributions';
import { MercadoflowMarketSync } from '../mercadoflow/mercadoflow.market-sync';

type ProductData = z.output<typeof productInput>;

/** Preço de atacado (F5-03): mais barato que o de varejo e, no produto por unidade, inteiro. */
function assertWholesale(input: ProductData) {
  if (!input.wholesale) return;
  if (input.wholesale.priceCents >= input.priceCents) {
    throw new AppError(
      422,
      'invalid_wholesale',
      'O preço de atacado precisa ser menor que o preço de venda.',
    );
  }
  if (!input.isWeighable && input.wholesale.minQuantityMilli % 1000 !== 0) {
    throw new AppError(
      422,
      'invalid_wholesale',
      'A quantidade do atacado precisa ser inteira para produto vendido por unidade.',
    );
  }
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LimitsService) private readonly limits: LimitsService,
    @Inject(MercadoflowContributions) private readonly contributions: MercadoflowContributions,
    @Inject(MercadoflowMarketSync) private readonly marketSync: MercadoflowMarketSync,
  ) {}

  // ---------------------------------------------------------------- products

  async listProducts(
    ctx: RequestContext,
    query: { q?: string | undefined; limit: number; offset: number; parentId?: string | undefined },
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
      if (query.parentId) where = and(where, eq(products.parentId, query.parentId));
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
    assertProductFiscal(input);
    assertWholesale(input);
    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'products');
      const id = uuidv7();
      await tx.insert(products).values({ id, tenantId: ctx.tenantId, ...this.columns(input) });
      await this.replaceChildren(tx, ctx.tenantId, id, input);
      await this.contributions.enqueue(tx, ctx.tenantId, input);
      await this.marketSync.enqueueProduct(tx, ctx.tenantId, {
        id,
        ...this.columns(input),
        barcodes: input.barcodes,
      });
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
      // Só confere o código fiscal que mudou: um NCM extinto depois do cadastro não pode impedir
      // o lojista de corrigir o preço ou o nome do produto.
      assertProductFiscal({
        ncm: (input.ncm ?? null) === current.ncm ? null : input.ncm,
        cest: (input.cest ?? null) === current.cest ? null : input.cest,
      });
      // Preço de atacado também é preço: pede a mesma permissão e entra na auditoria.
      const wholesaleChanged =
        current.wholesalePriceCents !== (input.wholesale?.priceCents ?? null) ||
        current.wholesaleMinMilli !== (input.wholesale?.minQuantityMilli ?? null);
      const priceChanged = current.priceCents !== input.priceCents || wholesaleChanged;
      assertWholesale(input);
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
      // Só dado cadastral vai ao catálogo: mudar só o preço não gera envio.
      if (!priceChanged || current.name !== input.name || current.ncm !== (input.ncm ?? null)) {
        await this.contributions.enqueue(tx, ctx.tenantId, input);
      }
      // Lojas vinculadas ao MercadoFlow recebem o cadastro, o preço e o custo novos.
      await this.marketSync.enqueueProduct(tx, ctx.tenantId, {
        id,
        ...this.columns(input),
        barcodes: input.barcodes,
      });
      await this.audit.record(tx, ctx, {
        action: priceChanged ? 'product.price_changed' : 'product.updated',
        entity: 'product',
        entityId: id,
        data: priceChanged
          ? {
              before: current.priceCents,
              after: input.priceCents,
              ...(wholesaleChanged && {
                wholesaleBefore:
                  current.wholesalePriceCents === null
                    ? null
                    : {
                        minQuantityMilli: current.wholesaleMinMilli,
                        priceCents: current.wholesalePriceCents,
                      },
                wholesaleAfter: input.wholesale ?? null,
              }),
            }
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
      kitchen: input.kitchen,
      ingredient: input.ingredient,
      active: input.active,
      fiscalProfileId: input.fiscalProfileId ?? null,
      parentId: input.parentId ?? null,
      attributes: input.attributes ?? null,
      catalog: input.catalog ?? null,
      wholesalePriceCents: input.wholesale?.priceCents ?? null,
      wholesaleMinMilli: input.wholesale?.minQuantityMilli ?? null,
    };
  }

  private async replaceChildren(tx: Tx, tenantId: string, productId: string, input: ProductData) {
    await tx.delete(productBarcodes).where(eq(productBarcodes.productId, productId));
    const codes = [...new Set(input.barcodes)];
    if (codes.length > 0) {
      await tx.insert(productBarcodes).values(codes.map((code) => ({ tenantId, code, productId })));
    }
    // Embalagens de compra (caixa, fardo): um código só pode ser de um produto.
    await tx.delete(productPacks).where(eq(productPacks.productId, productId));
    if (input.packs.length > 0) {
      await tx
        .insert(productPacks)
        .values(
          input.packs.map((p) => ({
            tenantId,
            productId,
            packGtin: p.packGtin,
            unitsPerPack: p.unitsPerPack,
          })),
        )
        .onConflictDoUpdate({
          target: [productPacks.tenantId, productPacks.packGtin],
          set: { productId, unitsPerPack: sql`excluded.units_per_pack` },
        });
    }
    await tx.delete(productComponents).where(eq(productComponents.productId, productId));
    if (input.components.length > 0) {
      if (input.components.some((c) => c.productId === productId)) {
        throw new AppError(400, 'validation', 'Um kit não pode conter a si mesmo.');
      }
      const ids = [...new Set(input.components.map((c) => c.productId))];
      // A checagem de chave estrangeira ignora o RLS: confirma que os componentes são desta empresa.
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, ids));
      if (found.length !== ids.length) {
        throw new AppError(400, 'validation', 'Um dos componentes do kit não existe.');
      }
      // Um nível só, para a baixa de estoque ser simples e previsível.
      const nested = await tx
        .select({ id: productComponents.productId })
        .from(productComponents)
        .where(inArray(productComponents.productId, ids))
        .limit(1);
      if (nested.length > 0) {
        throw new AppError(400, 'validation', 'Um kit não pode ter outro kit como componente.');
      }
      const usedIn = await tx
        .select({ id: productComponents.productId })
        .from(productComponents)
        .where(eq(productComponents.componentId, productId))
        .limit(1);
      if (usedIn.length > 0) {
        throw new AppError(
          400,
          'validation',
          'Este produto já é componente de um kit e não pode virar kit.',
        );
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
    // Nome do componente junto, para a tela do kit não precisar buscar produto por produto.
    const components = await tx
      .select({
        productId: productComponents.productId,
        componentId: productComponents.componentId,
        quantity: productComponents.quantity,
        name: products.name,
        unit: products.unit,
        costCents: products.costCents,
      })
      .from(productComponents)
      .innerJoin(products, eq(products.id, productComponents.componentId))
      .where(inArray(productComponents.productId, ids));
    const packs = await tx.select().from(productPacks).where(inArray(productPacks.productId, ids));
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
      kitchen: r.kitchen,
      ingredient: r.ingredient,
      active: r.active,
      fiscalProfileId: r.fiscalProfileId,
      parentId: r.parentId,
      attributes: r.attributes,
      components: components
        .filter((c) => c.productId === r.id)
        .map((c) => ({
          productId: c.componentId,
          quantity: Number(c.quantity),
          name: c.name,
          unit: c.unit,
          costCents: c.costCents,
        })),
      catalog: (r.catalog as Product['catalog']) ?? null,
      packs: packs
        .filter((p) => p.productId === r.id)
        .map((p) => ({ packGtin: p.packGtin, unitsPerPack: p.unitsPerPack })),
      wholesale:
        r.wholesalePriceCents !== null && r.wholesaleMinMilli !== null
          ? { minQuantityMilli: r.wholesaleMinMilli, priceCents: r.wholesalePriceCents }
          : null,
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
    assertFiscalProfile(input);
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
      // Nome e preço normal já vêm junto, para as telas não precisarem carregar o catálogo inteiro.
      const items = tables.length
        ? await tx
            .select({
              priceTableId: priceTableItems.priceTableId,
              productId: priceTableItems.productId,
              priceCents: priceTableItems.priceCents,
              name: products.name,
              basePriceCents: products.priceCents,
            })
            .from(priceTableItems)
            .innerJoin(products, eq(products.id, priceTableItems.productId))
            .where(
              inArray(
                priceTableItems.priceTableId,
                tables.map((t) => t.id),
              ),
            )
            .orderBy(asc(products.name))
        : [];
      return tables.map((t) => ({
        ...t,
        items: items
          .filter((i) => i.priceTableId === t.id)
          .map(({ priceTableId: _, ...item }) => item),
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
