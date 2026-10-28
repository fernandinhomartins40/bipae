import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  Post,
  Query,
  Req,
  type OnModuleInit,
  type RawBodyRequest,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { and, eq, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth';
import { CONFIG, DB, QUEUE } from '../../common/di';
import type { JobQueue } from '../../common/queue';
import { SecretBox } from '../../common/secrets';
import type { Config } from '../../config';
import { asPlatform, withTenant, type Db } from '../../db/client';
import { cardCharges, paymentSettings, pixCharges } from '../../db/schema';
import { CardChargesService } from './card-charges.service';
import { PixUnavailableError } from './pix-api';
import { PixChargesService } from './pix-charges.service';

/**
 * Avisos (webhooks) do banco e dos parceiros de pagamento (F8-09.c.2, ADR-0018). Documentação
 * oficial conferida em 22/10/2026:
 * - API Pix do Banco Central: o banco chama POST {webhookUrl}/pix com { pix: [{ endToEndId, txid,
 *   valor, horario }] }; a URL é cadastrada no banco por PUT /webhook/{chave}. O padrão protege a
 *   chamada com mTLS; atrás do proxy o Bipaê não vê o certificado, então a URL leva um segredo da
 *   loja (como os bancos oferecem para quem não valida o mTLS). https://bacen.github.io/pix-api/
 * - Mercado Pago: POST com { type: "payment" | "order", action, data: { id } } e ?data.id=&type=;
 *   cabeçalho x-signature "ts=...,v1=..." = HMAC-SHA256 em hexadecimal, com a assinatura secreta
 *   da loja, de "id:{data.id};request-id:{x-request-id};ts:{ts};" (partes ausentes saem).
 *   https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 * - PagBank: o pedido manda notification_urls; o aviso traz o pedido e o cabeçalho
 *   x-authenticity-token = SHA-256 de "{token}-{corpo cru}".
 *   https://developer.pagbank.com.br/docs/confirmar-autenticidade-da-notificacao
 * - Asaas: { id, event: "PAYMENT_...", payment: { id, externalReference } } com o authToken do
 *   webhook no cabeçalho asaas-access-token.
 *   https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
 *
 * Regras (CLAUDE.md): o aviso nunca confirma sozinho. asPlatform() serve só para achar a
 * cobrança pelo identificador do aviso; o resto roda com o tenant dela, e a confirmação vem da
 * consulta ao banco ou ao parceiro (a mesma do caixa). Aviso repetido, desconhecido, com
 * assinatura errada ou de cobrança resolvida responde igual e não muda nada.
 */

export const PAYMENT_WEBHOOK_JOB = 'payments:webhook-check';
/** Maior corpo aceito: os avisos têm poucos KB. */
export const WEBHOOK_MAX_BYTES = 64 * 1024;
/** Quantos Pix um aviso do banco pode listar (o resto é ignorado). */
const MAX_ITEMS = 50;
const TXID = /^[A-Za-z0-9]{26,35}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,100}$/;
/** Identificadores dos parceiros (números, ORD..., ORDE_..., pay_...). */
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Resposta única para qualquer aviso: não conta se a cobrança existe nem se a assinatura bateu. */
const RECEIVED = { received: true } as const;
/** Os parceiros mandam rajadas; o limite é por endereço de origem. */
const RATE_LIMIT = { rateLimit: { max: 600, timeWindow: '1 minute' } };

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Assinatura do aviso do Mercado Pago (x-signature). */
export function mercadoPagoSignature(
  secret: string,
  parts: { dataId?: string | null; requestId?: string | null; ts: string },
): string {
  const manifest =
    (parts.dataId ? `id:${parts.dataId};` : '') +
    (parts.requestId ? `request-id:${parts.requestId};` : '') +
    `ts:${parts.ts};`;
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

export function verifyMercadoPago(
  secret: string,
  header: string | undefined,
  requestId: string | undefined,
  dataId: string,
): boolean {
  if (!header) return false;
  const fields = new Map(
    header.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k ?? '', v.join('=')] as const;
    }),
  );
  const ts = fields.get('ts');
  const v1 = fields.get('v1');
  if (!ts || !v1) return false;
  // A documentação pede o data.id em minúsculas quando é alfanumérico; aceitamos as duas formas.
  return [dataId, dataId.toLowerCase()].some((id) =>
    sameText(mercadoPagoSignature(secret, { dataId: id, requestId, ts }), v1),
  );
}

/** Assinatura do aviso do PagBank (x-authenticity-token). */
export function pagBankSignature(token: string, rawBody: string): string {
  return createHash('sha256').update(`${token}-${rawBody}`, 'utf8').digest('hex');
}

interface CheckJob {
  kind: 'pix' | 'card';
  tenantId: string;
  /** txid da cobrança Pix ou id da cobrança no cartão. */
  ref: string;
}

type Proof =
  | { kind: 'store-token'; value: string | undefined }
  | {
      kind: 'mercadopago';
      signature: string | undefined;
      requestId: string | undefined;
      dataId: string;
    }
  | { kind: 'pagbank'; signature: string | undefined; rawBody: string };

interface Found {
  kind: 'pix' | 'card';
  tenantId: string;
  storeId: string;
  ref: string;
}

@Injectable()
export class PaymentWebhooksService implements OnModuleInit {
  private readonly logger = new Logger('Pagamentos');
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(PixChargesService) private readonly pix: PixChargesService,
    @Inject(CardChargesService) private readonly card: CardChargesService,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  onModuleInit() {
    this.queue.process(PAYMENT_WEBHOOK_JOB, (data) => this.check(data as CheckJob));
  }

  /**
   * Confere a cobrança no banco ou no parceiro, com o tenant dela. Pode rodar duas vezes: o que
   * já não está pendente fica como está. Banco fora do ar volta para a fila (nova tentativa).
   */
  async check(job: CheckJob): Promise<void> {
    try {
      if (job.kind === 'pix') await this.pix.confirmFromWebhook(job.tenantId, job.ref);
      else await this.card.confirmFromWebhook(job.tenantId, job.ref);
    } catch (error) {
      if (error instanceof PixUnavailableError) throw error;
      // Configuração mudou ou o parceiro recusou: o caixa segue consultando; nada a repetir.
      this.logger.warn(`Aviso de pagamento não conferido: ${(error as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ busca (papel da plataforma)
  // Só aqui o asPlatform: acha a cobrança pelo identificador do aviso e devolve tenant e loja.

  private findPix(
    provider: 'pix_api' | 'mercadopago' | 'pagbank' | 'asaas',
    by: { txid?: string | null; externalId?: string | null },
  ): Promise<Found[]> {
    const conditions = [
      by.txid ? eq(pixCharges.txid, by.txid) : undefined,
      by.externalId ? eq(pixCharges.externalId, by.externalId) : undefined,
    ].filter((c) => c !== undefined);
    if (conditions.length === 0) return Promise.resolve([]);
    return asPlatform(this.db, async (tx) => {
      const rows = await tx
        .select({
          tenantId: pixCharges.tenantId,
          storeId: pixCharges.storeId,
          ref: pixCharges.txid,
        })
        .from(pixCharges)
        .where(and(eq(pixCharges.provider, provider), or(...conditions)))
        .limit(5);
      return rows.map((r) => ({ kind: 'pix' as const, ...r }));
    });
  }

  private findCard(orderId: string): Promise<Found[]> {
    return asPlatform(this.db, async (tx) => {
      const rows = await tx
        .select({
          tenantId: cardCharges.tenantId,
          storeId: cardCharges.storeId,
          ref: cardCharges.id,
        })
        .from(cardCharges)
        .where(and(eq(cardCharges.provider, 'mp_point'), eq(cardCharges.orderId, orderId)))
        .limit(5);
      return rows.map((r) => ({ kind: 'card' as const, ...r }));
    });
  }

  // ------------------------------------------------------------------ conferência (tenant da loja)

  /** Confere a prova do aviso com os segredos da loja da cobrança, no tenant dela. */
  private async trusted(found: Found, proof: Proof): Promise<boolean> {
    const s = await withTenant(this.db, { tenantId: found.tenantId }, async (tx) => {
      const [row] = await tx
        .select({
          token: paymentSettings.webhookTokenSealed,
          mpSecret: paymentSettings.mpWebhookSecretSealed,
          pspProvider: paymentSettings.pixPspProvider,
          pspToken: paymentSettings.pixPspTokenSealed,
        })
        .from(paymentSettings)
        .where(eq(paymentSettings.storeId, found.storeId));
      return row;
    });
    if (!s) return false;
    try {
      switch (proof.kind) {
        case 'store-token':
          return Boolean(s.token && proof.value && sameText(this.box.open(s.token), proof.value));
        case 'mercadopago':
          return Boolean(
            s.mpSecret &&
            verifyMercadoPago(
              this.box.open(s.mpSecret),
              proof.signature,
              proof.requestId,
              proof.dataId,
            ),
          );
        case 'pagbank':
          return Boolean(
            s.pspProvider === 'pagbank' &&
            s.pspToken &&
            proof.signature &&
            sameText(
              pagBankSignature(this.box.open(s.pspToken), proof.rawBody),
              proof.signature.trim().toLowerCase(),
            ),
          );
      }
    } catch {
      return false;
    }
  }

  private async dispatch(found: Found[], proof: Proof): Promise<number> {
    let queued = 0;
    for (const f of found) {
      if (!(await this.trusted(f, proof))) continue;
      await this.queue.add(
        PAYMENT_WEBHOOK_JOB,
        { kind: f.kind, tenantId: f.tenantId, ref: f.ref },
        { dedupeId: `${PAYMENT_WEBHOOK_JOB}:${f.kind}:${f.ref}` },
      );
      queued++;
    }
    return queued;
  }

  // ------------------------------------------------------------------ cada parceiro

  /** API Pix do banco: lista de Pix recebidos, cada um com o txid da cobrança. */
  async pixApi(token: string, body: unknown): Promise<number> {
    if (!TOKEN.test(token)) return 0;
    const list = (body as { pix?: unknown } | null)?.pix;
    if (!Array.isArray(list)) return 0;
    const txids = new Set<string>();
    for (const item of list.slice(0, MAX_ITEMS)) {
      const txid = (item as { txid?: unknown } | null)?.txid;
      if (typeof txid === 'string' && TXID.test(txid)) txids.add(txid);
    }
    let queued = 0;
    for (const txid of txids) {
      const found = await this.findPix('pix_api', { txid });
      queued += await this.dispatch(found, { kind: 'store-token', value: token });
    }
    return queued;
  }

  /** Mercado Pago: pagamento (Pix) ou ordem (Point). */
  async mercadoPago(
    body: unknown,
    query: Record<string, unknown>,
    signature: string | undefined,
    requestId: string | undefined,
  ): Promise<number> {
    const b = (body ?? {}) as { type?: unknown; topic?: unknown; data?: { id?: unknown } };
    const type = String(query.type ?? query.topic ?? b.type ?? b.topic ?? '');
    // O id que entra na assinatura é o da URL (data.id); sem ele, o do corpo.
    const rawId = query['data.id'] ?? query.id ?? b.data?.id;
    const dataId = typeof rawId === 'number' ? String(rawId) : rawId;
    if (typeof dataId !== 'string' || !EXTERNAL_ID.test(dataId)) return 0;
    const proof: Proof = { kind: 'mercadopago', signature, requestId, dataId };
    if (type === 'payment') {
      return this.dispatch(await this.findPix('mercadopago', { externalId: dataId }), proof);
    }
    if (type === 'order') {
      return this.dispatch(await this.findCard(dataId.toUpperCase()), proof);
    }
    return 0;
  }

  /** PagBank: o aviso traz o pedido (id ORDE_... e o reference_id, que é o nosso txid). */
  async pagBank(body: unknown, rawBody: string, signature: string | undefined): Promise<number> {
    const b = (body ?? {}) as { id?: unknown; reference_id?: unknown };
    const externalId = typeof b.id === 'string' && EXTERNAL_ID.test(b.id) ? b.id : null;
    const txid =
      typeof b.reference_id === 'string' && TXID.test(b.reference_id) ? b.reference_id : null;
    const found = await this.findPix('pagbank', { externalId, txid });
    return this.dispatch(found, { kind: 'pagbank', signature, rawBody });
  }

  /** Asaas: só eventos de cobrança (PAYMENT_...). */
  async asaas(body: unknown, token: string | undefined): Promise<number> {
    const b = (body ?? {}) as {
      event?: unknown;
      payment?: { id?: unknown; externalReference?: unknown };
    };
    if (typeof b.event !== 'string' || !b.event.startsWith('PAYMENT_')) return 0;
    const id = b.payment?.id;
    const ref = b.payment?.externalReference;
    const externalId = typeof id === 'string' && EXTERNAL_ID.test(id) ? id : null;
    const txid = typeof ref === 'string' && TXID.test(ref) ? ref : null;
    const found = await this.findPix('asaas', { externalId, txid });
    return this.dispatch(found, { kind: 'store-token', value: token });
  }
}

/**
 * Rotas sem login dos avisos. Respondem sempre 200 com o mesmo corpo: quem manda não fica sabendo
 * se a cobrança existe nem se a assinatura bateu. Corpo grande demais é ignorado.
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  private readonly logger = new Logger('Pagamentos');

  constructor(@Inject(PaymentWebhooksService) private readonly hooks: PaymentWebhooksService) {}

  private async safely(
    request: RawBodyRequest<FastifyRequest>,
    fn: (raw: string) => Promise<unknown>,
  ) {
    const raw = request.rawBody;
    if (!raw || raw.length > WEBHOOK_MAX_BYTES) return RECEIVED;
    try {
      await fn(raw.toString('utf8'));
    } catch (error) {
      this.logger.warn(`Aviso de pagamento descartado: ${(error as Error).message}`);
    }
    return RECEIVED;
  }

  @Public()
  @Post('pix-api/:token/pix')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  pixApi(@Req() request: RawBodyRequest<FastifyRequest>, @Param('token') token: string) {
    return this.safely(request, () => this.hooks.pixApi(token, request.body));
  }

  /** Alguns bancos chamam o endereço cadastrado sem acrescentar /pix. */
  @Public()
  @Post('pix-api/:token')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  pixApiPlain(@Req() request: RawBodyRequest<FastifyRequest>, @Param('token') token: string) {
    return this.safely(request, () => this.hooks.pixApi(token, request.body));
  }

  @Public()
  @Post('mercadopago')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  mercadoPago(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Query() query: Record<string, unknown>,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
  ) {
    return this.safely(request, () =>
      this.hooks.mercadoPago(request.body, query ?? {}, signature, requestId),
    );
  }

  @Public()
  @Post('pagbank')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  pagBank(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-authenticity-token') signature: string | undefined,
  ) {
    return this.safely(request, (raw) => this.hooks.pagBank(request.body, raw, signature));
  }

  @Public()
  @Post('asaas')
  @HttpCode(200)
  @RouteConfig(RATE_LIMIT)
  asaas(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('asaas-access-token') token: string | undefined,
  ) {
    return this.safely(request, () => this.hooks.asaas(request.body, token));
  }
}
