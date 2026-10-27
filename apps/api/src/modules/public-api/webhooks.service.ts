import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  type OnModuleInit,
} from '@nestjs/common';
import {
  uuidv7,
  webhookInput,
  type WebhookCreated,
  type WebhookDeliveryView,
  type WebhookView,
} from '@bipae/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB, QUEUE } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { SecretBox } from '../../common/secrets';
import { withTenant, type Db, type Tx } from '../../db/client';
import { products, sales, webhookDeliveries, webhookEndpoints } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { publicProducts, publicSales } from './public-shapes';

export const WEBHOOK_SEND = 'webhooks.enviar';
/** Espera antes de cada nova tentativa: 1 min, 5 min, 30 min, 2 h e 12 h; depois, desiste. */
export const WEBHOOK_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const TIMEOUT_MS = 10_000;

/** Expande um IPv6 (com ou sem ::, com ou sem sufixo IPv4) nos 8 grupos de 16 bits. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number) as number[];
    text =
      text.slice(0, dotted.index) +
      ((a! << 8) | b!).toString(16) +
      ':' +
      ((c! << 8) | d!).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const numbers = groups.map((g) => Number.parseInt(g, 16));
  return numbers.length === 8 && numbers.every((n) => n >= 0 && n <= 0xffff) ? numbers : null;
}

/**
 * Endereço de rede interna, que um aviso nunca pode alcançar (a VPS é compartilhada). Cobre
 * também IPv6 que embute IPv4 (::ffff:7f00:1, NAT64 e 6to4), que o Node escreve em hexadecimal.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const g = ipv6Groups(ip);
  // Não conseguiu ler o endereço: na dúvida, recusa.
  if (!g) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const first = g[0]!;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return isPrivateAddress(v4(g[6]!, g[7]!));
  // IPv4 compatível (::a.b.c.d), :: e ::1.
  if (g.slice(0, 6).every((x) => x === 0)) return true;
  // NAT64 (64:ff9b::/96) e 6to4 (2002::/16) carregam um IPv4.
  if (first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateAddress(v4(g[6]!, g[7]!));
  }
  if (first === 0x2002) return isPrivateAddress(v4(g[1]!, g[2]!));
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 (local única)
    (first & 0xffc0) === 0xfe80 || // fe80::/10 (link local)
    (first & 0xffc0) === 0xfec0 || // fec0::/10 (site local, em desuso)
    (first & 0xff00) === 0xff00 || // ff00::/8 (multicast)
    (first === 0x2001 && g[1] === 0x0db8) // documentação
  );
}

/** Assinatura do aviso: HMAC-SHA256 de "<segundos>.<corpo>", no formato t=...,v1=... */
export function signWebhook(secret: string, body: string, seconds: number): string {
  const v1 = createHmac('sha256', secret).update(`${seconds}.${body}`).digest('hex');
  return `t=${seconds},v1=${v1}`;
}

/**
 * Webhooks da API pública (F6-01.c, ADR-0016). O aviso nasce na mesma transação do fato
 * (tabela webhook_deliveries) e é enviado pela fila, com assinatura e novas tentativas. A
 * rotina de manutenção põe de volta na fila o que venceu e não saiu (fila em memória perde
 * tarefas numa reinicialização).
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger('Webhooks');
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  onModuleInit() {
    this.queue.process(WEBHOOK_SEND, (data) =>
      this.deliver(data as { tenantId: string; deliveryId: string; at: number }),
    );
  }

  // ------------------------------------------------------------------ emissão (outbox)

  /** Grava um aviso para cada endereço ativo que assina o evento; devolve os ids. */
  async emit(tx: Tx, tenantId: string, event: string, data: unknown): Promise<string[]> {
    const endpoints = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(eq(webhookEndpoints.active, true), sql`${event} = any(${webhookEndpoints.events})`),
      );
    if (endpoints.length === 0) return [];
    const now = new Date();
    const rows = endpoints.map((e) => {
      const id = uuidv7();
      return {
        id,
        tenantId,
        endpointId: e.id,
        event,
        payload: { id, event, createdAt: now.toISOString(), tenantId, data },
        nextAttemptAt: now,
        createdAt: now,
      };
    });
    await tx.insert(webhookDeliveries).values(rows);
    return rows.map((r) => r.id);
  }

  async emitSale(tx: Tx, tenantId: string, event: string, saleId: string) {
    const [sale] = await publicSales(tx, eq(sales.id, saleId));
    return sale ? this.emit(tx, tenantId, event, sale) : [];
  }

  async emitProduct(tx: Tx, tenantId: string, productId: string) {
    const [product] = await publicProducts(tx, eq(products.id, productId));
    return product ? this.emit(tx, tenantId, 'product.updated', product) : [];
  }

  /** Põe os avisos na fila (depois da transação que os gravou). */
  async schedule(tenantId: string, ids: string[]) {
    for (const deliveryId of ids) {
      await this.queue
        .add(
          WEBHOOK_SEND,
          { tenantId, deliveryId, at: Date.now() },
          { attempts: 5, backoffMs: 1000 },
        )
        .catch((error: Error) =>
          this.logger.warn(`Aviso ${deliveryId} fora da fila: ${error.message}`),
        );
    }
  }

  // ------------------------------------------------------------------ envio

  private async assertSafeUrl(raw: string) {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if (this.config.NODE_ENV !== 'production' && local) return;
    if (url.protocol !== 'https:') throw new Error('O endereço precisa ser https://.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error('O endereço aponta para uma rede interna, que não pode receber avisos.');
    }
  }

  /** Uma tentativa de entrega. Falha de rede ou resposta fora de 2xx agenda a próxima. */
  async deliver(job: { tenantId: string; deliveryId: string; at: number }, now = new Date()) {
    const found = await withTenant(this.db, { tenantId: job.tenantId }, async (tx) => {
      const [row] = await tx
        .select({ d: webhookDeliveries, e: webhookEndpoints })
        .from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .where(eq(webhookDeliveries.id, job.deliveryId));
      return row ?? null;
    });
    if (!found) {
      // A transação que gravou o aviso pode não ter terminado: a fila tenta de novo.
      if (Date.now() - job.at < 60_000) throw new Error('Aviso ainda não gravado.');
      return;
    }
    const { d, e } = found;
    if (d.status !== 'pending' || d.nextAttemptAt.getTime() > now.getTime() + 1000) return;

    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      if (!e.active) throw new Error('Endereço desativado.');
      await this.assertSafeUrl(e.url);
      const seconds = Math.floor(now.getTime() / 1000);
      const res = await fetch(e.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Bipae-Webhooks/1',
          'x-bipae-event': d.event,
          'x-bipae-delivery': d.id,
          'x-bipae-signature': signWebhook(this.box.open(e.secretSealed), body, seconds),
        },
        body,
      });
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (status < 200 || status >= 300) error = `O endereço respondeu ${status}.`;
    } catch (err) {
      error = (err as Error).message.slice(0, 300);
    }
    const attempts = d.attempts + 1;
    const giveUp = error !== null && (attempts > WEBHOOK_RETRY_MS.length || !e.active);
    await withTenant(this.db, { tenantId: job.tenantId }, (tx) =>
      tx
        .update(webhookDeliveries)
        .set(
          error === null
            ? { status: 'sent', attempts, lastStatus: status, lastError: null, deliveredAt: now }
            : {
                status: giveUp ? 'failed' : 'pending',
                attempts,
                lastStatus: status,
                lastError: error,
                nextAttemptAt: new Date(
                  now.getTime() + (WEBHOOK_RETRY_MS[attempts - 1] ?? WEBHOOK_RETRY_MS.at(-1)!),
                ),
              },
        )
        .where(eq(webhookDeliveries.id, d.id)),
    );
  }

  // ------------------------------------------------------------------ cadastro

  private async views(
    tx: Tx,
    rows: (typeof webhookEndpoints.$inferSelect)[],
  ): Promise<WebhookView[]> {
    const stats = rows.length
      ? await tx
          .select({
            endpointId: webhookDeliveries.endpointId,
            pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'pending')`,
            failed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')`,
            last: sql<Date | null>`max(${webhookDeliveries.deliveredAt})`,
          })
          .from(webhookDeliveries)
          .where(
            inArray(
              webhookDeliveries.endpointId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(webhookDeliveries.endpointId)
      : [];
    return rows.map((r) => {
      const s = stats.find((x) => x.endpointId === r.id);
      return {
        id: r.id,
        url: r.url,
        events: r.events,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
        pending: Number(s?.pending ?? 0),
        failed: Number(s?.failed ?? 0),
        lastDeliveryAt: s?.last ? new Date(s.last).toISOString() : null,
      };
    });
  }

  private async checkUrl(url: string) {
    try {
      await this.assertSafeUrl(url);
    } catch (err) {
      throw new AppError(422, 'invalid_webhook_url', (err as Error).message);
    }
  }

  list(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) =>
      this.views(
        tx,
        await tx.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)),
      ),
    );
  }

  async create(ctx: RequestContext, input: z.output<typeof webhookInput>): Promise<WebhookCreated> {
    await this.checkUrl(input.url);
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          url: input.url,
          events: input.events,
          active: input.active,
          secretSealed: this.box.seal(secret),
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'webhook.created',
        entity: 'webhook',
        entityId: row!.id,
        data: { url: input.url, events: input.events },
      });
      return { ...(await this.views(tx, [row!]))[0]!, secret };
    });
  }

  async update(ctx: RequestContext, id: string, input: z.output<typeof webhookInput>) {
    await this.checkUrl(input.url);
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(webhookEndpoints)
        .set({ url: input.url, events: input.events, active: input.active, updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id))
        .returning();
      if (!row) throw notFound('Webhook');
      await this.audit.record(tx, ctx, {
        action: 'webhook.updated',
        entity: 'webhook',
        entityId: id,
        data: input,
      });
      return (await this.views(tx, [row]))[0]!;
    });
  }

  /** Gera outro segredo (o anterior para de valer na hora). */
  async rotate(ctx: RequestContext, id: string): Promise<WebhookCreated> {
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(webhookEndpoints)
        .set({ secretSealed: this.box.seal(secret), updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id))
        .returning();
      if (!row) throw notFound('Webhook');
      await this.audit.record(tx, ctx, {
        action: 'webhook.secret_rotated',
        entity: 'webhook',
        entityId: id,
        data: { url: row.url },
      });
      return { ...(await this.views(tx, [row]))[0]!, secret };
    });
  }

  /** Aviso de teste ("ping") só para este endereço, para o parceiro conferir a assinatura. */
  async ping(ctx: RequestContext, id: string) {
    const deliveryId = await withTenant(this.db, ctx, async (tx) => {
      const [e] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
      if (!e) throw notFound('Webhook');
      const now = new Date();
      const did = uuidv7();
      await tx.insert(webhookDeliveries).values({
        id: did,
        tenantId: ctx.tenantId,
        endpointId: id,
        event: 'ping',
        payload: {
          id: did,
          event: 'ping',
          createdAt: now.toISOString(),
          tenantId: ctx.tenantId,
          data: { message: 'Bipou? Bipaê! O endereço está recebendo os avisos.' },
        },
        nextAttemptAt: now,
        createdAt: now,
      });
      return did;
    });
    await this.schedule(ctx.tenantId, [deliveryId]);
    return { deliveryId };
  }

  deliveries(ctx: RequestContext, id: string): Promise<WebhookDeliveryView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50);
      return rows.map((r) => ({
        id: r.id,
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        lastStatus: r.lastStatus,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: r.status === 'pending' ? r.nextAttemptAt.toISOString() : null,
      }));
    });
  }
}

@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}

  @Get()
  @RequirePermission('admin.integrations')
  list(@Ctx() ctx: RequestContext) {
    return this.webhooks.list(ctx);
  }

  @Post()
  @RequirePermission('admin.integrations')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.webhooks.create(ctx, parse(webhookInput, body));
  }

  @Put(':id')
  @RequirePermission('admin.integrations')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.webhooks.update(ctx, id, parse(webhookInput, body));
  }

  @Post(':id/secret')
  @RequirePermission('admin.integrations')
  rotate(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webhooks.rotate(ctx, id);
  }

  @Post(':id/ping')
  @RequirePermission('admin.integrations')
  ping(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webhooks.ping(ctx, id);
  }

  @Get(':id/deliveries')
  @RequirePermission('admin.integrations')
  deliveries(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.webhooks.deliveries(ctx, id);
  }
}
