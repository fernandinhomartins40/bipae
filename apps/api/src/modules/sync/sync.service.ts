import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  terminalEvent,
  uuidv7,
  type FiscalSnapshot,
  type PricingSnapshot,
  type SaleItem,
  type SyncPullResult,
  type SyncPushResult,
  type TerminalEvent,
} from '@bipae/domain';
import { saleTaxSummaries, sameTaxSummary, type SaleFiscalProfile } from '@bipae/fiscal';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { assertStore } from '../../common/stores';
import { AppError } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  cashMovements,
  cashSessions,
  companies,
  companyIcmsRules,
  customerCreditEntries,
  deliveryZones,
  customers,
  fiscalProfiles,
  memberships,
  priceTableItems,
  productComponents,
  priceTables,
  promotions,
  productBarcodes,
  products,
  saleItems,
  salePayments,
  sales,
  stockMovements,
  stores,
  syncEvents,
  tabs,
  terminals,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { LotsService } from '../stock/lots.service';
import { findMunicipio } from '@bipae/fiscal/tables/municipios';
import { FiscalEventsService } from '../fiscal/fiscal-events.service';
import { NfceEmissionService } from '../fiscal/nfce-emission.service';
import { KitchenService } from '../sales/kitchen.service';
import { TabOrdersService } from '../sales/tab-orders.service';
import {
  cancelCreditReceivable,
  createCreditReceivable,
  OVERDUE_BLOCK_DAYS,
  overdueCredit,
  reduceCreditReceivable,
  todayInBrazil,
} from '../finance/credit-receivables';
import { toMotorRule } from '../fiscal/icms-rules.service';

/** A business rule says this event can never be applied; the terminal stops retrying it. */
class Rejection extends Error {}

type Terminal = typeof terminals.$inferSelect;

@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LotsService) private readonly lots: LotsService,
    @Inject(NfceEmissionService) private readonly emission: NfceEmissionService,
    @Inject(FiscalEventsService) private readonly fiscalEvents: FiscalEventsService,
    @Inject(KitchenService) private readonly kitchen: KitchenService,
    @Inject(TabOrdersService) private readonly tabOrders: TabOrdersService,
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
      // Tarefas que só podem começar depois que a transação do evento terminar (ex.: emitir a NFC-e).
      const afterCommit: (() => Promise<void>)[] = [];
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
          await this.apply(tx, ctx, terminal, event, afterCommit);
        });
        result.accepted.push(event.id);
        for (const run of afterCommit) {
          await run().catch((error: Error) =>
            this.logger.warn(`Tarefa depois da venda não agendada: ${error.message}`),
          );
        }
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

  private async apply(
    tx: Tx,
    ctx: RequestContext,
    terminal: Terminal,
    event: TerminalEvent,
    afterCommit: (() => Promise<void>)[] = [],
  ) {
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
      // Comandas (F5-07): o servidor guarda a cópia para o garçom e a cozinha.
      case 'tab.opened': {
        await tx
          .insert(tabs)
          .values({
            id: event.payload.tabId,
            tenantId: ctx.tenantId,
            storeId: terminal.storeId,
            terminalId: terminal.id,
            label: event.payload.label,
            openedAt: new Date(event.payload.openedAt),
          })
          .onConflictDoNothing();
        return;
      }
      case 'tab.updated': {
        const [tab] = await tx.select().from(tabs).where(eq(tabs.id, event.payload.tabId));
        if (!tab) throw new Rejection('Comanda não encontrada.');
        // Comanda já fechada não volta a mudar (evento atrasado de outra rodada).
        if (tab.status !== 'open') return;
        await this.kitchen.onTabUpdated(tx, tab, event.payload.items);
        await tx
          .update(tabs)
          .set({
            label: event.payload.label,
            items: event.payload.items,
            totalCents: event.payload.totalCents,
            updatedAt: at,
          })
          .where(eq(tabs.id, tab.id));
        return;
      }
      // Pedido do garçom (F5-08): o caixa juntou à comanda, ou não conseguiu.
      case 'tab.order_received': {
        await this.tabOrders.received(tx, event.payload, at);
        return;
      }
      case 'tab.closed': {
        const [tab] = await tx.select().from(tabs).where(eq(tabs.id, event.payload.tabId));
        if (!tab) throw new Rejection('Comanda não encontrada.');
        if (tab.status !== 'open') return;
        const paid = event.payload.outcome === 'paid';
        await tx
          .update(tabs)
          .set({
            status: paid ? 'paid' : 'cancelled',
            saleId: event.payload.saleId,
            cancelReason: paid ? null : event.payload.reason,
            closedAt: at,
            updatedAt: at,
          })
          .where(eq(tabs.id, tab.id));
        if (!paid) {
          await this.kitchen.onTabCancelled(tx, tab.id);
          await this.audit.record(tx, actor, {
            action: 'tab.cancelled',
            entity: 'tab',
            entityId: tab.id,
            data: { label: tab.label, totalCents: tab.totalCents, reason: event.payload.reason },
          });
        }
        return;
      }
      case 'cash_session.operator_changed': {
        await this.requireSession(tx, event.payload.sessionId);
        if (event.payload.toOperatorId !== event.operatorId) {
          throw new Rejection(
            'Troca de operador incoerente: o evento não está no nome de quem entrou.',
          );
        }
        await this.requireMember(tx, event.payload.fromOperatorId);
        await this.audit.record(tx, actor, {
          action: 'pos.operator_changed',
          entity: 'cash_session',
          entityId: event.payload.sessionId,
          data: {
            terminalId: terminal.id,
            fromOperatorId: event.payload.fromOperatorId,
            toOperatorId: event.payload.toOperatorId,
          },
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
          ...(p.delivery && {
            delivery: p.delivery,
            deliveryStatus: 'pending' as const,
            deliveryUpdatedAt: at,
          }),
          taxCheck: await this.checkTaxes(tx, terminal.companyId, p.items, at),
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
        // NFC-e (F3-14.b): o documento nasce com a venda; a emissão roda em segundo plano.
        const [store] = await tx
          .select({ companyId: stores.companyId })
          .from(stores)
          .where(eq(stores.id, terminal.storeId));
        const documentId = store
          ? await this.emission.prepare(tx, ctx, p.saleId, store.companyId, p.nfce)
          : null;
        if (documentId) {
          afterCommit.push(() =>
            this.emission.schedule(ctx.tenantId, event.operatorId, documentId),
          );
        }
        const onCredit = p.payments
          .filter((pay) => pay.method === 'store_credit')
          .reduce((sum, pay) => sum + pay.amountCents, 0);
        if (onCredit > 0) {
          await this.creditEntry(
            tx,
            ctx,
            p.customerTaxId ?? '',
            'sale',
            onCredit,
            p.saleId,
            event.operatorId,
          );
          // F4-09: vira conta a receber do cliente, com vencimento.
          if (p.customerTaxId) {
            await createCreditReceivable(tx, {
              tenantId: ctx.tenantId,
              companyId: terminal.companyId,
              taxId: p.customerTaxId,
              saleId: p.saleId,
              saleNumber: p.terminalSeq,
              amountCents: onCredit,
              at,
              createdBy: event.operatorId,
            });
          }
        }
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
        const [credit] = await tx
          .select()
          .from(customerCreditEntries)
          .where(
            and(eq(customerCreditEntries.saleId, sale.id), eq(customerCreditEntries.kind, 'sale')),
          );
        if (credit) {
          await this.creditEntry(
            tx,
            ctx,
            credit.customerTaxId,
            'cancel',
            -credit.amountCents,
            sale.id,
            event.operatorId,
          );
          await cancelCreditReceivable(tx, sale.id);
        }
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
        // NFC-e (F3-17): o cancelamento na SEFAZ roda depois, sem segurar o cancelamento da venda.
        const documentId = await this.fiscalEvents.requestCancel(tx, sale.id, event.payload.reason);
        if (documentId) {
          afterCommit.push(() =>
            this.fiscalEvents.schedule(ctx.tenantId, event.operatorId, documentId),
          );
        }
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
          p.originalSaleId,
        );
        if (p.refundMethod === 'store_credit' && original.customerTaxId) {
          await this.creditEntry(
            tx,
            ctx,
            original.customerTaxId,
            'return',
            -p.refundCents,
            p.returnId,
            event.operatorId,
          );
          await reduceCreditReceivable(tx, p.originalSaleId, p.refundCents);
        }
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
  /**
   * Refaz a conta de impostos da venda com os dados do servidor (F3-06.d3) e diz se bateu com a
   * do caixa. Diferença acontece de forma legítima, por exemplo quando o perfil fiscal mudou e o
   * caixa ainda não tinha sincronizado: por isso é só um sinal para o suporte, nunca motivo para
   * recusar a venda. Nulo quando o caixa não mandou impostos.
   */
  private async checkTaxes(
    tx: Tx,
    companyId: string,
    items: SaleItem[],
    at: Date,
  ): Promise<'ok' | 'divergente' | null> {
    if (!items.some((item) => item.taxes)) return null;
    try {
      const [company] = await tx
        .select({ uf: companies.uf, taxRegime: companies.taxRegime })
        .from(companies)
        .where(eq(companies.id, companyId));
      const rules = (
        await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.companyId, companyId))
      ).map(toMotorRule);
      const sold = await tx
        .select({ id: products.id, fiscalProfileId: products.fiscalProfileId, ncm: products.ncm })
        .from(products)
        .where(inArray(products.id, [...new Set(items.map((item) => item.productId))]));
      const profileIds = [
        ...new Set(sold.flatMap((p) => (p.fiscalProfileId ? [p.fiscalProfileId] : []))),
      ];
      const profiles = profileIds.length
        ? await tx
            .select({ id: fiscalProfiles.id, data: fiscalProfiles.data })
            .from(fiscalProfiles)
            .where(inArray(fiscalProfiles.id, profileIds))
        : [];
      const profileOf = (productId: string) => {
        const id = sold.find((p) => p.id === productId)?.fiscalProfileId;
        return (
          (profiles.find((profile) => profile.id === id)?.data as SaleFiscalProfile | undefined) ??
          null
        );
      };
      const expected = saleTaxSummaries({
        company: { uf: company?.uf ?? null, taxRegime: company?.taxRegime ?? null },
        items: items.map((item) => ({
          operationCents: item.totalCents,
          profile: profileOf(item.productId),
          ncm: sold.find((p) => p.id === item.productId)?.ncm ?? null,
        })),
        rules,
        // A data do fato gerador é a do dia da venda no Brasil, não a do fuso do servidor.
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(at),
      });
      const same =
        expected !== null &&
        items.every(
          (item, index) => item.taxes !== undefined && sameTaxSummary(item.taxes, expected[index]!),
        );
      if (!same) this.logger.warn('Impostos da venda diferentes entre o caixa e o servidor');
      return same ? 'ok' : 'divergente';
    } catch (error) {
      // A conferência é um extra: falha nela não pode impedir a venda de entrar.
      this.logger.warn(
        `Não foi possível conferir os impostos da venda: ${(error as Error).message}`,
      );
      return null;
    }
  }

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
    /** Venda de origem (na devolução); nas outras, a própria `refId`. */
    saleId: string = refId,
  ) {
    if (deltas.length === 0) return;
    const expanded = await this.expandKits(tx, deltas);
    if (expanded.length === 0) return;
    // Lote e validade (F5-04): baixa pelo lote que vence primeiro e guarda a venda.
    await this.lots.applySale(tx, ctx, {
      storeId: terminal.storeId,
      reason,
      saleId,
      refId,
      at,
      deltas: expanded,
    });
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
    fiscalVersion?: string,
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
        ...(await this.fiscal(tx, ctx.terminalId, fiscalVersion)),
        // Pedidos do garçom só na última página: o caixa já tem o catálogo inteiro.
        ...(rows.length <= limit && {
          tabOrders: await this.tabOrders.forTerminal(tx, ctx.terminalId),
        }),
        products: page.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          priceCents: p.priceCents,
          isWeighable: p.isWeighable,
          // Insumo da ficha técnica (F5-11) não se vende no caixa.
          active: p.active && !p.ingredient,
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
    // Bairros da entrega (F5-10): da loja do caixa.
    const [zones] = await tx
      .select({
        last: sql<string>`coalesce(max(${deliveryZones.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(deliveryZones)
      .where(
        eq(deliveryZones.storeId, terminal?.storeId ?? '00000000-0000-0000-0000-000000000000'),
      );
    const [promos] = await tx
      .select({
        last: sql<string>`coalesce(max(${promotions.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(promotions);
    // Atacarejo (F5-03): produtos com preço de atacado também mudam o retrato.
    const [wholesale] = await tx
      .select({
        last: sql<string>`coalesce(max(${products.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(products)
      .where(sql`${products.wholesalePriceCents} is not null`);
    const [creditState] = await tx
      .select({
        limits: sql<string>`coalesce((select string_agg(${customers.taxId} || ':' || ${customers.creditLimitCents}, ',' order by ${customers.taxId}) from ${customers} where ${customers.creditLimitCents} is not null), '')`,
        entries: sql<string>`(select count(*) || ':' || coalesce(max(${customerCreditEntries.createdAt})::text, '') from ${customerCreditEntries})`,
      })
      .from(sql`(select 1) as one`);
    const version = createHash('sha256')
      .update(
        [
          creditState?.limits ?? '',
          creditState?.entries ?? '',
          // O atraso muda com o passar dos dias, mesmo sem nada novo no banco.
          creditState?.limits ? todayInBrazil() : '',
          store?.priceTableId ?? '',
          store?.updatedAt?.toISOString() ?? '',
          tables?.last,
          tables?.n,
          linked?.last,
          linked?.n,
          promos?.last,
          promos?.n,
          zones?.last,
          zones?.n,
          wholesale?.last,
          wholesale?.n,
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
    const creditCustomers = await tx
      .select({ taxId: customers.taxId, limitCents: customers.creditLimitCents })
      .from(customers)
      .where(sql`${customers.creditLimitCents} is not null and ${customers.taxId} is not null`);
    const balances = await tx
      .select({
        taxId: customerCreditEntries.customerTaxId,
        cents: sql<string>`sum(${customerCreditEntries.amountCents})::text`,
      })
      .from(customerCreditEntries)
      .groupBy(customerCreditEntries.customerTaxId);
    const balanceOf = new Map(balances.map((b) => [b.taxId, Number(b.cents)]));
    const wholesaleProducts = await tx
      .select({
        id: products.id,
        name: products.name,
        priceCents: products.wholesalePriceCents,
        minMilli: products.wholesaleMinMilli,
      })
      .from(products)
      .where(sql`${products.active} and ${products.wholesalePriceCents} is not null`);
    // Promoções ligadas e que ainda não acabaram; o caixa confere a vigência no dia da venda.
    const activePromotions = await tx
      .select()
      .from(promotions)
      .where(
        sql`${promotions.active} and (${promotions.endsOn} is null or ${promotions.endsOn} >= ${todayInBrazil()})
          and (${promotions.storeId} is null or ${promotions.storeId} = ${terminal?.storeId ?? null})`,
      );
    const late = new Map(
      (await overdueCredit(tx, todayInBrazil())).map((o) => [o.taxId, o.daysLate]),
    );
    return {
      pricing: {
        version,
        credit: creditCustomers.map((cc) => ({
          taxId: cc.taxId!,
          limitCents: cc.limitCents!,
          balanceCents: balanceOf.get(cc.taxId!) ?? 0,
          blocked: (late.get(cc.taxId!) ?? 0) > OVERDUE_BLOCK_DAYS,
        })),
        storePriceTableId: store?.priceTableId ?? null,
        tables: allTables.map((t) => ({
          id: t.id,
          name: t.name,
          items: items
            .filter((i) => i.tableId === t.id)
            .map(({ productId, priceCents }) => ({ productId, priceCents })),
        })),
        customers: people.map((p) => ({ taxId: p.taxId!, priceTableId: p.priceTableId! })),
        deliveryZones: terminal
          ? await tx
              .select({
                id: deliveryZones.id,
                name: deliveryZones.name,
                feeCents: deliveryZones.feeCents,
              })
              .from(deliveryZones)
              .where(
                and(eq(deliveryZones.storeId, terminal.storeId), eq(deliveryZones.active, true)),
              )
              .orderBy(asc(deliveryZones.name))
          : [],
        promotions: [
          ...activePromotions.map((p) => ({
            id: p.id,
            name: p.name,
            startsOn: p.startsOn,
            endsOn: p.endsOn,
            rule: p.rule,
          })),
          // O preço de atacado vai como faixa de quantidade do próprio produto, sem fim.
          ...wholesaleProducts.map((p) => ({
            id: p.id,
            name: `Atacado: ${p.name}`,
            startsOn: '2000-01-01',
            endsOn: null,
            rule: {
              kind: 'quantity_tier' as const,
              productIds: [p.id],
              tiers: [{ minQuantityMilli: p.minMilli!, unitPriceCents: p.priceCents! }],
            },
          })),
        ],
      },
    };
  }

  /** Lançamento no extrato do crediário (F2-02); a mesma venda não entra duas vezes. */
  private async creditEntry(
    tx: Tx,
    ctx: RequestContext,
    taxId: string,
    kind: 'sale' | 'cancel' | 'return',
    amountCents: number,
    saleId: string,
    operatorId: string,
  ) {
    await tx
      .insert(customerCreditEntries)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        customerTaxId: taxId,
        kind,
        amountCents,
        saleId,
        createdBy: operatorId,
      })
      .onConflictDoNothing();
  }

  /**
   * Retrato fiscal para o caixa (F3-06): UF e regime da empresa do caixa e os perfis fiscais. Só
   * vai quando algo mudou, como o retrato de preços.
   */
  private async fiscal(
    tx: Tx,
    terminalId: string | null,
    known: string | undefined,
  ): Promise<{ fiscal?: FiscalSnapshot }> {
    const [joined] = terminalId
      ? await tx
          .select({ company: companies, nfceSeries: terminals.nfceSeries })
          .from(terminals)
          .innerJoin(companies, eq(companies.id, terminals.companyId))
          .where(eq(terminals.id, terminalId))
      : [];
    const company = joined?.company;
    const [profiles] = await tx
      .select({
        last: sql<string>`coalesce(max(${fiscalProfiles.updatedAt})::text, '')`,
        n: sql<number>`count(*)`,
      })
      .from(fiscalProfiles);
    const rules = company
      ? await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.companyId, company.id))
      : [];
    const rulesStamp = rules
      .map((r) => `${r.id}@${r.updatedAt.toISOString()}`)
      .sort()
      .join(',');
    const version = createHash('sha256')
      .update(
        [
          company?.uf ?? '',
          company?.taxRegime ?? '',
          // Dados do emitente e série do caixa (F3-15): mudar a empresa muda o retrato.
          company?.updatedAt.toISOString() ?? '',
          joined?.nfceSeries ?? '',
          profiles?.last,
          profiles?.n,
          rulesStamp,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 24);
    if (version === known) return {};

    const rows = await tx
      .select({ id: fiscalProfiles.id, data: fiscalProfiles.data })
      .from(fiscalProfiles);
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
    return {
      fiscal: {
        version,
        company: { uf: company?.uf ?? null, taxRegime: company?.taxRegime ?? null },
        profiles: rows.map((row) => {
          const data = row.data as Record<string, unknown>;
          return {
            id: row.id,
            cfopInterna: text(data.cfopInterna) ?? '',
            cfopInterestadual: text(data.cfopInterestadual) ?? '',
            csosn: text(data.csosn),
            cstIcms: text(data.cstIcms),
            cstPisCofins: text(data.cstPisCofins),
            cClassTrib: text(data.cClassTrib),
            ...(typeof data.origem === 'number' && { origem: data.origem }),
          };
        }),
        icmsRules: rules.map(toMotorRule),
        ...(company &&
          joined && {
            issuer: {
              cnpj: company.taxId,
              legalName: company.legalName,
              tradeName: company.tradeName,
              ie: company.ie,
              address: {
                street: company.street,
                number: company.streetNumber,
                complement: company.complement,
                district: company.district,
                cityCode: company.cityCode,
                cityName: company.cityCode ? (findMunicipio(company.cityCode)?.name ?? null) : null,
                cep: company.cep,
                phone: company.phone,
              },
              paymentCodes: company.nfcePaymentCodes,
              nfceSeries: joined.nfceSeries,
            },
          }),
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
