import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { pixChargeInput, uuidv7, type PixChargeView } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { assertStore } from '../../common/stores';
import type { Config } from '../../config';
import { withTenant, type Db, type Tx } from '../../db/client';
import { paymentSettings, pixCharges, stores } from '../../db/schema';
import {
  HttpsPixTransport,
  PixApiClient,
  PixRejectedError,
  PixUnavailableError,
  type Cob,
  type PixTransport,
} from './pix-api';

/** Quanto tempo o QR vale (o cliente paga na hora, no caixa). */
const EXPIRES_SECONDS = 600;
/** Consulta ao banco no máximo a cada tanto, mesmo com o caixa perguntando mais. */
const CHECK_EVERY_MS = 2000;

/**
 * Cobranças Pix pela API do banco (F8-09): o caixa pede, mostra o QR e acompanha; o Bipaê
 * consulta o banco pelo txid até confirmar. Nunca confia só no que chega de fora: o "pago"
 * vem sempre da consulta ao banco.
 */
@Injectable()
export class PixChargesService {
  /** Trocado nos testes pelo banco simulado. */
  transport: PixTransport = new HttpsPixTransport();
  private readonly box: SecretBox;
  private readonly clients = new Map<string, PixApiClient>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: Config,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  private async client(tx: Tx, storeId: string) {
    const [s] = await tx.select().from(paymentSettings).where(eq(paymentSettings.storeId, storeId));
    if (
      !s ||
      s.pixMode !== 'api' ||
      !s.pixApiBaseUrl ||
      !s.pixApiTokenUrl ||
      !s.pixApiClientId ||
      !s.pixApiSecretSealed ||
      !s.pixKey
    ) {
      throw new AppError(
        422,
        'pix_api_not_configured',
        'A API Pix desta loja não está configurada. Veja em Meios de pagamento.',
      );
    }
    // Um cliente por configuração (o token fica guardado entre as cobranças).
    const cacheKey = `${storeId}:${s.updatedAt.toISOString()}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new PixApiClient(
        {
          baseUrl: s.pixApiBaseUrl,
          tokenUrl: s.pixApiTokenUrl,
          clientId: s.pixApiClientId,
          clientSecret: this.box.open(s.pixApiSecretSealed),
          tls: s.pixApiCertSealed
            ? {
                pfx: Buffer.from(this.box.open(s.pixApiCertSealed), 'base64'),
                passphrase: s.pixApiCertPasswordSealed
                  ? this.box.open(s.pixApiCertPasswordSealed)
                  : '',
              }
            : null,
        },
        this.transport,
      );
      this.clients.set(cacheKey, client);
    }
    return { client, key: s.pixKey };
  }

  private view(row: typeof pixCharges.$inferSelect): PixChargeView {
    return {
      txid: row.txid,
      amountCents: row.amountCents,
      copyPaste: row.copyPaste,
      status: row.status,
      endToEndId: row.endToEndId,
      message: row.message,
    };
  }

  private failure(error: unknown): never {
    if (error instanceof PixRejectedError) throw new AppError(422, 'pix_rejected', error.message);
    if (error instanceof PixUnavailableError) {
      throw new AppError(
        503,
        'pix_unavailable',
        `${error.message} Tente de novo ou use outro meio.`,
      );
    }
    throw error;
  }

  create(ctx: RequestContext, body: unknown): Promise<PixChargeView> {
    const input = parse(pixChargeInput, body);
    assertStore(ctx, input.storeId);
    return withTenant(this.db, ctx, async (tx) => {
      const [store] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      const { client, key } = await this.client(tx, input.storeId);
      // txid de 32 letras e números, gerado aqui: o mesmo pedido nunca vira duas cobranças.
      const txid = uuidv7().replace(/-/g, '');
      let cob: Cob;
      try {
        cob = await client.createCharge({
          txid,
          amountCents: input.amountCents,
          key,
          expiresInSeconds: EXPIRES_SECONDS,
          description: `Compra em ${store.name}`,
        });
      } catch (error) {
        this.failure(error);
      }
      if (!cob.pixCopiaECola) {
        throw new AppError(
          422,
          'pix_without_qr',
          'O banco criou a cobrança mas não devolveu o QR. Confira a configuração da API Pix.',
        );
      }
      const [row] = await tx
        .insert(pixCharges)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          txid,
          amountCents: input.amountCents,
          copyPaste: cob.pixCopiaECola,
          createdBy: ctx.userId,
        })
        .returning();
      return this.view(row!);
    });
  }

  /** Situação da cobrança; pendente, pergunta ao banco (no máximo a cada 2 segundos). */
  get(ctx: RequestContext, txid: string, now = new Date()): Promise<PixChargeView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(pixCharges).where(eq(pixCharges.txid, txid));
      if (!row) throw notFound('Cobrança Pix');
      assertStore(ctx, row.storeId);
      if (row.status !== 'pending') return this.view(row);
      if (row.checkedAt && now.getTime() - row.checkedAt.getTime() < CHECK_EVERY_MS) {
        return this.view(row);
      }
      const { client } = await this.client(tx, row.storeId);
      let cob: Cob;
      try {
        cob = await client.getCharge(txid);
      } catch (error) {
        // Banco fora do ar: segue pendente, o caixa pergunta de novo.
        if (error instanceof PixUnavailableError) return this.view(row);
        this.failure(error);
      }
      const paid = cob.status === 'CONCLUIDA' && (cob.pix?.length ?? 0) > 0;
      const removed = cob.status.startsWith('REMOVIDA');
      const expired =
        !paid && now.getTime() - row.createdAt.getTime() > (EXPIRES_SECONDS + 60) * 1000;
      const [updated] = await tx
        .update(pixCharges)
        .set({
          checkedAt: now,
          ...(paid && {
            status: 'paid' as const,
            paidAt: now,
            endToEndId: cob.pix![0]!.endToEndId,
          }),
          ...(!paid &&
            (removed || expired) && {
              status: 'expired' as const,
              message: 'O QR venceu ou foi cancelado no banco. Gere outro.',
            }),
        })
        .where(and(eq(pixCharges.txid, txid), eq(pixCharges.status, 'pending')))
        .returning();
      return this.view(updated ?? row);
    });
  }
}

@Controller('payments/pix/charges')
export class PixChargesController {
  constructor(@Inject(PixChargesService) private readonly charges: PixChargesService) {}

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.charges.create(ctx, body);
  }

  @Get(':txid')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('txid') txid: string) {
    if (!/^[A-Za-z0-9]{26,35}$/.test(txid))
      throw new AppError(422, 'invalid_txid', 'txid inválido.');
    return this.charges.get(ctx, txid);
  }
}
