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
import { cardChargeInput, uuidv7, type CardChargeView } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { assertStore } from '../../common/stores';
import type { Config } from '../../config';
import { withTenant, type Db, type Tx } from '../../db/client';
import { cardCharges, paymentSettings, stores } from '../../db/schema';
import { MercadoPagoPointClient, orderOutcome, type MpOrder } from './mp-point';
import {
  HttpsPixTransport,
  PixRejectedError,
  PixUnavailableError,
  type PixTransport,
} from './pix-api';

/** Consulta ao parceiro no máximo a cada tanto, mesmo com o caixa perguntando mais. */
const CHECK_EVERY_MS = 2000;

const MESSAGES: Record<'failed' | 'canceled' | 'expired', string> = {
  failed: 'A maquininha recusou o pagamento. Tente outro cartão ou outra forma.',
  canceled: 'A cobrança foi cancelada na maquininha.',
  expired: 'O tempo para pagar na maquininha acabou. Mande de novo.',
};

/**
 * Cartão cobrado na maquininha comandada pela internet (F8-10): o caixa manda o valor, a
 * maquininha recebe sozinha e o Bipaê acompanha pelo parceiro até aprovar ou recusar. O aviso do
 * Mercado Pago (F8-09.c.2) só antecipa a consulta.
 */
@Injectable()
export class CardChargesService {
  /** Trocado nos testes pelo Mercado Pago simulado. */
  transport: PixTransport = new HttpsPixTransport();
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: Config,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  private async point(tx: Tx, storeId: string) {
    const [s] = await tx.select().from(paymentSettings).where(eq(paymentSettings.storeId, storeId));
    if (!s || s.cardMode !== 'mp_point' || !s.mpTerminalId || !s.mpAccessTokenSealed) {
      throw new AppError(
        422,
        'card_terminal_not_configured',
        'A maquininha pela internet desta loja não está configurada. Veja em Meios de pagamento.',
      );
    }
    return {
      client: new MercadoPagoPointClient(this.box.open(s.mpAccessTokenSealed), this.transport),
      terminalId: s.mpTerminalId,
    };
  }

  private view(row: typeof cardCharges.$inferSelect): CardChargeView {
    return {
      id: row.id,
      amountCents: row.amountCents,
      method: row.method,
      status: row.status,
      paymentId: row.paymentId,
      message: row.message,
    };
  }

  private failure(error: unknown): never {
    if (error instanceof PixRejectedError) {
      throw new AppError(422, 'card_terminal_rejected', error.message);
    }
    if (error instanceof PixUnavailableError) {
      throw new AppError(
        503,
        'card_terminal_unavailable',
        `${error.message} Cobre na maquininha à parte.`,
      );
    }
    throw error;
  }

  create(ctx: RequestContext, body: unknown): Promise<CardChargeView> {
    const input = parse(cardChargeInput, body);
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const { client, terminalId } = await this.point(tx, input.storeId);
      const id = uuidv7();
      let order: MpOrder;
      try {
        order = await client.createOrder({
          externalReference: id.replace(/-/g, ''),
          amountCents: input.amountCents,
          terminalId,
          method: input.method,
          description: `Compra em ${store.name}`,
        });
      } catch (error) {
        this.failure(error);
      }
      const [row] = await tx
        .insert(cardCharges)
        .values({
          id,
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          provider: 'mp_point',
          orderId: order.id,
          amountCents: input.amountCents,
          method: input.method,
          createdBy: ctx.userId,
        })
        .returning();
      return this.view(row!);
    });
  }

  private async apply(tx: Tx, row: typeof cardCharges.$inferSelect, order: MpOrder, now: Date) {
    const outcome = orderOutcome(order);
    const [updated] = await tx
      .update(cardCharges)
      .set({
        checkedAt: now,
        ...(outcome !== 'pending' && {
          status: outcome,
          message: outcome === 'paid' ? null : MESSAGES[outcome],
          paymentId: order.transactions?.payments?.[0]?.id ?? null,
        }),
      })
      .where(and(eq(cardCharges.id, row.id), eq(cardCharges.status, 'pending')))
      .returning();
    return this.view(updated ?? row);
  }

  get(ctx: RequestContext, id: string, now = new Date()): Promise<CardChargeView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(cardCharges).where(eq(cardCharges.id, id));
      if (!row) throw notFound('Cobrança no cartão');
      assertStore(ctx, row.storeId);
      if (row.status !== 'pending') return this.view(row);
      if (row.checkedAt && now.getTime() - row.checkedAt.getTime() < CHECK_EVERY_MS) {
        return this.view(row);
      }
      const { client } = await this.point(tx, row.storeId);
      try {
        return await this.apply(tx, row, await client.getOrder(row.orderId), now);
      } catch (error) {
        // Parceiro fora do ar: segue pendente, o caixa pergunta de novo.
        if (error instanceof PixUnavailableError) return this.view(row);
        this.failure(error);
      }
    });
  }

  /**
   * Chegou um aviso do Mercado Pago sobre a ordem (F8-09.c.2): consulta agora, com o tenant da
   * cobrança. O aviso não confirma nada: só a consulta. Cobrança resolvida fica como está.
   * Parceiro fora do ar vira erro, para a fila tentar de novo.
   */
  confirmFromWebhook(
    tenantId: string,
    id: string,
    now = new Date(),
  ): Promise<CardChargeView | null> {
    return withTenant(this.db, { tenantId }, async (tx) => {
      const [row] = await tx.select().from(cardCharges).where(eq(cardCharges.id, id));
      if (!row || row.status !== 'pending') return null;
      const { client } = await this.point(tx, row.storeId);
      return this.apply(tx, row, await client.getOrder(row.orderId), now);
    });
  }

  cancel(ctx: RequestContext, id: string): Promise<CardChargeView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(cardCharges).where(eq(cardCharges.id, id));
      if (!row) throw notFound('Cobrança no cartão');
      assertStore(ctx, row.storeId);
      if (row.status !== 'pending') return this.view(row);
      const { client } = await this.point(tx, row.storeId);
      try {
        return await this.apply(tx, row, await client.cancelOrder(row.orderId), new Date());
      } catch (error) {
        this.failure(error);
      }
    });
  }
}

@Controller('payments/card/charges')
export class CardChargesController {
  constructor(@Inject(CardChargesService) private readonly charges: CardChargesService) {}

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.charges.create(ctx, body);
  }

  @Get(':id')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.charges.get(ctx, id);
  }

  @Post(':id/cancel')
  @RequirePermission('pos.sell')
  cancel(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.charges.cancel(ctx, id);
  }
}
