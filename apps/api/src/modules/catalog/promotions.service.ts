import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { promotionInput, uuidv7, type PromotionRule, type PromotionView } from '@bipae/domain';
import { desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { products, promotions } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type Input = z.output<typeof promotionInput>;

const productIdsOf = (rule: PromotionRule) =>
  rule.kind === 'combo' ? rule.items.map((i) => i.productId) : rule.productIds;

function toView(row: typeof promotions.$inferSelect): PromotionView {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    active: row.active,
    rule: row.rule,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Cadastro das promoções do caixa (F5-02). Mudar promoção muda preço: toda criação e alteração
 * vai para a auditoria. Não há exclusão: a promoção é desligada e fica no histórico.
 */
@Injectable()
export class PromotionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext): Promise<PromotionView[]> {
    return withTenant(this.db, ctx, async (tx) =>
      (await tx.select().from(promotions).orderBy(desc(promotions.createdAt))).map(toView),
    );
  }

  /** Os produtos da regra precisam existir (a regra é jsonb, sem chave estrangeira). */
  private async assertProducts(tx: Tx, rule: PromotionRule) {
    const ids = productIdsOf(rule);
    const found = await tx
      .select({ id: products.id, weighable: products.isWeighable, name: products.name })
      .from(products)
      .where(inArray(products.id, ids));
    if (found.length !== ids.length) throw notFound('Produto');
    if (rule.kind !== 'quantity_tier') {
      const weighed = found.find((p) => p.weighable);
      if (weighed) {
        throw new AppError(
          422,
          'weighable_in_promotion',
          `${weighed.name} é vendido por peso: só entra em promoção por faixa de quantidade.`,
        );
      }
    }
  }

  async create(ctx: RequestContext, input: Input): Promise<PromotionView> {
    return withTenant(this.db, ctx, async (tx) => {
      await this.assertProducts(tx, input.rule);
      const [row] = await tx
        .insert(promotions)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, createdBy: ctx.userId, ...input })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'promotion.created',
        entity: 'promotion',
        entityId: row!.id,
        data: input,
      });
      return toView(row!);
    });
  }

  async update(ctx: RequestContext, id: string, input: Input): Promise<PromotionView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [before] = await tx.select().from(promotions).where(eq(promotions.id, id));
      if (!before) throw notFound('Promoção');
      await this.assertProducts(tx, input.rule);
      const [row] = await tx
        .update(promotions)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(promotions.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'promotion.updated',
        entity: 'promotion',
        entityId: id,
        data: { before: toView(before), after: input },
      });
      return toView(row!);
    });
  }
}

@Controller('promotions')
export class PromotionsController {
  constructor(@Inject(PromotionsService) private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.promotions.list(ctx);
  }

  @Post()
  @RequirePermission('catalog.write')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.promotions.create(ctx, parse(promotionInput, body));
  }

  @Put(':id')
  @RequirePermission('catalog.write')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.promotions.update(ctx, id, parse(promotionInput, body));
  }
}
