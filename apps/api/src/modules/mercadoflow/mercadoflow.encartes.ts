import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { promotionInput, uuidv7 } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import type { Config } from '../../config';
import { CONFIG, DB, QUEUE } from '../../common/di';
import { AppError, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { asPlatform, withTenant, type Db } from '../../db/client';
import { mercadoflowLinks, mercadoflowPendings } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { PromotionsService } from '../catalog/promotions.service';
import { MERCADOFLOW_CLIENT, type MercadoflowClient } from './mercadoflow.client';
import { asTenant } from './mercadoflow.confere';
import { MercadoflowMarketSync } from './mercadoflow.market-sync';
import { ownerContext, productByGtin, storePrice } from './mercadoflow.pendings.helpers';

const FETCH_JOB = 'mercadoflow.promotions';
const FETCH_EVERY_MS = 60 * 60_000;
const SCOPE = 'promotions:read';

/** Um item do encarte guardado na pendência. */
export interface EncarteItem {
  gtin: string;
  productId: string | null;
  productName: string | null;
  promoPriceCents: number;
  regularPriceCents: number | null;
  deal: string | null;
}

/** O encarte guardado na pendência (datas AAAA-MM-DD). */
export interface EncarteData {
  name: string;
  validFrom: string;
  validUntil: string;
  items: EncarteItem[];
}

interface RemoteEncarte {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  items?: {
    gtin?: unknown;
    promoPrice?: unknown;
    regularPrice?: unknown;
    unit?: unknown;
    deal?: unknown;
  }[];
}

const day = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

const todayInBrazil = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Reais do JSON → centavos, sem conta de ponto flutuante; inválido vira null. */
const toCents = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [int, frac = ''] = text.split('.');
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return cents > 0 ? cents : null;
};

const NO_MATCH = 'Nenhum produto do encarte está cadastrado no Bipaê com o mesmo código de barras.';

/**
 * Encartes do MercadoFlow (MF-11.b, seção 7.3 do contrato). De hora em hora o Bipaê busca os
 * encartes publicados de cada loja vinculada com promotions:read; cada encarte vira uma
 * promoção pendente que o gerente aplica com um clique (ou que entra sozinha, se a loja ligar a
 * opção). Aplicar cria uma promoção por produto, só naquela loja, na vigência do encarte, e
 * manda ao MercadoFlow o preço promocional em /prices.
 */
@Injectable()
export class MercadoflowEncartes implements OnModuleInit {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
    @Inject(MercadoflowMarketSync) private readonly marketSync: MercadoflowMarketSync,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (!this.client.enabled) return;
    try {
      this.queue.process(FETCH_JOB, async () => {
        await this.fetchAll();
      });
    } catch (error) {
      this.logger.error(`Busca de encartes não iniciou: ${(error as Error).message}`);
      return;
    }
    if (this.config.NODE_ENV !== 'test') {
      void this.queue
        .add(FETCH_JOB, {}, { repeatEveryMs: FETCH_EVERY_MS })
        .catch((error: Error) =>
          this.logger.warn(`Não foi possível agendar a busca de encartes: ${error.message}`),
        );
    }
  }

  /** Lojas vinculadas com permissão de ler os encartes (de um cliente ou de todos). */
  private async links(filter?: { tenantId: string; storeId: string }) {
    const rows = await asPlatform(this.db, (tx) =>
      tx
        .select()
        .from(mercadoflowLinks)
        .where(
          and(
            eq(mercadoflowLinks.status, 'ATIVA'),
            ...(filter
              ? [
                  eq(mercadoflowLinks.tenantId, filter.tenantId),
                  eq(mercadoflowLinks.storeId, filter.storeId),
                ]
              : []),
          ),
        ),
    );
    return rows.filter((l) => l.marketId && l.scopes.includes(SCOPE));
  }

  async fetchAll() {
    let total = 0;
    for (const link of await this.links()) {
      total += await this.fetchLink(link).catch((error: Error) => {
        this.logger.warn(`Encartes do mercado ${link.marketId}: ${error.message}`);
        return 0;
      });
    }
    return total;
  }

  /** "Buscar encartes agora" na tela, só da loja pedida. */
  async fetchStore(ctx: RequestContext, storeId: string) {
    if (!this.client.enabled) {
      throw new AppError(409, 'disabled', 'A integração com o MercadoFlow não está ligada.');
    }
    const [link] = await this.links({ tenantId: ctx.tenantId, storeId });
    if (!link) {
      throw new AppError(
        409,
        'no_scope',
        'Esta loja não está vinculada ao MercadoFlow com permissão de ler os encartes.',
      );
    }
    return { found: await this.fetchLink(link) };
  }

  /** Busca os encartes de um mercado e grava as pendências. Devolve quantos estão valendo. */
  private async fetchLink(link: typeof mercadoflowLinks.$inferSelect): Promise<number> {
    const response = await this.client.get<RemoteEncarte[] | { items?: RemoteEncarte[] }>(
      `/markets/${link.marketId}/promotions`,
    );
    const list = Array.isArray(response) ? response : (response?.items ?? []);
    const today = todayInBrazil();
    const fresh: string[] = [];
    await asPlatform(this.db, (tx) =>
      asTenant(tx, link.tenantId, async () => {
        for (const remote of list) {
          const validFrom = day(remote.validFrom);
          const validUntil = day(remote.validUntil);
          if (!validFrom || !validUntil || validUntil < today || validUntil < validFrom) continue;
          const name =
            String(remote.name ?? remote.title ?? 'Encarte do MercadoFlow')
              .trim()
              .slice(0, 60) || 'Encarte do MercadoFlow';
          const items: EncarteItem[] = [];
          for (const raw of remote.items ?? []) {
            const gtin = typeof raw.gtin === 'string' ? raw.gtin.trim() : '';
            const promoPriceCents = toCents(raw.promoPrice);
            if (!/^\d{8,14}$/.test(gtin) || promoPriceCents === null) continue;
            const product = await productByGtin(tx, gtin);
            items.push({
              gtin,
              productId: product?.id ?? null,
              productName: product?.name ?? null,
              promoPriceCents,
              regularPriceCents: toCents(raw.regularPrice),
              deal: typeof raw.deal === 'string' ? raw.deal.slice(0, 80) : null,
            });
          }
          if (items.length === 0) continue;
          const sourceKey =
            typeof remote.id === 'string' || typeof remote.id === 'number'
              ? String(remote.id).slice(0, 80)
              : createHash('sha256')
                  .update(`${name}|${validFrom}|${validUntil}`)
                  .digest('hex')
                  .slice(0, 40);
          const data: EncarteData = { name, validFrom, validUntil, items };
          const problem = items.some((i) => i.productId) ? null : NO_MATCH;
          const [existing] = await tx
            .select()
            .from(mercadoflowPendings)
            .where(
              and(
                eq(mercadoflowPendings.storeId, link.storeId),
                eq(mercadoflowPendings.kind, 'promotion'),
                eq(mercadoflowPendings.sourceKey, sourceKey),
              ),
            );
          // Encarte já aplicado ou descartado não volta para a lista.
          if (existing && existing.status !== 'pending') continue;
          if (existing) {
            await tx
              .update(mercadoflowPendings)
              .set({
                data: data as unknown as Record<string, unknown>,
                problem,
                updatedAt: new Date(),
              })
              .where(eq(mercadoflowPendings.id, existing.id));
          } else {
            await tx.insert(mercadoflowPendings).values({
              id: uuidv7(),
              tenantId: link.tenantId,
              storeId: link.storeId,
              marketId: link.marketId!,
              kind: 'promotion',
              sourceKey,
              data: data as unknown as Record<string, unknown>,
              problem,
            });
          }
          fresh.push(sourceKey);
        }
      }),
    );
    if (link.autoApplyPromotions && fresh.length > 0) await this.autoApply(link, fresh);
    return fresh.length;
  }

  private async autoApply(link: typeof mercadoflowLinks.$inferSelect, keys: string[]) {
    const ctx = await ownerContext(this.db, link.tenantId);
    if (!ctx) return;
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .select()
        .from(mercadoflowPendings)
        .where(
          and(
            eq(mercadoflowPendings.storeId, link.storeId),
            eq(mercadoflowPendings.kind, 'promotion'),
            eq(mercadoflowPendings.status, 'pending'),
          ),
        ),
    );
    for (const row of rows.filter((r) => keys.includes(r.sourceKey) && !r.problem)) {
      await this.apply(ctx, row, true).catch((error: Error) =>
        this.logger.warn(`Encarte não aplicado sozinho: ${error.message}`),
      );
    }
  }

  /**
   * Aplica o encarte: uma promoção por produto cadastrado (o preço promocional por unidade, a
   * partir da primeira), só nesta loja e na vigência do encarte. Produto sem cadastro fica de
   * fora e aparece na lista.
   */
  async apply(
    ctx: RequestContext,
    row: typeof mercadoflowPendings.$inferSelect,
    automatic = false,
  ) {
    const data = row.data as unknown as EncarteData;
    // O produto pode ter sido cadastrado depois de o encarte chegar.
    const items = await withTenant(this.db, ctx, async (tx) => {
      const out: (EncarteItem & { productId: string; productName: string })[] = [];
      for (const item of data.items) {
        const product = await productByGtin(tx, item.gtin);
        if (product) out.push({ ...item, productId: product.id, productName: product.name });
      }
      return out;
    });
    if (items.length === 0) throw new AppError(409, 'no_product', NO_MATCH);
    const created: string[] = [];
    for (const item of items) {
      const promotion = await this.promotions.create(
        ctx,
        parse(promotionInput, {
          name: `${data.name}: ${item.productName}`.slice(0, 80),
          startsOn: data.validFrom,
          endsOn: data.validUntil,
          active: true,
          storeId: row.storeId,
          rule: {
            kind: 'quantity_tier',
            productIds: [item.productId],
            // A partir da primeira unidade (ou do primeiro grama, no produto de balança).
            tiers: [{ minQuantityMilli: 1, unitPriceCents: item.promoPriceCents }],
          },
        }),
      );
      created.push(promotion.id);
    }
    await withTenant(this.db, ctx, async (tx) => {
      for (const item of items) {
        const priceCents = await storePrice(tx, row.storeId, item.productId);
        if (priceCents === null) continue;
        await this.marketSync.enqueuePromoPrice(tx, ctx.tenantId, row.storeId, {
          gtin: item.gtin,
          priceCents,
          promoPriceCents: item.promoPriceCents,
          start: data.validFrom,
          end: data.validUntil,
        });
      }
      await tx
        .update(mercadoflowPendings)
        .set({
          status: 'applied',
          problem: null,
          resolvedBy: ctx.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mercadoflowPendings.id, row.id));
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.promotion_applied',
        entity: 'mercadoflow_pending',
        entityId: row.id,
        data: {
          name: data.name,
          storeId: row.storeId,
          validFrom: data.validFrom,
          validUntil: data.validUntil,
          promotions: created,
          skipped: data.items.length - items.length,
          automatic,
        },
      });
    });
    return { ok: true, promotions: created.length };
  }
}
