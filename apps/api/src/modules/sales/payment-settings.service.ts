import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  normalizePixKey,
  paymentSettingsInput,
  PAYMENT_PROVIDERS,
  type PaymentSettingsView,
  type TerminalPaymentSettings,
} from '@bipae/domain';
import { eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { notFound, parse } from '../../common/errors';
import { assertStore } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import { paymentSettings, stores } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const DEFAULTS = { card: 'manual', pix: 'manual' } as const;

/**
 * Meios de pagamento por loja (F8-08, ADR-0018): maquininha à parte, QR Code Pix com a chave da
 * loja ou o simulador. As integrações com parceiros aparecem no catálogo como "chega em breve".
 */
@Injectable()
export class PaymentSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async row(tx: Tx, storeId: string): Promise<PaymentSettingsView> {
    const [row] = await tx
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.storeId, storeId));
    return {
      storeId,
      card: row?.cardMode ?? DEFAULTS.card,
      pix: row?.pixMode ?? DEFAULTS.pix,
      pixKey: row?.pixKey ?? null,
      pixMerchantName: row?.pixMerchantName ?? null,
      pixCity: row?.pixCity ?? null,
    };
  }

  get(ctx: RequestContext, storeId: string): Promise<PaymentSettingsView> {
    assertStore(ctx, storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId));
      if (!store) throw notFound('Loja');
      return this.row(tx, storeId);
    });
  }

  save(ctx: RequestContext, storeId: string, body: unknown): Promise<PaymentSettingsView> {
    assertStore(ctx, storeId);
    const input = parse(paymentSettingsInput, body);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId));
      if (!store) throw notFound('Loja');
      const before = await this.row(tx, storeId);
      const values = {
        cardMode: input.card,
        pixMode: input.pix,
        pixKey: input.pixKey ? (normalizePixKey(input.pixKey)?.key ?? null) : null,
        pixMerchantName: input.pixMerchantName?.trim() || null,
        pixCity: input.pixCity?.trim() || null,
        updatedAt: new Date(),
      };
      await tx
        .insert(paymentSettings)
        .values({ storeId, tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({ target: paymentSettings.storeId, set: values });
      const after = await this.row(tx, storeId);
      await this.audit.record(tx, ctx, {
        action: 'payment_settings.updated',
        entity: 'store',
        entityId: storeId,
        data: { before, after },
      });
      return after;
    });
  }

  /** O que vai ao caixa no retrato de preços. */
  async forTerminal(tx: Tx, storeId: string): Promise<TerminalPaymentSettings> {
    const s = await this.row(tx, storeId);
    return {
      card: s.card,
      pix: s.pix,
      ...(s.pix === 'static_qr' &&
        s.pixKey &&
        s.pixMerchantName &&
        s.pixCity && {
          pixStatic: { key: s.pixKey, merchantName: s.pixMerchantName, city: s.pixCity },
        }),
    };
  }

  /** Marca da última mudança, para a versão do retrato. */
  async version(tx: Tx, storeId: string): Promise<string> {
    const [row] = await tx
      .select({ at: paymentSettings.updatedAt })
      .from(paymentSettings)
      .where(eq(paymentSettings.storeId, storeId));
    return row?.at.toISOString() ?? '';
  }
}

@Controller()
export class PaymentSettingsController {
  constructor(@Inject(PaymentSettingsService) private readonly settings: PaymentSettingsService) {}

  /** O catálogo: o que existe, onde roda e o que ainda chega. */
  @Get('payment-providers')
  @RequirePermission('catalog.read')
  providers() {
    return PAYMENT_PROVIDERS;
  }

  @Get('stores/:storeId/payment-settings')
  @RequirePermission('catalog.read')
  get(@Ctx() ctx: RequestContext, @Param('storeId', new ParseUUIDPipe()) storeId: string) {
    return this.settings.get(ctx, storeId);
  }

  @Put('stores/:storeId/payment-settings')
  @RequirePermission('admin.stores')
  save(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    return this.settings.save(ctx, storeId, body);
  }
}
