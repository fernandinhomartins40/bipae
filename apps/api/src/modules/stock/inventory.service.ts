import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { inventoryCountInput, inventoryInput, uuidv7, type InventoryView } from '@bipae/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  inventories,
  inventoryCounts,
  productBarcodes,
  products,
  stockMovements,
  stores,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type CountInput = z.output<typeof inventoryCountInput>;

/**
 * Inventário pelo celular (F4-11). Uma contagem aberta por loja; cada bipe soma, ou a pessoa
 * digita o total. Ao fechar, cada produto contado vira um ajuste de estoque pela diferença com
 * o saldo daquele momento; o que não foi contado não muda.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async view(tx: Tx, ctx: RequestContext, id: string): Promise<InventoryView> {
    const [row] = await tx
      .select({ inv: inventories, storeName: stores.name })
      .from(inventories)
      .innerJoin(stores, eq(stores.id, inventories.storeId))
      .where(eq(inventories.id, id));
    if (!row) throw notFound('Inventário');
    assertStore(ctx, row.inv.storeId);
    const counts = await tx
      .select({ c: inventoryCounts, name: products.name, unit: products.unit })
      .from(inventoryCounts)
      .innerJoin(products, eq(products.id, inventoryCounts.productId))
      .where(eq(inventoryCounts.inventoryId, id))
      .orderBy(desc(inventoryCounts.updatedAt));
    const balances = counts.length
      ? await tx
          .select({
            productId: stockMovements.productId,
            q: sql<string>`coalesce(sum(${stockMovements.deltaMilli}), 0)::text`,
          })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.storeId, row.inv.storeId),
              inArray(
                stockMovements.productId,
                counts.map((c) => c.c.productId),
              ),
            ),
          )
          .groupBy(stockMovements.productId)
      : [];
    return {
      id: row.inv.id,
      storeId: row.inv.storeId,
      storeName: row.storeName,
      name: row.inv.name,
      status: row.inv.status,
      createdAt: row.inv.createdAt.toISOString(),
      closedAt: row.inv.closedAt?.toISOString() ?? null,
      items: counts.map(({ c, name, unit }) => ({
        productId: c.productId,
        productName: name,
        unit,
        countedMilli: c.countedMilli,
        systemMilli: Number(balances.find((b) => b.productId === c.productId)?.q ?? 0),
      })),
    };
  }

  async list(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ inv: inventories, storeName: stores.name })
        .from(inventories)
        .innerJoin(stores, eq(stores.id, inventories.storeId))
        .where(storeCondition(ctx, inventories.storeId))
        .orderBy(desc(inventories.createdAt))
        .limit(50);
      return rows.map(({ inv, storeName }) => ({
        id: inv.id,
        name: inv.name,
        storeName,
        status: inv.status,
        createdAt: inv.createdAt.toISOString(),
        closedAt: inv.closedAt?.toISOString() ?? null,
      }));
    });
  }

  get(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, (tx) => this.view(tx, ctx, id));
  }

  async create(ctx: RequestContext, input: z.output<typeof inventoryInput>) {
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const [open] = await tx
        .select({ id: inventories.id })
        .from(inventories)
        .where(and(eq(inventories.storeId, input.storeId), eq(inventories.status, 'open')));
      if (open) {
        throw new AppError(
          409,
          'inventory_open',
          'Já há uma contagem aberta nesta loja. Continue nela ou feche antes.',
        );
      }
      const id = uuidv7();
      await tx.insert(inventories).values({
        id,
        tenantId: ctx.tenantId,
        storeId: input.storeId,
        name: input.name,
        createdBy: ctx.userId,
      });
      return this.view(tx, ctx, id);
    });
  }

  private async requireOpen(tx: Tx, ctx: RequestContext, id: string) {
    const [inv] = await tx.select().from(inventories).where(eq(inventories.id, id));
    if (!inv) throw notFound('Inventário');
    assertStore(ctx, inv.storeId);
    if (inv.status !== 'open')
      throw new AppError(409, 'inventory_closed', 'Esta contagem já foi fechada.');
    return inv;
  }

  /** Bipe (soma) ou total digitado (troca). Devolve o produto e o total contado. */
  async count(ctx: RequestContext, id: string, input: CountInput) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.requireOpen(tx, ctx, id);
      let productId = input.productId;
      if (!productId && input.code) {
        const [byCode] = await tx
          .select({ id: productBarcodes.productId })
          .from(productBarcodes)
          .where(eq(productBarcodes.code, input.code));
        productId = byCode?.id;
        if (!productId) {
          const [bySku] = await tx
            .select({ id: products.id })
            .from(products)
            .where(eq(products.sku, input.code));
          productId = bySku?.id;
        }
        if (!productId)
          throw new AppError(404, 'unknown_code', `Código ${input.code} não encontrado.`);
      }
      const [product] = await tx
        .select({
          id: products.id,
          name: products.name,
          unit: products.unit,
          weighable: products.isWeighable,
        })
        .from(products)
        .where(eq(products.id, productId!));
      if (!product) throw notFound('Produto');
      if (!product.weighable && input.quantityMilli % 1000 !== 0) {
        throw new AppError(
          422,
          'invalid_quantity',
          `${product.name} é contado por unidade inteira.`,
        );
      }
      const [saved] = await tx
        .insert(inventoryCounts)
        .values({
          tenantId: ctx.tenantId,
          inventoryId: id,
          productId: product.id,
          countedMilli: input.quantityMilli,
          updatedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [inventoryCounts.inventoryId, inventoryCounts.productId],
          set: {
            countedMilli:
              input.mode === 'add'
                ? sql`${inventoryCounts.countedMilli} + ${input.quantityMilli}`
                : input.quantityMilli,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          },
        })
        .returning({ counted: inventoryCounts.countedMilli });
      return {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        countedMilli: saved!.counted,
      };
    });
  }

  /** Fecha: cada produto contado vira ajuste pela diferença com o saldo de agora. */
  async close(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const inv = await this.requireOpen(tx, ctx, id);
      const view = await this.view(tx, ctx, id);
      const now = new Date();
      const changes: { productId: string; before: number; after: number }[] = [];
      for (const item of view.items) {
        const delta = item.countedMilli - item.systemMilli;
        if (delta === 0) continue;
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: inv.storeId,
          productId: item.productId,
          deltaMilli: delta,
          reason: 'count',
          refId: id,
          note: `Inventário: ${inv.name}`,
          actorId: ctx.userId,
          occurredAt: now,
        });
        changes.push({
          productId: item.productId,
          before: item.systemMilli,
          after: item.countedMilli,
        });
      }
      await tx
        .update(inventories)
        .set({ status: 'closed', closedBy: ctx.userId, closedAt: now })
        .where(eq(inventories.id, id));
      await this.audit.record(tx, ctx, {
        action: 'inventory.closed',
        entity: 'inventory',
        entityId: id,
        data: { name: inv.name, counted: view.items.length, adjusted: changes.length, changes },
      });
      return this.view(tx, ctx, id);
    });
  }
}

@Controller('inventories')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.inventory.list(ctx);
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.inventory.get(ctx, id);
  }

  @Post()
  @RequirePermission('catalog.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.inventory.create(ctx, parse(inventoryInput, body));
  }

  /** Contar pode quem cadastra produtos (a equipe que faz o inventário). */
  @Post(':id/counts')
  @RequirePermission('catalog.write')
  count(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.inventory.count(ctx, id, parse(inventoryCountInput, body));
  }

  @Post(':id/close')
  @RequirePermission('catalog.write')
  close(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.inventory.close(ctx, id);
  }
}
