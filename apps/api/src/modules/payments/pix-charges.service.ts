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
import { PIX_PSP_INFO, pixChargeInput, uuidv7, type PixChargeView } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { assertStore } from '../../common/stores';
import type { Config } from '../../config';
import { withTenant, type Db, type TenantScope, type Tx } from '../../db/client';
import { financialEntries, paymentSettings, pixCharges, stores } from '../../db/schema';
import { settleReceivableByPix } from '../finance/pix-reconciliation';
import {
  HttpsPixTransport,
  PixApiClient,
  PixRejectedError,
  PixUnavailableError,
  type Cob,
  type PixTransport,
} from './pix-api';
import { pixPspClient, PSP_EXPIRES_SECONDS, type PixPspClient, type PspCharge } from './pix-psp';
import { publicApiBase, webhookUrls } from './webhook-urls';

/** Quanto tempo o QR do banco vale (o cliente paga na hora, no caixa). */
const EXPIRES_SECONDS = 600;
/** Consulta ao banco no máximo a cada tanto, mesmo com o caixa perguntando mais. */
const CHECK_EVERY_MS = 2000;
/** Folga depois do vencimento antes de dar o QR por vencido. */
const GRACE_MS = 60_000;

const EXPIRED_MESSAGE = 'O QR venceu ou foi cancelado. Gere outro.';

type Row = typeof pixCharges.$inferSelect;
type Settings = typeof paymentSettings.$inferSelect;

/**
 * Cobranças Pix com QR dinâmico (F8-09): pela API Pix do banco (padrão do Banco Central) ou pela
 * API própria do parceiro (Mercado Pago, PagBank, Asaas; F8-09.c). O caixa pede, mostra o QR e
 * acompanha; o Bipaê consulta pelo ID até confirmar. O "pago" vem sempre da consulta, nunca de
 * algo que chega de fora: o aviso do banco ou do parceiro (F8-09.c.2) só antecipa a consulta.
 */
@Injectable()
export class PixChargesService {
  /** Trocado nos testes pelo banco ou parceiro simulado. */
  transport: PixTransport = new HttpsPixTransport();
  private readonly box: SecretBox;
  private readonly clients = new Map<string, PixApiClient>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: Config,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
    // O PagBank recebe o endereço do aviso em cada pedido; só vale com https (F8-09.c.2).
    const url = webhookUrls(publicApiBase(config), null).pagbankUrl;
    this.pagbankNotificationUrl = url.startsWith('https://') ? url : null;
  }

  private readonly pagbankNotificationUrl: string | null;

  private async settings(tx: Tx, storeId: string): Promise<Settings | undefined> {
    const [s] = await tx.select().from(paymentSettings).where(eq(paymentSettings.storeId, storeId));
    return s;
  }

  private notConfigured(): never {
    throw new AppError(
      422,
      'pix_api_not_configured',
      'O Pix com QR dinâmico desta loja não está configurado. Veja em Meios de pagamento.',
    );
  }

  private bank(s: Settings | undefined, storeId: string) {
    if (
      !s ||
      !s.pixApiBaseUrl ||
      !s.pixApiTokenUrl ||
      !s.pixApiClientId ||
      !s.pixApiSecretSealed ||
      !s.pixKey
    ) {
      this.notConfigured();
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

  /** Cliente do parceiro; a consulta usa o provedor da cobrança, mesmo que a loja tenha mudado. */
  private psp(s: Settings | undefined, provider: Row['provider'] | null = null): PixPspClient {
    if (!s || !s.pixPspProvider || !s.pixPspTokenSealed) this.notConfigured();
    if (provider && provider !== s.pixPspProvider) this.notConfigured();
    return pixPspClient(
      {
        provider: s.pixPspProvider,
        sandbox: s.pixPspSandbox,
        token: this.box.open(s.pixPspTokenSealed),
        payerName: s.pixPspPayerName,
        payerEmail: s.pixPspPayerEmail,
        payerTaxId: s.pixPspPayerTaxId,
        customerId: s.pixPspCustomerId,
        notificationUrl: this.pagbankNotificationUrl,
      },
      this.transport,
    );
  }

  private view(row: Row): PixChargeView {
    return {
      txid: row.txid,
      amountCents: row.amountCents,
      copyPaste: row.copyPaste,
      status: row.status,
      endToEndId: row.endToEndId,
      providerName:
        row.provider === 'pix_api'
          ? 'Pix (API do banco)'
          : `Pix (${PIX_PSP_INFO[row.provider].name})`,
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

  /**
   * `options.entryId`: a cobrança quita uma conta a receber (F6-02); quando o banco ou o parceiro
   * confirma, a conta recebe baixa na mesma transação (ver `update`).
   */
  async create(
    ctx: RequestContext,
    body: unknown,
    now = new Date(),
    options: { entryId?: string; description?: string } = {},
  ): Promise<PixChargeView> {
    const input = parse(pixChargeInput, body);
    assertStore(ctx, input.storeId);
    // A conversa com o banco ou o parceiro fica fora da transação (PIE ACH-23): com ele lento,
    // a conexão do banco de dados não fica presa esperando.
    const { store, s } = await withTenant(this.db, ctx, async (tx) => {
      const [found] = await tx
        .select({ name: stores.name })
        .from(stores)
        .where(eq(stores.id, input.storeId));
      if (!found) throw notFound('Loja');
      return { store: found, s: await this.settings(tx, input.storeId) };
    });
    {
      // txid de 32 letras e números, gerado aqui: o mesmo pedido nunca vira duas cobranças.
      const txid = uuidv7().replace(/-/g, '');
      const description = options.description ?? `Compra em ${store.name}`;
      let copyPaste: string | null;
      let provider: Row['provider'] = 'pix_api';
      let externalId: string | null = null;
      let expiresAt: Date | null = null;
      if (s?.pixMode === 'psp') {
        const client = this.psp(s);
        provider = s.pixPspProvider!;
        expiresAt = new Date(now.getTime() + PSP_EXPIRES_SECONDS[provider] * 1000);
        let charge: PspCharge;
        try {
          charge = await client.create({
            reference: txid,
            amountCents: input.amountCents,
            description,
            expiresAt,
          });
        } catch (error) {
          this.failure(error);
        }
        copyPaste = charge.copyPaste;
        externalId = charge.id;
      } else {
        if (s?.pixMode !== 'api') this.notConfigured();
        const { client, key } = this.bank(s, input.storeId);
        let cob: Cob;
        try {
          cob = await client.createCharge({
            txid,
            amountCents: input.amountCents,
            key,
            expiresInSeconds: EXPIRES_SECONDS,
            description,
          });
        } catch (error) {
          this.failure(error);
        }
        copyPaste = cob.pixCopiaECola ?? null;
      }
      if (!copyPaste) {
        throw new AppError(
          422,
          'pix_without_qr',
          'A cobrança foi criada mas o QR não veio. Confira a configuração do Pix em Meios de pagamento.',
        );
      }
      const [row] = await withTenant(this.db, ctx, (tx) =>
        tx
          .insert(pixCharges)
          .values({
            id: uuidv7(),
            tenantId: ctx.tenantId,
            storeId: input.storeId,
            txid,
            provider,
            externalId,
            expiresAt,
            amountCents: input.amountCents,
            copyPaste,
            entryId: options.entryId ?? null,
            createdBy: ctx.userId,
          })
          .returning(),
      );
      return this.view(row!);
    }
  }

  /** Cobra por Pix uma conta a receber em aberto, no valor dela (F6-02). */
  async createForEntry(
    ctx: RequestContext,
    entryId: string,
    body: unknown,
    now = new Date(),
  ): Promise<PixChargeView> {
    const { storeId } = parse(entryChargeInput, body);
    const entry = await withTenant(this.db, ctx, async (tx) => {
      const [e] = await tx.select().from(financialEntries).where(eq(financialEntries.id, entryId));
      return e;
    });
    if (!entry) throw notFound('Conta');
    if (entry.kind !== 'receivable') {
      throw new AppError(422, 'not_receivable', 'Só conta a receber pode ser cobrada por Pix.');
    }
    if (entry.status !== 'open') {
      throw new AppError(409, 'entry_closed', 'Esta conta já foi paga ou cancelada.');
    }
    return this.create(ctx, { storeId, amountCents: entry.amountCents }, now, {
      entryId,
      description: entry.description.slice(0, 120),
    });
  }

  private async load(tx: Tx, ctx: RequestContext, txid: string): Promise<Row> {
    const [row] = await tx.select().from(pixCharges).where(eq(pixCharges.txid, txid));
    if (!row) throw notFound('Cobrança Pix');
    assertStore(ctx, row.storeId);
    return row;
  }

  private async update(tx: Tx, row: Row, values: Partial<Row>): Promise<PixChargeView> {
    const [updated] = await tx
      .update(pixCharges)
      .set(values)
      .where(and(eq(pixCharges.id, row.id), eq(pixCharges.status, 'pending')))
      .returning();
    // Pix confirmado de uma cobrança que quita uma conta a receber: baixa na mesma transação.
    if (updated?.status === 'paid' && updated.entryId) {
      const paidOn = new Date((updated.paidAt ?? new Date()).getTime() - 3 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      await settleReceivableByPix(tx, updated.entryId, paidOn, updated.amountCents);
    }
    return this.view(updated ?? row);
  }

  /** Grava o resultado da consulta numa transação curta, só se a cobrança ainda está pendente. */
  private apply(scope: TenantScope, row: Row, values: Partial<Row>) {
    return withTenant(this.db, scope, (tx) => this.update(tx, row, values));
  }

  /** Situação da cobrança; pendente, pergunta ao banco ou parceiro (no máximo a cada 2 segundos). */
  async get(ctx: RequestContext, txid: string, now = new Date()): Promise<PixChargeView> {
    const found = await withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, txid);
      if (row.status !== 'pending') return { done: true as const, view: this.view(row) };
      if (row.checkedAt && now.getTime() - row.checkedAt.getTime() < CHECK_EVERY_MS) {
        return { done: true as const, view: this.view(row) };
      }
      return { done: false as const, row, s: await this.settings(tx, row.storeId) };
    });
    if (found.done) return found.view;
    return this.refresh(ctx, found.row, found.s, now, false);
  }

  /**
   * Chegou um aviso do banco ou do parceiro (F8-09.c.2): consulta agora, sem esperar os 2
   * segundos, com o tenant da cobrança. O aviso não confirma nada: só a consulta. Cobrança já
   * resolvida fica como está (o aviso repetido não muda nada). Banco fora do ar vira erro, para a
   * fila tentar de novo.
   */
  async confirmFromWebhook(
    tenantId: string,
    txid: string,
    now = new Date(),
  ): Promise<PixChargeView | null> {
    const found = await withTenant(this.db, { tenantId }, async (tx) => {
      const [row] = await tx.select().from(pixCharges).where(eq(pixCharges.txid, txid));
      if (!row || row.status !== 'pending') return null;
      return { done: false as const, row, s: await this.settings(tx, row.storeId) };
    });
    if (!found) return null;
    return this.refresh({ tenantId }, found.row, found.s, now, true);
  }

  /** Pergunta ao banco ou ao parceiro; strict: erros sobem como vieram (para a fila). */
  private async refresh(
    scope: TenantScope,
    row: Row,
    s: Settings | undefined,
    now: Date,
    strict: boolean,
  ): Promise<PixChargeView> {
    if (row.provider !== 'pix_api') return this.checkPsp(scope, row, s, now, strict);
    const { client } = this.bank(s, row.storeId);
    let cob: Cob;
    try {
      cob = await client.getCharge(row.txid);
    } catch (error) {
      if (strict) throw error;
      // Banco fora do ar: segue pendente, o caixa pergunta de novo.
      if (error instanceof PixUnavailableError) return this.view(row);
      this.failure(error);
    }
    const paid = cob.status === 'CONCLUIDA' && (cob.pix?.length ?? 0) > 0;
    const removed = cob.status.startsWith('REMOVIDA');
    const expired =
      !paid && now.getTime() - row.createdAt.getTime() > EXPIRES_SECONDS * 1000 + GRACE_MS;
    return this.apply(scope, row, {
      checkedAt: now,
      ...(paid && {
        status: 'paid' as const,
        paidAt: now,
        endToEndId: cob.pix![0]!.endToEndId,
      }),
      ...(!paid &&
        (removed || expired) && { status: 'expired' as const, message: EXPIRED_MESSAGE }),
    });
  }

  private async checkPsp(
    scope: TenantScope,
    row: Row,
    s: Settings | undefined,
    now: Date,
    strict = false,
  ) {
    const client = this.psp(s, row.provider);
    let charge: PspCharge;
    try {
      charge = await client.get(row.externalId!);
    } catch (error) {
      if (strict) throw error;
      // Parceiro fora do ar: segue pendente, o caixa pergunta de novo.
      if (error instanceof PixUnavailableError) return this.view(row);
      this.failure(error);
    }
    if (charge.status === 'paid') {
      return this.apply(scope, row, {
        checkedAt: now,
        status: 'paid',
        paidAt: now,
        endToEndId: charge.paymentRef,
      });
    }
    const late = row.expiresAt !== null && now.getTime() > row.expiresAt.getTime() + GRACE_MS;
    if (charge.status === 'pending' && late) {
      // Passou do prazo: cancela no parceiro para ninguém pagar um QR que o caixa já largou.
      await client.cancel(row.externalId!).catch(() => false);
    }
    if (charge.status !== 'pending' || late) {
      return this.apply(scope, row, {
        checkedAt: now,
        status: charge.status === 'canceled' ? 'canceled' : 'expired',
        message: EXPIRED_MESSAGE,
      });
    }
    return this.apply(scope, row, { checkedAt: now });
  }

  /**
   * O caixa desistiu do QR: cancela no parceiro. Antes, confere se já não foi pago (o pagamento
   * vale mais que a desistência). Na API do banco e no PagBank não há cancelamento pela API:
   * o QR vence sozinho, e o caixa avisa.
   */
  async cancel(ctx: RequestContext, txid: string, now = new Date()): Promise<PixChargeView> {
    const found = await withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, txid);
      if (row.status !== 'pending') return { done: true as const, view: this.view(row) };
      return { done: false as const, row, s: await this.settings(tx, row.storeId) };
    });
    if (found.done) return found.view;
    const { row, s } = found;
    {
      let canceled = false;
      if (row.provider !== 'pix_api') {
        const client = this.psp(s, row.provider);
        try {
          const charge = await client.get(row.externalId!);
          if (charge.status === 'paid') {
            return this.apply(ctx, row, {
              checkedAt: now,
              status: 'paid',
              paidAt: now,
              endToEndId: charge.paymentRef,
            });
          }
          canceled = charge.status !== 'pending' || (await client.cancel(row.externalId!));
        } catch (error) {
          this.failure(error);
        }
      }
      return this.apply(ctx, row, {
        checkedAt: now,
        status: 'canceled',
        message: canceled
          ? 'Pix cancelado.'
          : 'Pix cancelado no caixa. O QR ainda vale até vencer: se o cliente pagar, o valor aparece na sua conta.',
      });
    }
  }
}

const TXID = /^[A-Za-z0-9]{26,35}$/;
const entryChargeInput = z.object({ storeId: z.string().uuid('Escolha a loja do Pix.') });

@Controller('payments/pix/charges')
export class PixChargesController {
  constructor(@Inject(PixChargesService) private readonly charges: PixChargesService) {}

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.charges.create(ctx, body);
  }

  /** Cobra uma conta a receber por Pix; o pagamento dá baixa nela sozinho (F6-02). */
  @Post('entries/:entryId')
  @RequirePermission('finance.write')
  forEntry(
    @Ctx() ctx: RequestContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: unknown,
  ) {
    return this.charges.createForEntry(ctx, entryId, body);
  }

  @Get(':txid')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('txid') txid: string) {
    if (!TXID.test(txid)) throw new AppError(422, 'invalid_txid', 'txid inválido.');
    return this.charges.get(ctx, txid);
  }

  @Post(':txid/cancel')
  @RequirePermission('pos.sell')
  cancel(@Ctx() ctx: RequestContext, @Param('txid') txid: string) {
    if (!TXID.test(txid)) throw new AppError(422, 'invalid_txid', 'txid inválido.');
    return this.charges.cancel(ctx, txid);
  }
}
