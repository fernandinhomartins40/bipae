import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { productInput, uuidv7, type MercadoflowPendingView } from '@bipae/domain';
import { dec, toCents } from '@bipae/fiscal';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { storeCondition } from '../../common/stores';
import { asPlatform, withTenant, type Db, type Tx } from '../../db/client';
import { mercadoflowLinks, mercadoflowPendings, stores } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from '../catalog/catalog.service';
import { asTenant } from './mercadoflow.confere';
import { MercadoflowEncartes } from './mercadoflow.encartes';
import { ownerContext, productByGtin, storePrice } from './mercadoflow.pendings.helpers';
import { MercadoflowWebhooks, type MercadoflowEvent } from './mercadoflow.webhook';

type Pending = typeof mercadoflowPendings.$inferSelect;

/** Dados do preço aprovado guardados na pendência. */
interface PriceData {
  gtin: string;
  productId: string | null;
  productName: string | null;
  priceCents: number;
  currentPriceCents: number | null;
  approvedBy: string | null;
}

const NO_PRODUCT = 'Nenhum produto do Bipaê tem este código de barras. Cadastre e aplique de novo.';

const autoInput = z.object({
  prices: z.boolean().optional(),
  promotions: z.boolean().optional(),
});

/** Valor em reais do JSON → centavos, pelo decimal; inválido ou não positivo vira null. */
const reaisToCents = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    const cents = toCents(dec(String(value)));
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
};

/**
 * Pendências do MercadoFlow (MF-11). O preço aprovado lá (aviso price.approved) vira uma
 * alteração de preço pendente que o gerente aplica com um clique, ou que o Bipaê aplica sozinho
 * se a loja ligar a opção. O preço vai para a tabela de preço da loja, quando ela tem uma, e
 * senão para o cadastro do produto, pelo mesmo caminho da tela (auditoria e envio ao caixa).
 */
@Injectable()
export class MercadoflowPendings {
  private readonly logger = new Logger('MercadoFlow');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowEncartes) private readonly encartes: MercadoflowEncartes,
    @Inject(MercadoflowWebhooks) webhooks: MercadoflowWebhooks,
  ) {
    webhooks.on('price.approved', (tx, event) => this.priceApproved(tx, event));
    webhooks.after('price.approved', (event) => this.autoApplyPrice(event));
  }

  private async priceApproved(tx: Tx, event: MercadoflowEvent) {
    const data = event.data as { gtin?: unknown; price?: unknown; approvedBy?: unknown };
    const gtin = typeof data.gtin === 'string' ? data.gtin.trim() : '';
    const priceCents = reaisToCents(data.price);
    if (!event.marketId || !/^\d{8,14}$/.test(gtin) || priceCents === null) {
      throw new Error('Aviso de preço sem código de barras ou preço válido.');
    }
    const [link] = await tx
      .select()
      .from(mercadoflowLinks)
      .where(
        and(eq(mercadoflowLinks.marketId, event.marketId), eq(mercadoflowLinks.status, 'ATIVA')),
      );
    if (!link) throw new Error('Nenhuma loja do Bipaê tem este mercado.');
    await asTenant(tx, link.tenantId, async () => {
      const product = await productByGtin(tx, gtin);
      const payload: PriceData = {
        gtin,
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        priceCents,
        currentPriceCents: product ? await storePrice(tx, link.storeId, product.id) : null,
        approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy.slice(0, 120) : null,
      };
      // Um preço pendente por produto: o aviso mais novo substitui o anterior.
      await tx
        .insert(mercadoflowPendings)
        .values({
          id: uuidv7(),
          tenantId: link.tenantId,
          storeId: link.storeId,
          marketId: event.marketId!,
          kind: 'price',
          sourceKey: gtin,
          data: payload as unknown as Record<string, unknown>,
          problem: product ? null : NO_PRODUCT,
        })
        .onConflictDoUpdate({
          target: [
            mercadoflowPendings.tenantId,
            mercadoflowPendings.storeId,
            mercadoflowPendings.kind,
            mercadoflowPendings.sourceKey,
          ],
          set: {
            data: payload as unknown as Record<string, unknown>,
            status: 'pending',
            problem: product ? null : NO_PRODUCT,
            resolvedBy: null,
            resolvedAt: null,
            updatedAt: new Date(),
          },
        });
    });
  }

  private async autoApplyPrice(event: MercadoflowEvent) {
    const gtin = (event.data as { gtin?: string }).gtin;
    const [found] = await asPlatform(this.db, (tx) =>
      tx
        .select({ pending: mercadoflowPendings, auto: mercadoflowLinks.autoApplyPrices })
        .from(mercadoflowPendings)
        .innerJoin(
          mercadoflowLinks,
          and(
            eq(mercadoflowLinks.marketId, mercadoflowPendings.marketId),
            eq(mercadoflowLinks.storeId, mercadoflowPendings.storeId),
          ),
        )
        .where(
          and(
            eq(mercadoflowPendings.marketId, event.marketId ?? ''),
            eq(mercadoflowPendings.kind, 'price'),
            eq(mercadoflowPendings.sourceKey, gtin ?? ''),
            eq(mercadoflowPendings.status, 'pending'),
          ),
        ),
    );
    if (!found?.auto || found.pending.problem) return;
    const ctx = await ownerContext(this.db, found.pending.tenantId);
    if (!ctx) return;
    await this.apply(ctx, found.pending.id, true).catch((error: Error) =>
      this.logger.warn(`Preço aprovado não aplicado sozinho: ${error.message}`),
    );
  }

  // ---------------------------------------------------------------- telas

  async list(ctx: RequestContext): Promise<MercadoflowPendingView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ p: mercadoflowPendings, storeName: stores.name })
        .from(mercadoflowPendings)
        .innerJoin(stores, eq(stores.id, mercadoflowPendings.storeId))
        .where(
          and(
            eq(mercadoflowPendings.status, 'pending'),
            storeCondition(ctx, mercadoflowPendings.storeId),
          ),
        )
        .orderBy(desc(mercadoflowPendings.updatedAt))
        .limit(500);
      return rows.map(({ p, storeName }) => ({
        id: p.id,
        storeId: p.storeId,
        storeName,
        kind: p.kind,
        problem: p.problem,
        data: p.data,
        updatedAt: p.updatedAt.toISOString(),
      }));
    });
  }

  private async pending(ctx: RequestContext, id: string): Promise<Pending> {
    const row = await withTenant(this.db, ctx, async (tx) => {
      const [p] = await tx
        .select()
        .from(mercadoflowPendings)
        .where(
          and(eq(mercadoflowPendings.id, id), storeCondition(ctx, mercadoflowPendings.storeId)),
        );
      return p;
    });
    if (!row) throw notFound('Pendência');
    if (row.status !== 'pending') {
      throw new AppError(409, 'already_resolved', 'Esta pendência já foi aplicada ou descartada.');
    }
    return row;
  }

  /** Aplica o preço aprovado: na tabela de preço da loja, se houver, senão no cadastro. */
  async apply(ctx: RequestContext, id: string, automatic = false) {
    const row = await this.pending(ctx, id);
    // Encarte (MF-11.b): vira promoções da loja.
    if (row.kind === 'promotion') return this.encartes.apply(ctx, row, automatic);
    const data = row.data as unknown as PriceData;
    // O produto pode ter sido cadastrado depois do aviso.
    const product = await withTenant(this.db, ctx, (tx) => productByGtin(tx, data.gtin));
    if (!product) {
      await withTenant(this.db, ctx, (tx) =>
        tx
          .update(mercadoflowPendings)
          .set({ problem: NO_PRODUCT, updatedAt: new Date() })
          .where(eq(mercadoflowPendings.id, id)),
      );
      throw new AppError(409, 'no_product', NO_PRODUCT);
    }
    const [store] = await withTenant(this.db, ctx, (tx) =>
      tx
        .select({ priceTableId: stores.priceTableId })
        .from(stores)
        .where(eq(stores.id, row.storeId)),
    );
    if (store?.priceTableId) {
      const table = (await this.catalog.listPriceTables(ctx)).find(
        (t) => t.id === store.priceTableId,
      );
      if (!table) throw notFound('Tabela de preço');
      const items = table.items.map((i) => ({ productId: i.productId, priceCents: i.priceCents }));
      const current = items.find((i) => i.productId === product.id);
      if (current) current.priceCents = data.priceCents;
      else items.push({ productId: product.id, priceCents: data.priceCents });
      await this.catalog.savePriceTable(ctx, table.id, { name: table.name, items });
    } else {
      const current = await this.catalog.getProduct(ctx, product.id);
      await this.catalog.updateProduct(
        ctx,
        product.id,
        parse(productInput, { ...current, priceCents: data.priceCents }),
      );
    }
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .update(mercadoflowPendings)
        .set({
          status: 'applied',
          problem: null,
          resolvedBy: ctx.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mercadoflowPendings.id, id));
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.price_applied',
        entity: 'product',
        entityId: product.id,
        data: {
          gtin: data.gtin,
          storeId: row.storeId,
          before: data.currentPriceCents,
          after: data.priceCents,
          approvedBy: data.approvedBy,
          automatic,
        },
      });
    });
    return { ok: true };
  }

  async dismiss(ctx: RequestContext, id: string) {
    const row = await this.pending(ctx, id);
    await withTenant(this.db, ctx, async (tx) => {
      await tx
        .update(mercadoflowPendings)
        .set({
          status: 'dismissed',
          resolvedBy: ctx.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mercadoflowPendings.id, id));
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.pending_dismissed',
        entity: 'mercadoflow_pending',
        entityId: id,
        data: { kind: row.kind, sourceKey: row.sourceKey, storeId: row.storeId },
      });
    });
    return { ok: true };
  }

  /** Liga ou desliga a aplicação automática da loja. */
  async setAuto(ctx: RequestContext, storeId: string, body: unknown) {
    const input = parse(autoInput, body);
    return withTenant(this.db, ctx, async (tx) => {
      const [link] = await tx
        .update(mercadoflowLinks)
        .set({
          ...(input.prices !== undefined && { autoApplyPrices: input.prices }),
          ...(input.promotions !== undefined && { autoApplyPromotions: input.promotions }),
          updatedAt: new Date(),
        })
        .where(
          and(eq(mercadoflowLinks.storeId, storeId), storeCondition(ctx, mercadoflowLinks.storeId)),
        )
        .returning();
      if (!link) throw notFound('Vínculo com o MercadoFlow');
      await this.audit.record(tx, ctx, {
        action: 'mercadoflow.auto_apply_changed',
        entity: 'store',
        entityId: storeId,
        data: { prices: link.autoApplyPrices, promotions: link.autoApplyPromotions },
      });
      return { prices: link.autoApplyPrices, promotions: link.autoApplyPromotions };
    });
  }
}

@Controller('mercadoflow')
export class MercadoflowPendingsController {
  constructor(
    @Inject(MercadoflowPendings) private readonly pendings: MercadoflowPendings,
    @Inject(MercadoflowEncartes) private readonly encartes: MercadoflowEncartes,
  ) {}

  @Get('pendings')
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.pendings.list(ctx);
  }

  @Post('pendings/:id/apply')
  @HttpCode(200)
  @RequirePermission('catalog.price.write')
  apply(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.pendings.apply(ctx, id);
  }

  @Post('pendings/:id/dismiss')
  @HttpCode(200)
  @RequirePermission('catalog.price.write')
  dismiss(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.pendings.dismiss(ctx, id);
  }

  /** "Buscar encartes agora" (a busca automática roda de hora em hora). */
  @Post('links/:storeId/promotions/fetch')
  @HttpCode(200)
  @RequirePermission('catalog.price.write')
  fetchPromotions(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
  ) {
    return this.encartes.fetchStore(ctx, storeId);
  }

  @Put('links/:storeId/auto-apply')
  @RequirePermission('admin.stores')
  setAuto(
    @Ctx() ctx: RequestContext,
    @Param('storeId', new ParseUUIDPipe()) storeId: string,
    @Body() body: unknown,
  ) {
    return this.pendings.setAuto(ctx, storeId, body);
  }
}
