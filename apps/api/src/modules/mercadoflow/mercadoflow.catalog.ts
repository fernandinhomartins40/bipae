import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import { catalogLookupInput, type CatalogProduct, type ProductPack } from '@bipae/domain';
import { findCest } from '@bipae/fiscal/tables';
import { findNcm, isNcmValidOn } from '@bipae/fiscal/tables/ncm';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { parse } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { mercadoflowCatalogCache } from '../../db/schema';
import { today } from '../fiscal/fiscal-validation';
import { MERCADOFLOW_CLIENT, MercadoflowError, type MercadoflowClient } from './mercadoflow.client';

const DAY_MS = 86_400_000;
const FOUND_TTL_MS = 30 * DAY_MS;
const NOT_FOUND_TTL_MS = DAY_MS;
const SEARCH_TTL_MS = 10 * 60_000;
/** No caixa a consulta não pode segurar a fila: 1,5 s e uma tentativa só. */
const QUICK_TIMEOUT_MS = 1500;

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * O produto como o MercadoFlow manda vira o formato do Bipaê. NCM e CEST são sugestões do
 * catálogo: só passam adiante quando existem na tabela oficial vigente (regra 3 do CLAUDE.md).
 */
export function normalizeCatalogProduct(raw: Raw, date = today()): CatalogProduct {
  const gtin = String(raw.gtin ?? '');
  if (raw.found === false) {
    return {
      gtin,
      found: false,
      reason: raw.reason === 'GTIN_INVALIDO' ? 'GTIN_INVALIDO' : 'NAO_ENCONTRADO',
    };
  }
  const ncmText = text(raw.ncm)?.replace(/\D/g, '') ?? null;
  const ncm = ncmText && findNcm(ncmText);
  const cestText = text(raw.cest)?.replace(/\D/g, '') ?? null;
  const content = raw.content as
    { quantity?: unknown; unit?: unknown; packs?: unknown } | null | undefined;
  const quantity = content && String(content.quantity ?? '');
  const packs = (Array.isArray(raw.packs) ? (raw.packs as Raw[]) : [])
    .map((p) => ({ packGtin: String(p.packGtin ?? ''), unitsPerPack: Number(p.unitsPerPack) }))
    .filter(
      (p): p is ProductPack =>
        /^\d{8,14}$/.test(p.packGtin) && Number.isInteger(p.unitsPerPack) && p.unitsPerPack > 0,
    );
  return {
    gtin,
    found: true,
    description: text(raw.description) ?? '',
    brand: text(raw.brand),
    manufacturer: text(raw.manufacturer),
    department: text(raw.department),
    category: text(raw.category),
    unit: (text(raw.unit) ?? 'UN').toUpperCase(),
    weighable: raw.weighable === true,
    packageDescription: text(raw.packageDescription),
    content:
      quantity && /^\d+(\.\d+)?$/.test(quantity) && text(content.unit)
        ? {
            quantity,
            unit: text(content.unit)!.toUpperCase(),
            packs:
              Number.isInteger(content.packs) && (content.packs as number) > 0
                ? (content.packs as number)
                : 1,
          }
        : null,
    ncm: ncm && isNcmValidOn(ncm, date) ? ncmText : null,
    ncmConfidence: typeof raw.ncmConfidence === 'number' ? raw.ncmConfidence : null,
    cest: cestText && findCest(cestText, date) ? cestText : null,
    packs,
    source: text(raw.source),
  };
}

const itemsOf = (response: unknown): Raw[] =>
  Array.isArray(response)
    ? (response as Raw[])
    : (((response as { items?: Raw[] } | null)?.items ?? []) as Raw[]);

/**
 * Catálogo nativo (seção 4 do contrato): vale para toda loja Bipaê, com ou sem conta no
 * MercadoFlow. O que volta só pré-preenche o cadastro; quem salva é o usuário. Com a integração
 * desligada ou o MercadoFlow fora do ar, a resposta é "sem resposta" e o cadastro segue manual.
 */
@Injectable()
export class MercadoflowCatalog {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
  ) {}

  get enabled() {
    return this.client.enabled;
  }

  private async cached<T>(ctx: RequestContext, keys: string[], now: Date): Promise<Map<string, T>> {
    if (keys.length === 0) return new Map();
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx
        .select()
        .from(mercadoflowCatalogCache)
        .where(inArray(mercadoflowCatalogCache.cacheKey, keys)),
    );
    return new Map(rows.filter((r) => r.expiresAt > now).map((r) => [r.cacheKey, r.payload as T]));
  }

  private async store(
    ctx: RequestContext,
    entries: { key: string; payload: unknown; ttlMs: number }[],
    now: Date,
  ) {
    if (entries.length === 0) return;
    await withTenant(this.db, ctx, async (tx) => {
      for (const entry of entries) {
        const expiresAt = new Date(now.getTime() + entry.ttlMs);
        await tx
          .insert(mercadoflowCatalogCache)
          .values({ cacheKey: entry.key, payload: entry.payload, expiresAt })
          .onConflictDoUpdate({
            target: mercadoflowCatalogCache.cacheKey,
            set: { payload: entry.payload, expiresAt },
          });
      }
    });
  }

  private ttl = (product: CatalogProduct) => (product.found ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);

  async product(
    ctx: RequestContext,
    gtin: string,
    options: { quick?: boolean } = {},
    now = new Date(),
  ): Promise<CatalogProduct> {
    const key = `gtin:${gtin}`;
    const hit = (await this.cached<CatalogProduct>(ctx, [key], now)).get(key);
    if (hit) return hit;
    if (!this.enabled) return { gtin, found: false, reason: 'SEM_RESPOSTA' };
    let product: CatalogProduct;
    try {
      const raw = await this.client.get<Raw>(`/catalog/products/${gtin}`, {
        ...(options.quick && { timeoutMs: QUICK_TIMEOUT_MS, attempts: 1 }),
      });
      product = normalizeCatalogProduct({ gtin, ...raw });
    } catch (error) {
      if (error instanceof MercadoflowError && (error.status === 404 || error.status === 400)) {
        product = {
          gtin,
          found: false,
          reason: error.status === 400 ? 'GTIN_INVALIDO' : 'NAO_ENCONTRADO',
        };
      } else {
        // Fora do ar ou lento: não guarda no cache, para tentar de novo na próxima.
        return { gtin, found: false, reason: 'SEM_RESPOSTA' };
      }
    }
    await this.store(ctx, [{ key, payload: product, ttlMs: this.ttl(product) }], now);
    return product;
  }

  /** Vários códigos de uma vez (importação): usa o cache e pede o resto em lotes de 200. */
  async lookup(ctx: RequestContext, gtins: string[], now = new Date()): Promise<CatalogProduct[]> {
    const unique = [...new Set(gtins)];
    const hits = await this.cached<CatalogProduct>(
      ctx,
      unique.map((g) => `gtin:${g}`),
      now,
    );
    const missing = unique.filter((g) => !hits.has(`gtin:${g}`));
    const fetched = new Map<string, CatalogProduct>();
    if (missing.length > 0 && this.enabled) {
      try {
        const response = await this.client.post<unknown>(
          '/catalog/products/lookup',
          { gtins: missing },
          { query: { spec: false } },
        );
        for (const raw of itemsOf(response)) {
          const product = normalizeCatalogProduct(raw);
          if (product.gtin) fetched.set(product.gtin, product);
        }
        await this.store(
          ctx,
          [...fetched.values()].map((p) => ({
            key: `gtin:${p.gtin}`,
            payload: p,
            ttlMs: this.ttl(p),
          })),
          now,
        );
      } catch {
        // Sem resposta: os que faltam voltam como "sem resposta" e a importação segue manual.
      }
    }
    return unique.map(
      (gtin) =>
        hits.get(`gtin:${gtin}`) ??
        fetched.get(gtin) ?? { gtin, found: false, reason: 'SEM_RESPOSTA' as const },
    );
  }

  /** Busca por nome (ou por código, quando só há dígitos). Cache de 10 minutos. */
  async search(
    ctx: RequestContext,
    q: string,
    limit: number,
    now = new Date(),
  ): Promise<{ items: CatalogProduct[] }> {
    if (!this.enabled) return { items: [] };
    const key = `search:${limit}:${q.toLowerCase()}`;
    const hit = (await this.cached<{ items: CatalogProduct[] }>(ctx, [key], now)).get(key);
    if (hit) return hit;
    try {
      const response = await this.client.get<unknown>('/catalog/search', {
        query: { q, limit },
        timeoutMs: 6000,
        attempts: 2,
      });
      const result = {
        items: itemsOf(response)
          .map((raw) => normalizeCatalogProduct(raw))
          .filter((p) => p.found),
      };
      await this.store(ctx, [{ key, payload: result, ttlMs: SEARCH_TTL_MS }], now);
      return result;
    } catch {
      return { items: [] };
    }
  }
}

const gtinParam = z
  .string()
  .trim()
  .regex(/^\d{8,14}$/, 'Código de barras deve ter de 8 a 14 dígitos');
const searchQuery = z.object({
  q: z
    .string({ message: 'Digite pelo menos 2 letras' })
    .trim()
    .min(2, 'Digite pelo menos 2 letras')
    .max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Rotas do catálogo para as telas do Bipaê. As credenciais do MercadoFlow nunca saem da API. */
@Controller('product-catalog')
export class MercadoflowCatalogController {
  constructor(@Inject(MercadoflowCatalog) private readonly catalog: MercadoflowCatalog) {}

  @Get('status')
  @RequirePermission('catalog.read')
  status() {
    return { enabled: this.catalog.enabled };
  }

  @Get('products/:gtin')
  @RequirePermission('catalog.read')
  product(@Ctx() ctx: RequestContext, @Param('gtin') gtin: string, @Query() query: unknown) {
    const { quick } = parse(z.object({ quick: z.enum(['1', 'true']).optional() }), query);
    return this.catalog.product(ctx, parse(gtinParam, gtin), { quick: !!quick });
  }

  @Get('search')
  @RequirePermission('catalog.read')
  search(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const { q, limit } = parse(searchQuery, query);
    return this.catalog.search(ctx, q, limit);
  }

  @Post('lookup')
  @RequirePermission('catalog.read')
  async lookup(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return { items: await this.catalog.lookup(ctx, parse(catalogLookupInput, body).gtins) };
  }
}
