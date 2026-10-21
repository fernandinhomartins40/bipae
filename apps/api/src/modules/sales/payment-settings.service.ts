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
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import type { Config } from '../../config';
import { parsePfx } from '../fiscal/certificates.service';
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
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) config: Config,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

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
      pixApi:
        row?.pixApiBaseUrl && row.pixApiTokenUrl && row.pixApiClientId
          ? {
              baseUrl: row.pixApiBaseUrl,
              tokenUrl: row.pixApiTokenUrl,
              clientId: row.pixApiClientId,
              hasClientSecret: Boolean(row.pixApiSecretSealed),
              hasCertificate: Boolean(row.pixApiCertSealed),
            }
          : null,
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
      const [current] = await tx
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.storeId, storeId));
      // API Pix (F8-09): segredo em branco mantém o guardado; o certificado é conferido com a senha.
      const api = input.pixApi;
      let apiValues = {};
      if (api) {
        const password =
          api.certificatePassword ??
          (current?.pixApiCertPasswordSealed
            ? this.box.open(current.pixApiCertPasswordSealed)
            : '');
        if (api.certificateBase64) {
          try {
            parsePfx(Buffer.from(api.certificateBase64, 'base64'), password);
          } catch {
            throw new AppError(
              400,
              'validation',
              'Certificado ou senha do certificado inválidos.',
              [{ path: 'pixApi.certificateBase64', message: 'Certificado ou senha inválidos' }],
            );
          }
        }
        const secret = api.clientSecret || null;
        if (!secret && !current?.pixApiSecretSealed) {
          throw new AppError(400, 'validation', 'Informe o Client Secret.', [
            { path: 'pixApi.clientSecret', message: 'Informe o Client Secret' },
          ]);
        }
        apiValues = {
          pixApiBaseUrl: api.baseUrl,
          pixApiTokenUrl: api.tokenUrl,
          pixApiClientId: api.clientId,
          ...(secret && { pixApiSecretSealed: this.box.seal(secret) }),
          ...(api.certificateBase64 && {
            pixApiCertSealed: this.box.seal(api.certificateBase64),
            pixApiCertPasswordSealed: this.box.seal(password),
          }),
        };
      }
      const values = {
        ...apiValues,
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
      // Sem a API completa, o caixa usa o Pix manual (nada aprova sozinho).
      pix: s.pix === 'api' && !s.pixApi ? 'manual' : s.pix,
      // QR estático também serve de reserva para a API Pix quando o caixa está sem internet.
      ...((s.pix === 'static_qr' || s.pix === 'api') &&
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
