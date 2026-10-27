import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { eq, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { Public } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { mercadoflowLinks, mercadoflowWebhookDeliveries } from '../../db/schema';

export interface MercadoflowEvent {
  event: string;
  marketId: string | null;
  occurredAt?: string;
  data: Record<string, unknown>;
}

/** Trata um aviso. Roda no papel da plataforma, porque o aviso chega sem cliente logado. */
export type WebhookHandler = (tx: Tx, event: MercadoflowEvent) => Promise<void>;

/** Assinatura do aviso: HMAC-SHA256 do corpo cru com o segredo do webhook (seção 8). */
export function signWebhook(rawBody: Buffer | string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * Avisos do MercadoFlow (seção 8 do contrato): confere a assinatura, ignora entrega repetida e
 * trata o evento. O aviso chega só com o id do mercado, então a loja é achada pelo vínculo, no
 * papel da plataforma (ADR-0015).
 */
@Injectable()
export class MercadoflowWebhooks {
  private readonly logger = new Logger('MercadoFlow');
  private readonly handlers = new Map<string, WebhookHandler>();
  /** Tarefas depois que o aviso foi gravado (chamadas ao MercadoFlow ficam fora da transação). */
  private readonly afterHandlers = new Map<
    string,
    ((event: MercadoflowEvent) => Promise<void>)[]
  >();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {
    this.on('connection.authorized', (tx, event) => this.authorized(tx, event));
    this.on('connection.revoked', (tx, event) => this.revoked(tx, event));
  }

  on(event: string, handler: WebhookHandler) {
    this.handlers.set(event, handler);
  }

  after(event: string, fn: (event: MercadoflowEvent) => Promise<void>) {
    this.afterHandlers.set(event, [...(this.afterHandlers.get(event) ?? []), fn]);
  }

  verify(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.MERCADOFLOW_WEBHOOK_SECRET;
    if (!secret || !rawBody || !signature)
      throw new AppError(401, 'invalid_signature', 'Assinatura inválida.');
    const expected = Buffer.from(signWebhook(rawBody, secret));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new AppError(401, 'invalid_signature', 'Assinatura inválida.');
    }
  }

  /** Guarda a entrega (uma vez só) e trata o evento. Devolve false quando era repetida. */
  async receive(deliveryId: string, event: MercadoflowEvent): Promise<boolean> {
    const inserted = await asPlatform(this.db, (tx) =>
      tx
        .insert(mercadoflowWebhookDeliveries)
        .values({ deliveryId, event: event.event, marketId: event.marketId, payload: event })
        .onConflictDoNothing()
        .returning({ id: mercadoflowWebhookDeliveries.deliveryId }),
    );
    if (inserted.length === 0) return false;
    const handler = this.handlers.get(event.event);
    // Evento de um módulo ainda não construído fica guardado, sem data de tratamento.
    if (!handler) return true;
    try {
      await asPlatform(this.db, async (tx) => {
        await handler(tx, event);
        await tx
          .update(mercadoflowWebhookDeliveries)
          .set({ processedAt: new Date() })
          .where(eq(mercadoflowWebhookDeliveries.deliveryId, deliveryId));
      });
      for (const fn of this.afterHandlers.get(event.event) ?? []) {
        await fn(event).catch((error: Error) =>
          this.logger.warn(`Depois do aviso ${event.event}: ${error.message}`),
        );
      }
    } catch (error) {
      this.logger.error(`Aviso ${event.event} falhou: ${(error as Error).message}`);
      await asPlatform(this.db, (tx) =>
        tx
          .update(mercadoflowWebhookDeliveries)
          .set({ error: (error as Error).message.slice(0, 500) })
          .where(eq(mercadoflowWebhookDeliveries.deliveryId, deliveryId)),
      );
    }
    return true;
  }

  /** O dono aprovou o vínculo: a loja é a do externalStoreId (ou a que já tinha esse mercado). */
  private async authorized(tx: Tx, event: MercadoflowEvent) {
    const storeId =
      typeof event.data.externalStoreId === 'string' ? event.data.externalStoreId : null;
    if (!event.marketId) throw new Error('Aviso sem o id do mercado.');
    const isUuid = storeId && /^[0-9a-f-]{36}$/i.test(storeId);
    const [link] = await tx
      .select()
      .from(mercadoflowLinks)
      .where(
        isUuid
          ? or(eq(mercadoflowLinks.storeId, storeId), eq(mercadoflowLinks.marketId, event.marketId))
          : eq(mercadoflowLinks.marketId, event.marketId),
      );
    if (!link) throw new Error('Nenhuma loja do Bipaê espera este vínculo.');
    const scopes = Array.isArray(event.data.scopes) ? event.data.scopes.map(String) : link.scopes;
    await tx
      .update(mercadoflowLinks)
      .set({
        marketId: event.marketId,
        status: 'ATIVA',
        scopes,
        connectedAt: link.connectedAt ?? new Date(),
        revokedAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mercadoflowLinks.id, link.id));
  }

  private async revoked(tx: Tx, event: MercadoflowEvent) {
    if (!event.marketId) throw new Error('Aviso sem o id do mercado.');
    const by = typeof event.data.revokedBy === 'string' ? event.data.revokedBy : 'MercadoFlow';
    await tx
      .update(mercadoflowLinks)
      .set({
        status: 'REVOGADA',
        revokedAt: new Date(),
        lastError: `Vínculo encerrado no MercadoFlow por ${by}.`,
        updatedAt: new Date(),
      })
      .where(eq(mercadoflowLinks.marketId, event.marketId));
  }
}

@Controller('integrations/mercadoflow')
export class MercadoflowWebhookController {
  constructor(@Inject(MercadoflowWebhooks) private readonly webhooks: MercadoflowWebhooks) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 600, timeWindow: '1 minute' } })
  async webhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-mercadoflow-signature') signature: string | undefined,
    @Headers('x-mercadoflow-delivery') delivery: string | undefined,
  ) {
    this.webhooks.verify(request.rawBody, signature);
    if (!delivery) throw new AppError(400, 'validation', 'Aviso sem o id da entrega.');
    const body = (request.body ?? {}) as Partial<MercadoflowEvent>;
    if (typeof body.event !== 'string')
      throw new AppError(400, 'validation', 'Aviso sem o evento.');
    const fresh = await this.webhooks.receive(delivery, {
      event: body.event,
      marketId: typeof body.marketId === 'string' ? body.marketId : null,
      ...(typeof body.occurredAt === 'string' && { occurredAt: body.occurredAt }),
      data: (body.data ?? {}) as Record<string, unknown>,
    });
    return { received: true, repeated: !fresh };
  }
}
