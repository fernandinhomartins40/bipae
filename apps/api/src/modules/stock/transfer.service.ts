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
import {
  stockTransferCancelInput,
  stockTransferInput,
  stockTransferReceiveInput,
  uuidv7,
  type StockTransferView,
} from '@bipae/domain';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  products,
  stockMovements,
  stockTransferItems,
  stockTransfers,
  stores,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const fromStore = alias(stores, 'from_store');
const toStore = alias(stores, 'to_store');

/**
 * Transferência entre lojas (F4-12). Enviar tira o estoque da origem na hora; a mercadoria fica
 * em trânsito até a loja de destino receber, quando entra lá o que chegou de fato (a diferença
 * fica registrada). Cancelar antes do recebimento devolve tudo à origem.
 */
@Injectable()
export class TransferService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async view(tx: Tx, id: string): Promise<StockTransferView> {
    const [row] = await tx
      .select({ t: stockTransfers, fromName: fromStore.name, toName: toStore.name })
      .from(stockTransfers)
      .innerJoin(fromStore, eq(fromStore.id, stockTransfers.fromStoreId))
      .innerJoin(toStore, eq(toStore.id, stockTransfers.toStoreId))
      .where(eq(stockTransfers.id, id));
    if (!row) throw notFound('Transferência');
    const items = await tx
      .select({ i: stockTransferItems, name: products.name, unit: products.unit })
      .from(stockTransferItems)
      .innerJoin(products, eq(products.id, stockTransferItems.productId))
      .where(eq(stockTransferItems.transferId, id))
      .orderBy(products.name);
    const t = row.t;
    return {
      id: t.id,
      fromStoreId: t.fromStoreId,
      fromStoreName: row.fromName,
      toStoreId: t.toStoreId,
      toStoreName: row.toName,
      status: t.status,
      note: t.note,
      needsInvoice: t.needsInvoice,
      createdAt: t.createdAt.toISOString(),
      receivedAt: t.receivedAt?.toISOString() ?? null,
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      cancelReason: t.cancelReason,
      items: items.map(({ i, name, unit }) => ({
        productId: i.productId,
        productName: name,
        unit,
        quantityMilli: i.quantityMilli,
        receivedMilli: i.receivedMilli,
      })),
    };
  }

  /** Quem só acessa algumas lojas vê as transferências que saem delas ou chegam nelas. */
  private canSee(ctx: RequestContext, t: { fromStoreId: string; toStoreId: string }) {
    return !ctx.storeIds || ctx.storeIds.some((s) => s === t.fromStoreId || s === t.toStoreId);
  }

  async list(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          ctx.storeIds
            ? ctx.storeIds.length === 0
              ? sql`false`
              : or(
                  inArray(stockTransfers.fromStoreId, ctx.storeIds),
                  inArray(stockTransfers.toStoreId, ctx.storeIds),
                )
            : undefined,
        )
        .orderBy(desc(stockTransfers.createdAt))
        .limit(100);
      return Promise.all(rows.map((r) => this.view(tx, r.id)));
    });
  }

  get(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const view = await this.view(tx, id);
      if (!this.canSee(ctx, view)) throw notFound('Transferência');
      return view;
    });
  }

  private move(
    tx: Tx,
    ctx: RequestContext,
    m: {
      storeId: string;
      productId: string;
      deltaMilli: number;
      reason: 'transfer_out' | 'transfer_in';
      transferId: string;
      note: string;
      at: Date;
    },
  ) {
    return tx.insert(stockMovements).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      storeId: m.storeId,
      productId: m.productId,
      deltaMilli: m.deltaMilli,
      reason: m.reason,
      refId: m.transferId,
      note: m.note,
      actorId: ctx.userId,
      occurredAt: m.at,
    });
  }

  async create(ctx: RequestContext, input: z.output<typeof stockTransferInput>) {
    assertStore(ctx, input.fromStoreId);
    return withTenant(this.db, ctx, async (tx) => {
      const found = await tx
        .select({ id: stores.id, name: stores.name, companyId: stores.companyId })
        .from(stores)
        .where(inArray(stores.id, [input.fromStoreId, input.toStoreId]));
      const from = found.find((s) => s.id === input.fromStoreId);
      const to = found.find((s) => s.id === input.toStoreId);
      if (!from || !to) throw notFound('Loja');
      const ids = input.items.map((i) => i.productId);
      const prods = await tx
        .select({ id: products.id, name: products.name, weighable: products.isWeighable })
        .from(products)
        .where(inArray(products.id, ids));
      for (const item of input.items) {
        const p = prods.find((x) => x.id === item.productId);
        if (!p) throw notFound('Produto');
        if (!p.weighable && item.quantityMilli % 1000 !== 0) {
          throw new AppError(422, 'invalid_quantity', `${p.name} vai por unidade inteira.`);
        }
      }
      const id = uuidv7();
      const now = new Date();
      await tx.insert(stockTransfers).values({
        id,
        tenantId: ctx.tenantId,
        fromStoreId: from.id,
        toStoreId: to.id,
        note: input.note || null,
        needsInvoice: from.companyId !== to.companyId,
        createdBy: ctx.userId,
        createdAt: now,
      });
      await tx.insert(stockTransferItems).values(
        input.items.map((i) => ({
          tenantId: ctx.tenantId,
          transferId: id,
          productId: i.productId,
          quantityMilli: i.quantityMilli,
        })),
      );
      for (const item of input.items) {
        await this.move(tx, ctx, {
          storeId: from.id,
          productId: item.productId,
          deltaMilli: -item.quantityMilli,
          reason: 'transfer_out',
          transferId: id,
          note: `Transferência para ${to.name}`,
          at: now,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'stock.transfer_sent',
        entity: 'stock_transfer',
        entityId: id,
        data: { from: from.name, to: to.name, items: input.items },
      });
      return this.view(tx, id);
    });
  }

  private async requireInTransit(tx: Tx, id: string) {
    const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
    if (!t) throw notFound('Transferência');
    if (t.status !== 'in_transit') {
      throw new AppError(
        409,
        'transfer_closed',
        t.status === 'received'
          ? 'Esta transferência já foi recebida.'
          : 'Esta transferência foi cancelada.',
      );
    }
    return t;
  }

  async receive(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof stockTransferReceiveInput>,
  ) {
    return withTenant(this.db, ctx, async (tx) => {
      const t = await this.requireInTransit(tx, id);
      assertStore(ctx, t.toStoreId);
      const view = await this.view(tx, id);
      for (const r of input.items ?? []) {
        if (!view.items.some((i) => i.productId === r.productId)) {
          throw new AppError(
            422,
            'unknown_item',
            'Há um produto que não está nesta transferência.',
          );
        }
      }
      const now = new Date();
      const differences: { productId: string; sent: number; received: number }[] = [];
      for (const item of view.items) {
        const received =
          input.items?.find((r) => r.productId === item.productId)?.receivedMilli ??
          item.quantityMilli;
        await tx
          .update(stockTransferItems)
          .set({ receivedMilli: received })
          .where(
            and(
              eq(stockTransferItems.transferId, id),
              eq(stockTransferItems.productId, item.productId),
            ),
          );
        if (received > 0) {
          await this.move(tx, ctx, {
            storeId: t.toStoreId,
            productId: item.productId,
            deltaMilli: received,
            reason: 'transfer_in',
            transferId: id,
            note: `Transferência de ${view.fromStoreName}`,
            at: now,
          });
        }
        if (received !== item.quantityMilli) {
          differences.push({ productId: item.productId, sent: item.quantityMilli, received });
        }
      }
      await tx
        .update(stockTransfers)
        .set({ status: 'received', receivedBy: ctx.userId, receivedAt: now })
        .where(eq(stockTransfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'stock.transfer_received',
        entity: 'stock_transfer',
        entityId: id,
        data: { from: view.fromStoreName, to: view.toStoreName, differences },
      });
      return this.view(tx, id);
    });
  }

  async cancel(ctx: RequestContext, id: string, input: z.output<typeof stockTransferCancelInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const t = await this.requireInTransit(tx, id);
      assertStore(ctx, t.fromStoreId);
      const view = await this.view(tx, id);
      const now = new Date();
      for (const item of view.items) {
        // Devolve à origem com o mesmo motivo, para a saída e a volta se anularem nos relatórios.
        await this.move(tx, ctx, {
          storeId: t.fromStoreId,
          productId: item.productId,
          deltaMilli: item.quantityMilli,
          reason: 'transfer_out',
          transferId: id,
          note: `Transferência cancelada: ${input.reason}`,
          at: now,
        });
      }
      await tx
        .update(stockTransfers)
        .set({
          status: 'cancelled',
          cancelledBy: ctx.userId,
          cancelledAt: now,
          cancelReason: input.reason,
        })
        .where(eq(stockTransfers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'stock.transfer_cancelled',
        entity: 'stock_transfer',
        entityId: id,
        data: { reason: input.reason },
      });
      return this.view(tx, id);
    });
  }
}

@Controller('stock/transfers')
export class TransferController {
  constructor(@Inject(TransferService) private readonly transfers: TransferService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.transfers.list(ctx);
  }

  @Get(':id')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.transfers.get(ctx, id);
  }

  @Post()
  @RequirePermission('catalog.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.transfers.create(ctx, parse(stockTransferInput, body));
  }

  @Post(':id/receive')
  @RequirePermission('catalog.write')
  receive(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.transfers.receive(ctx, id, parse(stockTransferReceiveInput, body ?? {}));
  }

  @Post(':id/cancel')
  @RequirePermission('catalog.write')
  cancel(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.transfers.cancel(ctx, id, parse(stockTransferCancelInput, body));
  }
}
