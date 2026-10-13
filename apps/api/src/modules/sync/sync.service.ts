import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  terminalEvent,
  uuidv7,
  type PricingSnapshot,
  type SyncPullResult,
  type SyncPushResult,
  type TerminalEvent,
} from '@bipae/domain';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { assertStore } from '../../common/stores';
import { AppError } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  cashMovements,
  cashSessions,
  customers,
  memberships,
  priceTableItems,
  productComponents,
  priceTables,
  productBarcodes,
  products,
  saleItems,
  salePayments,
  sales,
  stockMovements,
  stores,
  syncEvents,
  terminals,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** A business rule says this event can never be applied; the terminal stops retrying it. */
class Rejection extends Error {}

type Terminal = typeof terminals.$inferSelect;

@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Applies terminal events in device order. Each event runs in its own transaction, so one
   * bad event never blocks the rest. Already-applied ids are accepted again (idempotent).
   * Transient failures are neither accepted nor rejected: the terminal retries later.
   */
  async push(
    ctx: RequestContext,
    terminalId: string,
    rawEvents: unknown[],
  ): Promise<SyncPushResult> {
    const terminal = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(terminals).where(eq(terminals.id, terminalId));
      return row;
    });
    if (!terminal)
      throw new AppError(404, 'not_found', 'Este caixa não está cadastrado nesta empresa.');
    // F1-05: quem não tem acesso à loja do caixa não envia vendas por ele.
    assertStore(ctx, terminal.storeId);

    const result: SyncPushResult = { accepted: [], rejected: [] };
    const parsed: TerminalEvent[] = [];
    for (const raw of rawEvents) {
      const event = terminalEvent.safeParse(raw);
      const id = (raw as { id?: unknown })?.id;
      if (!event.success) {
        if (typeof id === 'string') {
          result.rejected.push({
            id,
            reason: `Evento inválido: ${event.error.issues[0]?.message ?? 'formato'}`,
          });
        }
        continue;
      }
      if (event.data.terminalId !== terminalId) {
        result.rejected.push({ id: event.data.id, reason: 'Evento de outro caixa.' });
        continue;
      }
      parsed.push(event.data);
    }
    parsed.sort((a, b) => a.deviceSeq - b.deviceSeq);

    for (const event of parsed) {
      try {
        await withTenant(this.db, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
          const [inserted] = await tx
            .insert(syncEvents)
            .values({
              id: event.id,
              tenantId: ctx.tenantId,
              terminalId,
              type: event.type,
              deviceSeq: event.deviceSeq,
              operatorId: event.operatorId,
              occurredAt: new Date(event.occurredAt),
              payload: event,
            })
            .onConflictDoNothing()
            .returning({ id: syncEvents.id });
          if (!inserted) return; // already applied
          await this.requireMember(tx, event.operatorId);
          await this.apply(tx, ctx, terminal, event);
        });
        result.accepted.push(event.id);
      } catch (error) {
        if (error instanceof Rejection) {
          result.rejected.push({ id: event.id, reason: error.message });
        } else {
          // Stop here: later events may depend on this one (order matters), so the terminal
          // retries from this point instead of getting false rejections.
          this.logger.warn(`Falha temporária no evento ${event.id}: ${(error as Error).message}`);
          break;
        }
      }
    }
    return result;
  }

  private async requireMember(tx: Tx, userId: string) {
    const [m] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    if (!m) throw new Rejection('Operador não pertence a esta empresa.');
  }

  private async apply(tx: Tx, ctx: RequestContext, terminal: Terminal, event: TerminalEvent) {
    const at = new Date(event.occurredAt);
    const actor = { tenantId: ctx.tenantId, userId: event.operatorId };
    switch (event.type) {
      case 'cash_session.opened': {
        await tx.insert(cashSessions).values({
          id: event.payload.sessionId,
          tenantId: ctx.tenantId,
          terminalId: terminal.id,
          operatorId: event.operatorId,
          openedAt: at,
          openingCents: event.payload.openingCents,
        });
        return;
      }
      case 'cash_session.movement': {
        await this.requireSession(tx, event.payload.sessionId);
        await tx.insert(cashMovements).values({
          id: event.payload.movementId,
          tenantId: ctx.tenantId,
          sessionId: event.payload.sessionId,
          kind: event.payload.kind,
          amountCents: event.payload.amountCents,
          reason: event.payload.reason ?? null,
          operatorId: event.operatorId,
          authorizedBy: event.payload.authorizedBy ?? null,
          occurredAt: at,
        });
        if (event.payload.kind === 'withdrawal') {
          await this.audit.record(tx, actor, {
            action: 'cash.withdrawal',
            entity: 'cash_session',
            entityId: event.payload.sessionId,
            authorizedBy: event.payload.authorizedBy ?? null,
            data: {
              amountCents: event.payload.amountCents,
              reason: event.payload.reason,
              terminal: terminal.name,
            },
          });
        }
        return;
      }
      case 'cash_session.closed': {
        await this.requireSession(tx, event.payload.sessionId);
        await tx
          .update(cashSessions)
          .set({
            closedAt: at,
            declared: event.payload.declared,
            expected: event.payload.expected,
            differenceCents: event.payload.differenceCents,
          })
          .where(eq(cashSessions.id, event.payload.sessionId));
        if (event.payload.differenceCents !== 0) {
          await this.audit.record(tx, actor, {
            action: 'cash.closed_with_difference',
            entity: 'cash_session',
            entityId: event.payload.sessionId,
            data: { differenceCents: event.payload.differenceCents, terminal: terminal.name },
          });
        }
        return;
      }
      case 'sale.completed': {
        const p = event.payload;
        await this.requireSession(tx, p.sessionId);
        await this.requireProducts(
          tx,
          p.items.map((i) => i.productId),
        );
        await tx.insert(sales).values({
          id: p.saleId,
          tenantId: ctx.tenantId,
          terminalId: terminal.id,
          storeId: terminal.storeId,
          terminalSeq: p.terminalSeq,
          sessionId: p.sessionId,
          kind: 'sale',
          status: 'completed',
          subtotalCents: p.subtotalCents,
          discountCents: p.discountCents,
          totalCents: p.totalCents,
          customerTaxId: p.customerTaxId ?? null,
          operatorId: event.operatorId,
          discountAuthorizedBy: p.discountAuthorizedBy ?? null,
          occurredAt: at,
          data: p,
        });
        await tx
          .insert(saleItems)
          .values(p.items.map((i) => ({ tenantId: ctx.tenantId, saleId: p.saleId, ...i })));
        await tx.insert(salePayments).values(
          p.payments.map((pay, idx) => ({
            tenantId: ctx.tenantId,
            saleId: p.saleId,
            idx,
            method: pay.method,
            amountCents: pay.amountCents,
            changeCents: pay.changeCents,
            nsu: pay.nsu ?? null,
            authorizationCode: pay.authorizationCode ?? null,
            provider: pay.provider ?? null,
          })),
        );
        await this.moveStock(
          tx,
          ctx,
          terminal,
          at,
          'sale',
          p.saleId,
          p.items.map((i) => [i.productId, -i.quantityMilli]),
        );
        if (p.discountAuthorizedBy) {
          await this.audit.record(tx, actor, {
            action: 'sale.discount_authorized',
            entity: 'sale',
            entityId: p.saleId,
            authorizedBy: p.discountAuthorizedBy,
            data: {
              discountCents: p.discountCents,
              subtotalCents: p.subtotalCents,
              terminalSeq: p.terminalSeq,
            },
          });
        }
        return;
      }
      case 'sale.cancelled': {
        const [sale] = await tx.select().from(sales).where(eq(sales.id, event.payload.saleId));
        if (!sale || sale.kind !== 'sale') throw new Rejection('Venda a cancelar não encontrada.');
        if (sale.status === 'cancelled') return;
        await tx
          .update(sales)
          .set({ status: 'cancelled', cancelledAt: at, cancelReason: event.payload.reason })
          .where(eq(sales.id, sale.id));
        const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
        await this.moveStock(
          tx,
          ctx,
          terminal,
          at,
          'sale_cancelled',
          sale.id,
          items.map((i) => [i.productId, i.quantityMilli]),
        );
        await this.audit.record(tx, actor, {
          action: 'sale.cancelled',
          entity: 'sale',
          entityId: sale.id,
          authorizedBy: event.payload.authorizedBy ?? null,
          data: {
            reason: event.payload.reason,
            totalCents: sale.totalCents,
            terminalSeq: sale.terminalSeq,
          },
        });
        return;
      }
      case 'sale.returned': {
        const p = event.payload;
        await this.requireSession(tx, p.sessionId);
        const [original] = await tx.select().from(sales).where(eq(sales.id, p.originalSaleId));
        if (!original || original.kind !== 'sale')
          throw new Rejection('Venda original da devolução não encontrada.');
        await tx.insert(sales).values({
          id: p.returnId,
          tenantId: ctx.tenantId,
          terminalId: terminal.id,
          storeId: terminal.storeId,
          terminalSeq: p.terminalSeq,
          sessionId: p.sessionId,
          kind: 'return',
          status: 'completed',
          originalSaleId: p.originalSaleId,
          subtotalCents: p.refundCents,
          discountCents: 0,
          totalCents: p.refundCents,
          customerTaxId: original.customerTaxId,
          operatorId: event.operatorId,
          occurredAt: at,
          data: p,
        });
        await this.moveStock(
          tx,
          ctx,
          terminal,
          at,
          'return',
          p.returnId,
          p.items.map((i) => [i.productId, i.quantityMilli]),
        );
        await this.audit.record(tx, actor, {
          action: 'sale.returned',
          entity: 'sale',
          entityId: p.originalSaleId,
          data: { refundCents: p.refundCents, refundMethod: p.refundMethod, reason: p.reason },
        });
        return;
      }
    }
  }

  private async requireSession(tx: Tx, sessionId: string) {
    const [s] = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.id, sessionId));
    if (!s) throw new Rejection('Abertura de caixa não recebida antes deste evento.');
  }

  /** FK checks bypass RLS, so product ownership is verified explicitly under the tenant scope. */
  private async requireProducts(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, unique));
    if (found.length !== unique.length)
      throw new Rejection('A venda tem um produto desconhecido nesta empresa.');
  }

  /**
   * Kit (F1-04): não tem estoque próprio. Vender, cancelar ou devolver um kit mexe no estoque
   * dos componentes, cada um multiplicado pela quantidade que vai no kit. Um nível só: o
   * cadastro não deixa um kit ser componente de outro.
   */
  private async expandKits(
    tx: Tx,
    deltas: [productId: string, deltaMilli: number][],
  ): Promise<[string, number][]> {
    const ids = [...new Set(deltas.map(([id]) => id))];
    const parts = await tx
      .select()
      .from(productComponents)
      .where(inArray(productComponents.productId, ids));
    if (parts.length === 0) return deltas;
    const result: [string, number][] = [];
    for (const [productId, deltaMilli] of deltas) {
      const components = parts.filter((p) => p.productId === productId);
      if (components.length === 0) {
        result.push([productId, deltaMilli]);
        continue;
      }
      for (const c of components) {
        result.push([c.componentId, Math.round(deltaMilli * Number(c.quantity))]);
      }
    }
    return result.filter(([, delta]) => delta !== 0);
  }

  private async moveStock(
    tx: Tx,
    ctx: RequestContext,
    terminal: Terminal,
    at: Date,
    reason: 'sale' | 'sale_cancelled' | 'return',
    refId: string,
    deltas: [productId: string, deltaMilli: number][],
  ) {
    if (deltas.length === 0) return;
    const expanded = await this.expandKits(tx, deltas);
    if (expanded.length === 0) return;
    await tx.insert(stockMovements).values(
      expanded.map(([productId, deltaMilli]) => ({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        storeId: terminal.storeId,
        productId,
        deltaMilli,
        reason,
        refId,
        actorId: ctx.userId,
        occurredAt: at,
      })),
    );
  }

  /**
   * Catalog changes since a cursor `<iso>|<id>` (keyset pagination on updated_at, id,
   * so products updated in the same instant are never skipped).
   */
  async pull(
    ctx: RequestContext,
    cursor: string | undefined,
    limit: number,
    pricingVersion?: string,
  ): Promise<SyncPullResult> {
    const [sinceIso, sinceId] = cursor ? cursor.split('|') : [];
    const since = sinceIso ? new Date(sinceIso) : null;
    if (since && Number.isNaN(since.getTime()))
      throw new AppError(400, 'validation', 'Cursor inválido.');

    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(products)
        .where(
          since
            ? or(
                gt(products.updatedAt, since),
                and(
                  eq(products.updatedAt, since),
                  gt(products.id, sinceId ?? '00000000-0000-0000-0000-000000000000'),
                ),
              )
            : undefined,
        )
        .orderBy(asc(products.updatedAt), asc(products.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const codes = page.length
        ? await tx
            .select()
            .from(productBarcodes)
            .where(
              inArray(
                productBarcodes.productId,
                page.map((p) => p.id),
              ),
            )
        : [];
      const last = page.at(-1);
      return {
        cursor: last ? `${last.updatedAt.toISOString()}|${last.id}` : (cursor ?? ''),
        hasMore: rows.length > limit,
        ...(await this.pricing(tx, ctx.terminalId, pricingVersion)),
        products: page.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          priceCents: p.priceCents,
          isWeighable: p.isWeighable,
          active: p.active,
          ncm: p.ncm,
          cest: p.cest,
          fiscalProfileId: p.fiscalProfileId,
          parentId: p.parentId,
          barcodes: codes.filter((c) => c.productId === p.id).map((c) => c.code),
          updatedAt: p.updatedAt.toISOString(),
        })),
      };
    });
  }

  /**
   * Retrato de preços para o caixa (F1-03): só quando algo mudou desde a versão que o caixa já
   * tem. A versão é um hash de agregados baratos (última alteração e contagens), então uma
   * sincronização sem mudança custa poucas consultas pequenas e nenhum dado a mais.
   */
  private async pricing(
    tx: Tx,
    terminalId: string | null,
    known: string | undefined,
  ): Promise<{ pricing?: PricingSnapshot }> {
    const [terminal] = terminalId
      ? await tx
          .select({ storeId: terminals.storeId })
          .from(terminals)
          .where(eq(terminals.id, terminalId))
      : [];
    const [store] = terminal
      ? await tx
          .select({ priceTableId: stores.priceTableId, updatedAt: stores.updatedAt })
          .from(stores)
          .where(eq(stores.id, terminal.storeId))
      : [];
    const [tables] = await tx
      .select({
        last: sql<string>`coalesce(max(${priceTables.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(priceTables);
    const [linked] = await tx
      .select({
        last: sql<string>`coalesce(max(${customers.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(customers)
      .where(sql`${customers.priceTableId} is not null`);
    const version = createHash('sha256')
      .update(
        [
          store?.priceTableId ?? '',
          store?.updatedAt?.toISOString() ?? '',
          tables?.last,
          tables?.n,
          linked?.last,
          linked?.n,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 24);
    if (version === known) return {};

    const allTables = await tx
      .select({ id: priceTables.id, name: priceTables.name })
      .from(priceTables);
    const items = await tx
      .select({
        tableId: priceTableItems.priceTableId,
        productId: priceTableItems.productId,
        priceCents: priceTableItems.priceCents,
      })
      .from(priceTableItems);
    const people = await tx
      .select({ taxId: customers.taxId, priceTableId: customers.priceTableId })
      .from(customers)
      .where(sql`${customers.priceTableId} is not null and ${customers.taxId} is not null`);
    return {
      pricing: {
        version,
        storePriceTableId: store?.priceTableId ?? null,
        tables: allTables.map((t) => ({
          id: t.id,
          name: t.name,
          items: items
            .filter((i) => i.tableId === t.id)
            .map(({ productId, priceCents }) => ({ productId, priceCents })),
        })),
        customers: people.map((p) => ({ taxId: p.taxId!, priceTableId: p.priceTableId! })),
      },
    };
  }

  /** Last device sequence received per terminal, for support and gap detection. */
  async status(ctx: RequestContext, terminalId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({
          lastSeq: sql<number>`coalesce(max(${syncEvents.deviceSeq}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(syncEvents)
        .where(eq(syncEvents.terminalId, terminalId));
      return { lastDeviceSeq: Number(row?.lastSeq ?? 0), events: Number(row?.count ?? 0) };
    });
  }
}
