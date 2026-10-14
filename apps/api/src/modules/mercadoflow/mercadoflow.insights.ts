import { Inject, Injectable } from '@nestjs/common';
import type { MercadoflowDecisions, MercadoflowStoreDecisions } from '@bipae/domain';
import { dec, toCents } from '@bipae/fiscal';
import { and, eq } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { canUseStore } from '../../common/stores';
import { withTenant, type Db } from '../../db/client';
import { mercadoflowLinks, stores } from '../../db/schema';
import {
  MERCADOFLOW_CLIENT,
  MercadoflowError,
  MercadoflowUnavailableError,
  type MercadoflowClient,
} from './mercadoflow.client';

/** Resposta de `GET /markets/{id}/decisions` (seção 7.3 do contrato). */
interface RemoteDecisions {
  total?: number;
  byActionType?: Record<string, number>;
  expectedImpactValue?: number | string | null;
  lockedByPlan?: boolean;
  url?: string;
  items?: {
    id: string;
    actionType?: string;
    title?: string;
    rationale?: string;
    gtin?: string | null;
    productName?: string | null;
    imageUrl?: string | null;
    expectedImpactValue?: number | string | null;
    confidence?: number | null;
    suggestion?: Record<string, unknown> | null;
    url?: string;
  }[];
}

const CACHE_MS = 15 * 60_000;
const LIMIT = 5;
/** O painel inicial não pode ficar preso esperando o MercadoFlow. */
const TIMEOUT_MS = 4_000;

/** Valor em reais do JSON → centavos, pelo decimal (sem conta de ponto flutuante). */
const cents = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  try {
    return toCents(dec(value));
  } catch {
    return null;
  }
};

/** Só links http(s) vão para a tela (o link abre fora do Bipaê). */
const safeUrl = (value: string | null | undefined) =>
  value && /^https?:\/\//i.test(value) ? value : null;

/**
 * Inteligência do MercadoFlow (seção 7.3): as decisões do Tino de cada loja vinculada. O Bipaê só
 * mostra e leva ao MercadoFlow; a decisão é tomada lá. Guarda 15 minutos por mercado e, se o
 * MercadoFlow não responder, a loja aparece como indisponível sem atrapalhar o resto do painel.
 */
@Injectable()
export class MercadoflowInsights {
  private readonly cache = new Map<string, { at: number; data: RemoteDecisions }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
  ) {}

  private async remote(marketId: string): Promise<RemoteDecisions> {
    const hit = this.cache.get(marketId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const data = await this.client.get<RemoteDecisions>(`/markets/${marketId}/decisions`, {
      query: { limit: LIMIT },
      timeoutMs: TIMEOUT_MS,
      attempts: 1,
    });
    this.cache.set(marketId, { at: Date.now(), data });
    return data;
  }

  /** Decisões das lojas que a pessoa enxerga, vinculadas e com `insights:read`. */
  async decisions(ctx: RequestContext): Promise<MercadoflowDecisions> {
    if (!this.client.enabled) return { enabled: false, stores: [] };
    const links = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          storeId: mercadoflowLinks.storeId,
          storeName: stores.name,
          marketId: mercadoflowLinks.marketId,
          scopes: mercadoflowLinks.scopes,
        })
        .from(mercadoflowLinks)
        .innerJoin(stores, eq(stores.id, mercadoflowLinks.storeId))
        .where(
          and(eq(mercadoflowLinks.tenantId, ctx.tenantId), eq(mercadoflowLinks.status, 'ATIVA')),
        ),
    );
    const usable = links.filter(
      (l) => l.marketId && l.scopes.includes('insights:read') && canUseStore(ctx, l.storeId),
    );
    const result = await Promise.all(
      usable.map(async (link): Promise<MercadoflowStoreDecisions> => {
        const base = { storeId: link.storeId, storeName: link.storeName };
        try {
          const data = await this.remote(link.marketId!);
          return {
            ...base,
            status: 'ok',
            total: data.total ?? 0,
            byActionType: data.byActionType ?? {},
            expectedImpactCents: cents(data.expectedImpactValue) ?? 0,
            lockedByPlan: data.lockedByPlan === true,
            url: safeUrl(data.url),
            items: (data.items ?? []).slice(0, LIMIT).map((item) => ({
              id: item.id,
              actionType: item.actionType ?? '',
              title: item.title ?? '',
              rationale: item.rationale ?? null,
              gtin: item.gtin ?? null,
              productName: item.productName ?? null,
              expectedImpactCents: cents(item.expectedImpactValue),
              url: safeUrl(item.url),
            })),
          };
        } catch (error) {
          if (!(
            error instanceof MercadoflowError || error instanceof MercadoflowUnavailableError
          )) {
            throw error;
          }
          return {
            ...base,
            status: 'unavailable',
            total: 0,
            byActionType: {},
            expectedImpactCents: 0,
            lockedByPlan: false,
            url: null,
            items: [],
          };
        }
      }),
    );
    return { enabled: true, stores: result };
  }
}
