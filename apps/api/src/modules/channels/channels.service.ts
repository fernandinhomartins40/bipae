import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  availableChannelActions,
  channelIntegrationInput,
  channelLinkInput,
  channelRejectInput,
  channelStatusAfter,
  normalizedOrderSchema,
  uuidv7,
  type ChannelAction,
  type ChannelCatalogSyncResult,
  type ChannelIntegrationCreated,
  type ChannelIntegrationView,
  type ChannelLinkView,
  type ChannelOrderStatus,
  type ChannelOrderView,
  type NormalizedOrder,
} from '@bipae/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Config } from '../../config';
import type { RequestContext } from '../../common/auth';
import { CONFIG, DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { SecretBox } from '../../common/secrets';
import { assertStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  financialEntries,
  products,
  stockMovements,
  stores,
  tabOrders,
} from '../../db/schema';
import {
  channelActions,
  channelEvents,
  channelIntegrations,
  channelOrders,
  channelProductLinks,
  type ChannelOrderItem,
} from '../../db/schema-channels';
import { AuditService } from '../audit/audit.service';
import { HttpsPixTransport, type PixTransport } from '../payments/pix-api';
import {
  ChannelNotReadyError,
  ChannelRejectedError,
  type AvailabilityItem,
  type OrderChannel,
} from './channel.port';
import { IFOOD_DEFAULT_URL, IfoodChannel } from './ifood.channel';
import { GenericChannel, SimulatorHub } from './simulator.channel';

export const CHANNEL_SEND = 'canais.enviar';
/** Espera antes de cada nova tentativa de ação no canal; passou disso, desiste e avisa na tela. */
export const CHANNEL_RETRY_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3_600_000];
/** Quanto o relógio do conector pode divergir do nosso na assinatura (contra reenvio antigo). */
const SIGNATURE_TOLERANCE_S = 300;

type IntegrationRow = typeof channelIntegrations.$inferSelect;
type OrderRow = typeof channelOrders.$inferSelect;

/** Assinatura que o conector manda: "t=<segundos>,v1=<hmac>" sobre "<segundos>.<corpo>". */
export function signInbound(secret: string, body: string, seconds: number): string {
  const v1 = createHmac('sha256', secret).update(`${seconds}.${body}`).digest('hex');
  return `t=${seconds},v1=${v1}`;
}

function verifyInbound(secret: string, header: string | undefined, body: string, nowMs: number) {
  if (!header) return false;
  const fields = new Map(
    header.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k ?? '', v.join('=')] as const;
    }),
  );
  const t = Number(fields.get('t'));
  const v1 = fields.get('v1');
  if (!Number.isInteger(t) || !v1) return false;
  if (Math.abs(nowMs / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(signInbound(secret, body, t).split('v1=')[1]!);
  const given = Buffer.from(v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Pedidos de canais externos (F6-05 iFood, F6-06 marketplaces). O pedido entra uma vez só
 * (chave única por canal e id externo), vira pedido na fila do caixa da loja (tab_orders, a
 * mesma do garçom) quando é aceito, e a venda e a baixa de estoque acontecem no caixa. Pedido
 * pago online gera a conta a receber do repasse. Toda ação sobre o canal sai por uma fila com
 * nova tentativa, sem repetir o que já saiu.
 */
@Injectable()
export class ChannelsService implements OnModuleInit {
  private readonly logger = new Logger('Canais');
  private readonly box: SecretBox;
  /** Troca nos testes para falar com um iFood de mentira. */
  transport: PixTransport = new HttpsPixTransport();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SimulatorHub) readonly hub: SimulatorHub,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  onModuleInit() {
    this.queue.process(CHANNEL_SEND, (data) =>
      this.sendAction(data as { tenantId: string; actionId: string }),
    );
  }

  private get production() {
    return this.config.NODE_ENV === 'production';
  }

  // ------------------------------------------------------------------ portas

  private creds(row: IntegrationRow): { clientId: string; clientSecret: string } | null {
    if (!row.credentialsSealed) return null;
    try {
      return JSON.parse(this.box.open(row.credentialsSealed)) as {
        clientId: string;
        clientSecret: string;
      };
    } catch {
      return null;
    }
  }

  /** Motivo de "falta configurar", ou null quando a integração pode rodar. */
  missing(row: IntegrationRow): string | null {
    if (row.provider === 'simulator' && this.production) {
      return 'O simulador só existe em teste, não em produção.';
    }
    if (row.provider === 'ifood') {
      if (!row.merchantId) return 'Falta o código da loja no iFood.';
      if (!this.creds(row)) {
        return 'Falta o clientId e o clientSecret do iFood (acesso de integrador, ainda não liberado).';
      }
    }
    return null;
  }

  channelFor(row: IntegrationRow): OrderChannel {
    const reason = this.missing(row);
    if (reason) throw new ChannelNotReadyError(reason);
    switch (row.provider) {
      case 'ifood': {
        const c = this.creds(row)!;
        return new IfoodChannel(
          { ...c, merchantId: row.merchantId! },
          this.transport,
          process.env.IFOOD_API_URL || IFOOD_DEFAULT_URL,
        );
      }
      case 'simulator':
        return this.hub.channel(row.id);
      case 'generic':
        return new GenericChannel();
    }
  }

  // ------------------------------------------------------------------ cadastro

  private async view(tx: Tx, row: IntegrationRow): Promise<ChannelIntegrationView> {
    const [open] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(channelOrders)
      .where(
        and(
          eq(channelOrders.integrationId, row.id),
          inArray(channelOrders.status, [
            'received',
            'needs_mapping',
            'accepted',
            'preparing',
            'ready',
          ]),
        ),
      );
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      storeId: row.storeId,
      merchantId: row.merchantId,
      autoAccept: row.autoAccept,
      settlementDays: row.settlementDays,
      commissionBps: row.commissionBps,
      active: row.active,
      hasCredentials: !!row.credentialsSealed,
      missing: this.missing(row),
      lastPollAt: row.lastPollAt?.toISOString() ?? null,
      lastError: row.lastError,
      openOrders: Number(open?.n ?? 0),
    };
  }

  list(ctx: RequestContext): Promise<ChannelIntegrationView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(channelIntegrations)
        .where(storeCondition(ctx, channelIntegrations.storeId))
        .orderBy(asc(channelIntegrations.createdAt));
      return Promise.all(rows.map((r) => this.view(tx, r)));
    });
  }

  async create(ctx: RequestContext, body: unknown): Promise<ChannelIntegrationCreated> {
    const input = parse(channelIntegrationInput, body);
    assertStore(ctx, input.storeId);
    if (input.provider === 'simulator' && this.production) {
      throw new AppError(422, 'simulator_off', 'O simulador só existe em teste.');
    }
    if (input.provider === 'ifood' && !input.merchantId) {
      throw new AppError(422, 'merchant_required', 'Informe o código da loja no iFood.');
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const secret =
        input.provider === 'generic' ? `chsec_${randomBytes(32).toString('base64url')}` : null;
      const key = input.provider === 'generic' ? randomBytes(18).toString('base64url') : null;
      const [row] = await tx
        .insert(channelIntegrations)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          provider: input.provider,
          name: input.name,
          storeId: input.storeId,
          merchantId: input.merchantId ?? null,
          credentialsSealed:
            input.clientId && input.clientSecret
              ? this.box.seal(
                  JSON.stringify({ clientId: input.clientId, clientSecret: input.clientSecret }),
                )
              : null,
          inboundSecretSealed: secret ? this.box.seal(secret) : null,
          inboundKey: key,
          autoAccept: input.autoAccept,
          settlementDays: input.settlementDays,
          commissionBps: input.commissionBps,
          active: input.active,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'channel.created',
        entity: 'channel_integration',
        entityId: row!.id,
        data: { provider: input.provider, name: input.name, storeId: input.storeId },
      });
      return {
        ...(await this.view(tx, row!)),
        inboundSecret: secret,
        inboundPath: key ? `/v1/channels/inbound/${ctx.tenantId}/${key}` : null,
      };
    });
  }

  async update(ctx: RequestContext, id: string, body: unknown): Promise<ChannelIntegrationView> {
    const input = parse(channelIntegrationInput, body);
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [cur] = await tx
        .select()
        .from(channelIntegrations)
        .where(eq(channelIntegrations.id, id));
      if (!cur) throw notFound('Integração');
      assertStore(ctx, cur.storeId);
      const [row] = await tx
        .update(channelIntegrations)
        .set({
          name: input.name,
          storeId: input.storeId,
          merchantId: input.merchantId ?? cur.merchantId,
          // Credencial em branco mantém a guardada; o valor guardado nunca volta para a tela.
          ...(input.clientId &&
            input.clientSecret && {
              credentialsSealed: this.box.seal(
                JSON.stringify({ clientId: input.clientId, clientSecret: input.clientSecret }),
              ),
            }),
          autoAccept: input.autoAccept,
          settlementDays: input.settlementDays,
          commissionBps: input.commissionBps,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(eq(channelIntegrations.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'channel.updated',
        entity: 'channel_integration',
        entityId: id,
        // Só o que mudou de configuração; credencial e segredo nunca entram na trilha.
        data: {
          name: input.name,
          active: input.active,
          autoAccept: input.autoAccept,
          commissionBps: input.commissionBps,
          credentialsChanged: !!(input.clientId && input.clientSecret),
        },
      });
      return this.view(tx, row!);
    });
  }

  /** Gera outro segredo do conector (o anterior para de valer na hora). */
  async rotateSecret(ctx: RequestContext, id: string): Promise<ChannelIntegrationCreated> {
    return withTenant(this.db, ctx, async (tx) => {
      const [cur] = await tx
        .select()
        .from(channelIntegrations)
        .where(eq(channelIntegrations.id, id));
      if (!cur || cur.provider !== 'generic') throw notFound('Integração');
      assertStore(ctx, cur.storeId);
      const secret = `chsec_${randomBytes(32).toString('base64url')}`;
      const [row] = await tx
        .update(channelIntegrations)
        .set({ inboundSecretSealed: this.box.seal(secret), updatedAt: new Date() })
        .where(eq(channelIntegrations.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'channel.secret_rotated',
        entity: 'channel_integration',
        entityId: id,
      });
      return {
        ...(await this.view(tx, row!)),
        inboundSecret: secret,
        inboundPath: `/v1/channels/inbound/${ctx.tenantId}/${cur.inboundKey}`,
      };
    });
  }

  // ------------------------------------------------------------------ produtos ligados

  async links(ctx: RequestContext, integrationId: string): Promise<ChannelLinkView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({
          sku: channelProductLinks.sku,
          productId: channelProductLinks.productId,
          name: products.name,
        })
        .from(channelProductLinks)
        .innerJoin(products, eq(products.id, channelProductLinks.productId))
        .where(eq(channelProductLinks.integrationId, integrationId))
        .orderBy(asc(channelProductLinks.sku));
      return rows.map((r) => ({ sku: r.sku, productId: r.productId, productName: r.name }));
    });
  }

  async link(ctx: RequestContext, integrationId: string, body: unknown) {
    const input = parse(channelLinkInput, body);
    return withTenant(this.db, ctx, async (tx) => {
      const integ = await this.require(tx, ctx, integrationId);
      const [p] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, input.productId));
      if (!p) throw new AppError(422, 'unknown_product', 'Produto não encontrado.');
      await tx
        .insert(channelProductLinks)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          integrationId,
          sku: input.sku,
          productId: input.productId,
        })
        .onConflictDoUpdate({
          target: [
            channelProductLinks.tenantId,
            channelProductLinks.integrationId,
            channelProductLinks.sku,
          ],
          set: { productId: input.productId },
        });
      await this.audit.record(tx, ctx, {
        action: 'channel.product_linked',
        entity: 'channel_integration',
        entityId: integrationId,
        data: { sku: input.sku, productId: input.productId },
      });
      // Pedidos parados por falta de ligação voltam para a fila se agora tudo está ligado.
      const waiting = await tx
        .select()
        .from(channelOrders)
        .where(
          and(eq(channelOrders.integrationId, integ.id), eq(channelOrders.status, 'needs_mapping')),
        );
      for (const order of waiting) {
        const items = await this.resolveItems(tx, integ.id, order.items);
        const complete = items.every((i) => i.productId);
        await tx
          .update(channelOrders)
          .set({ items, ...(complete && { status: 'received' as const }), updatedAt: new Date() })
          .where(eq(channelOrders.id, order.id));
      }
      return { ok: true };
    });
  }

  async unlink(ctx: RequestContext, integrationId: string, sku: string) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.require(tx, ctx, integrationId);
      await tx
        .delete(channelProductLinks)
        .where(
          and(
            eq(channelProductLinks.integrationId, integrationId),
            eq(channelProductLinks.sku, sku),
          ),
        );
      await this.audit.record(tx, ctx, {
        action: 'channel.product_unlinked',
        entity: 'channel_integration',
        entityId: integrationId,
        data: { sku },
      });
      return { ok: true };
    });
  }

  private async require(tx: Tx, ctx: RequestContext, id: string): Promise<IntegrationRow> {
    const [row] = await tx.select().from(channelIntegrations).where(eq(channelIntegrations.id, id));
    if (!row) throw notFound('Integração');
    assertStore(ctx, row.storeId);
    return row;
  }

  /** Liga cada item ao produto: pela ligação cadastrada ou pelo SKU igual ao do produto. */
  private async resolveItems(
    tx: Tx,
    integrationId: string,
    items: ChannelOrderItem[],
  ): Promise<ChannelOrderItem[]> {
    const skus = [...new Set(items.map((i) => i.sku))];
    const linked = await tx
      .select({ sku: channelProductLinks.sku, productId: channelProductLinks.productId })
      .from(channelProductLinks)
      .where(
        and(
          eq(channelProductLinks.integrationId, integrationId),
          inArray(channelProductLinks.sku, skus),
        ),
      );
    const byLink = new Map(linked.map((l) => [l.sku, l.productId]));
    const bySku = new Map(
      (
        await tx
          .select({ id: products.id, sku: products.sku })
          .from(products)
          .where(and(inArray(products.sku, skus), eq(products.active, true)))
      ).map((p) => [p.sku!, p.id]),
    );
    return items.map((i) => ({ ...i, productId: byLink.get(i.sku) ?? bySku.get(i.sku) ?? null }));
  }

  // ------------------------------------------------------------------ entrada de pedidos

  /** Grava o pedido uma vez só; devolve a linha e se foi a primeira vez. */
  private async ingest(
    tx: Tx,
    integ: IntegrationRow,
    order: NormalizedOrder,
  ): Promise<{ row: OrderRow; created: boolean }> {
    const items = await this.resolveItems(
      tx,
      integ.id,
      order.items.map((i) => ({ ...i, productId: null })),
    );
    const [row] = await tx
      .insert(channelOrders)
      .values({
        id: uuidv7(),
        tenantId: integ.tenantId,
        integrationId: integ.id,
        externalId: order.externalId,
        displayId: order.displayId,
        status: items.every((i) => i.productId) ? 'received' : 'needs_mapping',
        type: order.type,
        customerName: order.customer.name,
        customerPhone: order.customer.phone ?? null,
        address: order.address ?? null,
        items,
        subtotalCents: order.subtotalCents,
        deliveryFeeCents: order.deliveryFeeCents,
        discountCents: order.discountCents,
        totalCents: order.totalCents,
        prepaid: order.payment.prepaid,
        paymentMethod: order.payment.method,
        notes: order.notes ?? null,
        placedAt: new Date(order.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await this.audit.record(
        tx,
        { tenantId: integ.tenantId, userId: integ.createdBy },
        {
          action: 'channel.order_received',
          entity: 'channel_order',
          entityId: row.id,
          data: {
            integration: integ.name,
            externalId: order.externalId,
            totalCents: order.totalCents,
          },
        },
      );
      return { row, created: true };
    }
    const [same] = await tx
      .select()
      .from(channelOrders)
      .where(
        and(
          eq(channelOrders.integrationId, integ.id),
          eq(channelOrders.externalId, order.externalId),
        ),
      );
    return { row: same!, created: false };
  }

  /** Pedido empurrado por um conector genérico, assinado com o segredo da integração. */
  async inbound(
    tenantId: string,
    key: string,
    signature: string | undefined,
    raw: string,
    body: unknown,
    now = new Date(),
  ) {
    const found = await withTenant(this.db, { tenantId }, async (tx) => {
      const [row] = await tx
        .select()
        .from(channelIntegrations)
        .where(eq(channelIntegrations.inboundKey, key));
      return row ?? null;
    });
    // Integração desconhecida, desligada ou assinatura errada: a mesma resposta.
    if (
      !found ||
      !found.active ||
      !found.inboundSecretSealed ||
      !verifyInbound(this.box.open(found.inboundSecretSealed), signature, raw, now.getTime())
    ) {
      throw new AppError(401, 'invalid_signature', 'Assinatura inválida.');
    }
    const order = parse(normalizedOrderSchema, body);
    const result = await withTenant(this.db, { tenantId }, (tx) => this.ingest(tx, found, order));
    if (result.created && found.autoAccept && result.row.status === 'received') {
      await this.act(this.system(found), result.row.id, 'accept').catch((e: Error) =>
        this.logger.warn(`Aceite automático falhou: ${e.message}`),
      );
    }
    return { id: result.row.id, status: result.row.status, duplicate: !result.created };
  }

  private system(integ: IntegrationRow): RequestContext {
    return {
      tenantId: integ.tenantId,
      userId: integ.createdBy,
      permissions: [],
      terminalId: null,
      storeIds: null,
    };
  }

  // ------------------------------------------------------------------ consulta ao canal

  /** Uma rodada de consulta de eventos. Falha do canal fica na integração e tenta de novo depois. */
  async poll(tenantId: string, integrationId: string): Promise<{ events: number; orders: number }> {
    const integ = await withTenant(this.db, { tenantId }, async (tx) => {
      const [r] = await tx
        .select()
        .from(channelIntegrations)
        .where(eq(channelIntegrations.id, integrationId));
      return r ?? null;
    });
    if (!integ || !integ.active) return { events: 0, orders: 0 };
    const mark = (error: string | null) =>
      withTenant(this.db, { tenantId }, (tx) =>
        tx
          .update(channelIntegrations)
          .set({ lastPollAt: new Date(), lastError: error })
          .where(eq(channelIntegrations.id, integrationId)),
      );
    let channel: OrderChannel;
    try {
      channel = this.channelFor(integ);
    } catch (e) {
      await mark((e as Error).message);
      return { events: 0, orders: 0 };
    }
    if (!channel.polling) return { events: 0, orders: 0 };
    let events;
    try {
      events = await channel.pollEvents();
    } catch (e) {
      await mark((e as Error).message.slice(0, 300));
      return { events: 0, orders: 0 };
    }
    let handled = 0;
    let created = 0;
    const done: string[] = [];
    for (const ev of events) {
      try {
        const seen = await withTenant(this.db, { tenantId }, async (tx) => {
          const [e] = await tx
            .select({ id: channelEvents.id })
            .from(channelEvents)
            .where(
              and(
                eq(channelEvents.integrationId, integ.id),
                eq(channelEvents.externalEventId, ev.id),
              ),
            );
          return !!e;
        });
        if (seen) {
          done.push(ev.id);
          continue;
        }
        // A busca no canal vem antes da transação: se falhar, o evento não é dado como visto.
        const order = ev.kind === 'placed' ? await channel.fetchOrder(ev.orderId) : null;
        const outcome = await withTenant(this.db, { tenantId }, async (tx) => {
          const [inserted] = await tx
            .insert(channelEvents)
            .values({
              id: uuidv7(),
              tenantId,
              integrationId: integ.id,
              externalEventId: ev.id,
              code: ev.code,
              orderExternalId: ev.orderId,
            })
            .onConflictDoNothing()
            .returning({ id: channelEvents.id });
          if (!inserted) return null;
          if (order) return this.ingest(tx, integ, order);
          await this.applyChannelStatus(tx, integ, ev.orderId, ev.kind);
          return null;
        });
        handled += 1;
        done.push(ev.id);
        if (outcome?.created) {
          created += 1;
          if (integ.autoAccept && outcome.row.status === 'received') {
            await this.act(this.system(integ), outcome.row.id, 'accept').catch((e: Error) =>
              this.logger.warn(`Aceite automático falhou: ${e.message}`),
            );
          }
        }
      } catch (e) {
        this.logger.warn(`Evento ${ev.id} fica para a próxima rodada: ${(e as Error).message}`);
      }
    }
    try {
      await channel.acknowledge(done);
      await mark(null);
    } catch (e) {
      await mark(`Não consegui confirmar os eventos: ${(e as Error).message}`.slice(0, 300));
    }
    return { events: handled, orders: created };
  }

  /** O canal mudou o pedido (cliente cancelou, entregador saiu, concluído). */
  private async applyChannelStatus(
    tx: Tx,
    integ: IntegrationRow,
    externalId: string,
    kind: string,
  ) {
    const [order] = await tx
      .select()
      .from(channelOrders)
      .where(
        and(eq(channelOrders.integrationId, integ.id), eq(channelOrders.externalId, externalId)),
      )
      .for('update');
    if (!order) return;
    const actor = { tenantId: integ.tenantId, userId: integ.createdBy };
    const closed = ['concluded', 'cancelled', 'rejected'];
    if (closed.includes(order.status)) return;
    if (kind === 'cancelled') {
      await this.cancelEffects(tx, order);
      await tx
        .update(channelOrders)
        .set({ status: 'cancelled', cancelReason: 'Cancelado pelo canal', updatedAt: new Date() })
        .where(eq(channelOrders.id, order.id));
      await this.audit.record(tx, actor, {
        action: 'channel.order_cancelled_by_channel',
        entity: 'channel_order',
        entityId: order.id,
        data: { externalId },
      });
    } else if (kind === 'concluded') {
      await tx
        .update(channelOrders)
        .set({ status: 'concluded', updatedAt: new Date() })
        .where(eq(channelOrders.id, order.id));
    } else if (kind === 'dispatched' && ['accepted', 'preparing', 'ready'].includes(order.status)) {
      await tx
        .update(channelOrders)
        .set({ status: 'dispatched', updatedAt: new Date() })
        .where(eq(channelOrders.id, order.id));
    }
  }

  /** Cancelamento: tira o pedido da fila do caixa (se ainda não entrou na comanda) e a conta a receber. */
  private async cancelEffects(tx: Tx, order: OrderRow) {
    if (order.tabOrderId) {
      await tx
        .update(tabOrders)
        .set({ status: 'rejected', reason: 'Pedido cancelado no canal' })
        .where(and(eq(tabOrders.id, order.tabOrderId), eq(tabOrders.status, 'pending')));
    }
    if (order.financialEntryId) {
      await tx
        .update(financialEntries)
        .set({
          status: 'cancelled',
          cancelReason: 'Pedido cancelado no canal',
          updatedAt: new Date(),
        })
        .where(
          and(eq(financialEntries.id, order.financialEntryId), eq(financialEntries.status, 'open')),
        );
    }
  }

  // ------------------------------------------------------------------ pedidos

  private async views(tx: Tx, rows: OrderRow[]): Promise<ChannelOrderView[]> {
    if (rows.length === 0) return [];
    const integs = await tx
      .select({
        id: channelIntegrations.id,
        name: channelIntegrations.name,
        provider: channelIntegrations.provider,
      })
      .from(channelIntegrations)
      .where(inArray(channelIntegrations.id, [...new Set(rows.map((r) => r.integrationId))]));
    const stats = await tx
      .select({
        orderId: channelActions.orderId,
        pending: sql<number>`count(*) filter (where ${channelActions.status} = 'pending')`,
        failed: sql<number>`count(*) filter (where ${channelActions.status} = 'failed')`,
      })
      .from(channelActions)
      .where(
        inArray(
          channelActions.orderId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(channelActions.orderId);
    return rows.map((r) => {
      const i = integs.find((x) => x.id === r.integrationId);
      const s = stats.find((x) => x.orderId === r.id);
      return {
        id: r.id,
        integrationId: r.integrationId,
        integrationName: i?.name ?? '',
        provider: i?.provider ?? 'generic',
        externalId: r.externalId,
        displayId: r.displayId,
        status: r.status,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        address: r.address,
        type: r.type,
        items: r.items.map(({ sku, name, quantity, unitPriceCents, totalCents, productId }) => ({
          sku,
          name,
          quantity,
          unitPriceCents,
          totalCents,
          productId,
        })),
        subtotalCents: r.subtotalCents,
        deliveryFeeCents: r.deliveryFeeCents,
        discountCents: r.discountCents,
        totalCents: r.totalCents,
        prepaid: r.prepaid,
        paymentMethod: r.paymentMethod,
        notes: r.notes,
        tabOrderId: r.tabOrderId,
        financialEntryId: r.financialEntryId,
        cancelReason: r.cancelReason,
        actions: availableChannelActions(r.status),
        pendingActions: Number(s?.pending ?? 0),
        failedActions: Number(s?.failed ?? 0),
        placedAt: r.placedAt.toISOString(),
      };
    });
  }

  listOrders(ctx: RequestContext, q: { status?: ChannelOrderStatus; open?: boolean }) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ o: channelOrders })
        .from(channelOrders)
        .innerJoin(channelIntegrations, eq(channelIntegrations.id, channelOrders.integrationId))
        .where(
          and(
            storeCondition(ctx, channelIntegrations.storeId),
            q.status ? eq(channelOrders.status, q.status) : undefined,
            q.open
              ? inArray(channelOrders.status, [
                  'received',
                  'needs_mapping',
                  'accepted',
                  'preparing',
                  'ready',
                ])
              : undefined,
          ),
        )
        .orderBy(desc(channelOrders.placedAt))
        .limit(100);
      return this.views(
        tx,
        rows.map((r) => r.o),
      );
    });
  }

  /** Aceitar, preparar, pronto, saiu ou recusar. A mudança local e a fila de envio ao canal saem juntas. */
  async act(ctx: RequestContext, orderId: string, action: ChannelAction, body?: unknown) {
    const reason = action === 'reject' ? parse(channelRejectInput, body ?? {}).reason : null;
    const actionId = await withTenant(this.db, ctx, async (tx) => {
      const [order] = await tx
        .select()
        .from(channelOrders)
        .where(eq(channelOrders.id, orderId))
        .for('update');
      if (!order) throw notFound('Pedido');
      const integ = await this.require(tx, ctx, order.integrationId);
      const next = channelStatusAfter(order.status, action);
      if (!next) {
        throw new AppError(409, 'invalid_transition', 'Esse pedido não aceita essa ação agora.');
      }
      let tabOrderId = order.tabOrderId;
      let financialEntryId = order.financialEntryId;
      if (action === 'accept') {
        if (order.items.some((i) => !i.productId)) {
          throw new AppError(
            422,
            'needs_mapping',
            'Ligue todos os itens a produtos antes de aceitar.',
          );
        }
        ({ tabOrderId, financialEntryId } = await this.acceptEffects(tx, ctx, integ, order));
      }
      if (action === 'reject') await this.cancelEffects(tx, order);
      await tx
        .update(channelOrders)
        .set({
          status: next,
          tabOrderId,
          financialEntryId,
          ...(reason && { cancelReason: reason }),
          updatedAt: new Date(),
        })
        .where(eq(channelOrders.id, orderId));
      const id = uuidv7();
      await tx
        .insert(channelActions)
        .values({
          id,
          tenantId: ctx.tenantId,
          integrationId: integ.id,
          orderId,
          action,
          reason,
        })
        .onConflictDoNothing();
      await this.audit.record(tx, ctx, {
        action: `channel.order_${action}`,
        entity: 'channel_order',
        entityId: orderId,
        data: { integration: integ.name, externalId: order.externalId, reason },
      });
      return id;
    });
    await this.schedule(ctx.tenantId, actionId);
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(channelOrders).where(eq(channelOrders.id, orderId));
      return (await this.views(tx, [row!]))[0]!;
    });
  }

  /** O pedido entra na fila do caixa da loja; pago online, gera o repasse a receber. */
  private async acceptEffects(tx: Tx, ctx: RequestContext, integ: IntegrationRow, order: OrderRow) {
    const qty = new Map<string, number>();
    for (const i of order.items) {
      qty.set(i.productId!, (qty.get(i.productId!) ?? 0) + i.quantity * 1000);
    }
    const brand = integ.provider === 'ifood' ? 'iFood' : integ.name.slice(0, 12);
    const label = `${brand} ${order.displayId}`;
    const tabOrderId = uuidv7();
    await tx.insert(tabOrders).values({
      id: tabOrderId,
      tenantId: ctx.tenantId,
      storeId: integ.storeId,
      label: `${label}${order.prepaid ? ' pago' : ''}`.slice(0, 30),
      items: [...qty].map(([productId, quantityMilli]) => ({ productId, quantityMilli })),
      waiterId: ctx.userId,
      waiterName: integ.name.slice(0, 60),
    });
    let financialEntryId: string | null = null;
    if (order.prepaid) {
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .orderBy(asc(companies.createdAt))
        .limit(1);
      if (company) {
        // Comissão em pontos-base, conta inteira em centavos (arredonda para baixo; sobra é do lojista).
        const fee = Math.floor((order.totalCents * integ.commissionBps) / 10_000);
        const due = new Date(order.placedAt.getTime() + integ.settlementDays * 86_400_000);
        financialEntryId = uuidv7();
        await tx.insert(financialEntries).values({
          id: financialEntryId,
          tenantId: ctx.tenantId,
          companyId: company.id,
          kind: 'receivable',
          description: `Repasse ${integ.name} - pedido ${order.displayId}`,
          category: 'Marketplace',
          document: order.externalId.slice(0, 60),
          amountCents: Math.max(1, order.totalCents - fee),
          dueDate: due.toISOString().slice(0, 10),
          groupId: uuidv7(),
          notes: fee > 0 ? `Comissão do canal descontada: ${fee} centavos` : null,
          createdBy: ctx.userId,
        });
      }
    }
    return { tabOrderId, financialEntryId };
  }

  // ------------------------------------------------------------------ envio ao canal

  async schedule(tenantId: string, actionId: string, now?: Date) {
    await this.queue
      .add(
        CHANNEL_SEND,
        { tenantId, actionId, ...(now && { now: now.toISOString() }) },
        { attempts: 3, backoffMs: 1000 },
      )
      .catch((e: Error) => this.logger.warn(`Ação ${actionId} fora da fila: ${e.message}`));
  }

  /** Uma tentativa de mandar a ação ao canal. Repetir não faz nada se ela já saiu. */
  async sendAction(job: { tenantId: string; actionId: string; now?: string }) {
    const now = job.now ? new Date(job.now) : new Date();
    const found = await withTenant(this.db, { tenantId: job.tenantId }, async (tx) => {
      // Reserva a ação (duas tarefas ao mesmo tempo não mandam duas vezes): só quem muda a
      // data da próxima tentativa segue adiante. Se a API cair no meio, ela volta em 5 minutos.
      const [claimed] = await tx
        .update(channelActions)
        .set({ nextAttemptAt: new Date(now.getTime() + 5 * 60_000) })
        .where(
          and(
            eq(channelActions.id, job.actionId),
            eq(channelActions.status, 'pending'),
            sql`${channelActions.nextAttemptAt} <= ${now}`,
          ),
        )
        .returning({ id: channelActions.id });
      if (!claimed) return null;
      const [row] = await tx
        .select({ a: channelActions, i: channelIntegrations, o: channelOrders })
        .from(channelActions)
        .innerJoin(channelIntegrations, eq(channelIntegrations.id, channelActions.integrationId))
        .innerJoin(channelOrders, eq(channelOrders.id, channelActions.orderId))
        .where(eq(channelActions.id, job.actionId));
      return row ?? null;
    });
    if (!found) return;
    const { a, i, o } = found;
    let error: string | null = null;
    let permanent = false;
    try {
      await this.channelFor(i).act(o.externalId, a.action as ChannelAction, a.reason ?? undefined);
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
      permanent = e instanceof ChannelRejectedError || e instanceof ChannelNotReadyError;
    }
    const attempts = a.attempts + 1;
    const giveUp = error !== null && (permanent || attempts > CHANNEL_RETRY_MS.length);
    await withTenant(this.db, { tenantId: job.tenantId }, (tx) =>
      tx
        .update(channelActions)
        .set(
          error === null
            ? { status: 'sent', attempts, lastError: null, sentAt: now }
            : {
                status: giveUp ? 'failed' : 'pending',
                attempts,
                lastError: error,
                nextAttemptAt: new Date(
                  now.getTime() + (CHANNEL_RETRY_MS[attempts - 1] ?? CHANNEL_RETRY_MS.at(-1)!),
                ),
              },
        )
        .where(eq(channelActions.id, a.id)),
    );
  }

  /** Ações vencidas de um cliente, de volta para a fila (a fila em memória perde tarefas). */
  async requeueDue(tenantId: string, now = new Date()) {
    const due = await withTenant(this.db, { tenantId }, (tx) =>
      tx
        .select({ id: channelActions.id })
        .from(channelActions)
        .where(
          and(eq(channelActions.status, 'pending'), sql`${channelActions.nextAttemptAt} <= ${now}`),
        )
        .limit(50),
    );
    for (const d of due) await this.schedule(tenantId, d.id, now);
    return due.length;
  }

  /** Tenta de novo, agora, a ação que desistiu. */
  async retry(ctx: RequestContext, orderId: string) {
    const ids = await withTenant(this.db, ctx, async (tx) => {
      const failed = await tx
        .select({ id: channelActions.id })
        .from(channelActions)
        .where(and(eq(channelActions.orderId, orderId), eq(channelActions.status, 'failed')));
      if (failed.length === 0) return [];
      await tx
        .update(channelActions)
        .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date() })
        .where(
          inArray(
            channelActions.id,
            failed.map((f) => f.id),
          ),
        );
      return failed.map((f) => f.id);
    });
    for (const id of ids) await this.schedule(ctx.tenantId, id);
    return { requeued: ids.length };
  }

  // ------------------------------------------------------------------ cardápio e estoque

  async syncCatalog(ctx: RequestContext, integrationId: string): Promise<ChannelCatalogSyncResult> {
    const { integ, items } = await withTenant(this.db, ctx, async (tx) => {
      const integ = await this.require(tx, ctx, integrationId);
      const rows = await tx
        .select({
          sku: channelProductLinks.sku,
          priceCents: products.priceCents,
          active: products.active,
          stock: sql<number>`coalesce((select sum(${stockMovements.deltaMilli}) from ${stockMovements} where ${stockMovements.productId} = ${products.id} and ${stockMovements.storeId} = ${integ.storeId}), 0)`,
        })
        .from(channelProductLinks)
        .innerJoin(products, eq(products.id, channelProductLinks.productId))
        .where(eq(channelProductLinks.integrationId, integrationId));
      const items: AvailabilityItem[] = rows.map((r) => {
        const units = Math.max(0, Math.floor(Number(r.stock) / 1000));
        return {
          sku: r.sku,
          priceCents: r.priceCents,
          available: r.active && units > 0,
          stockUnits: units,
        };
      });
      return { integ, items };
    });
    try {
      await this.channelFor(integ).pushAvailability(items);
      await withTenant(this.db, ctx, (tx) =>
        this.audit.record(tx, ctx, {
          action: 'channel.catalog_synced',
          entity: 'channel_integration',
          entityId: integrationId,
          data: { items: items.length },
        }),
      );
      return { sent: items.length, skipped: 0, unavailable: null };
    } catch (e) {
      if (e instanceof ChannelNotReadyError) {
        return { sent: 0, skipped: items.length, unavailable: e.message };
      }
      throw new AppError(502, 'channel_unavailable', (e as Error).message);
    }
  }

  // ------------------------------------------------------------------ simulador (só teste)

  /** Faz o "cliente" pedir no simulador: o pedido chega na próxima consulta. */
  async simulate(
    ctx: RequestContext,
    integrationId: string,
    opts: { unmapped?: boolean; prepaid?: boolean },
  ) {
    if (this.production) throw new AppError(404, 'not_found', 'Não encontrado.');
    return withTenant(this.db, ctx, async (tx) => {
      const integ = await this.require(tx, ctx, integrationId);
      if (integ.provider !== 'simulator') {
        throw new AppError(
          422,
          'not_simulator',
          'Só a integração do tipo Simulador aceita pedido de teste.',
        );
      }
      const items: NormalizedOrder['items'] = [];
      if (opts.unmapped) {
        items.push({
          sku: 'SEM-LIGACAO-1',
          name: 'Item sem ligação',
          quantity: 1,
          unitPriceCents: 1500,
          totalCents: 1500,
        });
      } else {
        const sample = await tx
          .select({ id: products.id, name: products.name, priceCents: products.priceCents })
          .from(products)
          .where(and(eq(products.active, true), eq(products.ingredient, false)))
          .orderBy(asc(products.createdAt))
          .limit(2);
        if (sample.length === 0)
          throw new AppError(422, 'no_products', 'Cadastre um produto para simular um pedido.');
        for (const p of sample) {
          items.push({
            sku: p.id,
            name: p.name,
            quantity: 2,
            unitPriceCents: p.priceCents,
            totalCents: p.priceCents * 2,
          });
          await tx
            .insert(channelProductLinks)
            .values({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              integrationId,
              sku: p.id,
              productId: p.id,
            })
            .onConflictDoNothing();
        }
      }
      const subtotal = items.reduce((s, i) => s + i.totalCents, 0);
      const fee = 600;
      const order = this.hub.place(integrationId, {
        externalId: `SIM-${uuidv7().slice(-12)}`,
        displayId: String(Math.floor(1000 + Math.random() * 9000)),
        createdAt: new Date().toISOString(),
        type: 'delivery',
        customer: { name: 'Cliente de teste', phone: '(11) 99999-0000' },
        address: 'Rua dos Testes, 100 - Centro',
        items,
        subtotalCents: subtotal,
        deliveryFeeCents: fee,
        discountCents: 0,
        totalCents: subtotal + fee,
        payment: opts.prepaid
          ? { method: 'online', prepaid: true }
          : { method: 'cash', prepaid: false, changeForCents: 10000 },
      });
      return { externalId: order.externalId, displayId: order.displayId };
    });
  }
}
