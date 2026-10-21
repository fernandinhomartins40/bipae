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
import { sellerInput, uuidv7, type SellerView } from '@bipae/domain';
import { and, asc, eq, ne } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { memberships, sellers, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CommissionService } from './commission.service';

/** Vendedores (F8-01): escolhidos no caixa pelo nome ou pelo código; a comissão parte daqui. */
@Injectable()
export class SellersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CommissionService) private readonly commissions: CommissionService,
  ) {}

  list(ctx: RequestContext): Promise<SellerView[]> {
    return withTenant(this.db, ctx, (tx) => this.rows(tx));
  }

  private async rows(tx: Tx, id?: string): Promise<SellerView[]> {
    const rows = await tx
      .select({
        id: sellers.id,
        name: sellers.name,
        code: sellers.code,
        userId: sellers.userId,
        userName: users.name,
        active: sellers.active,
      })
      .from(sellers)
      .leftJoin(users, eq(users.id, sellers.userId))
      .where(id ? eq(sellers.id, id) : undefined)
      .orderBy(asc(sellers.name));
    const rates = await this.commissions.sellerRates(tx);
    return rows.map((r) => ({
      ...r,
      userName: r.userName ?? null,
      commissionBp: rates.get(r.id) ?? null,
    }));
  }

  /** O vendedor ligado a quem está usando o Bipaê, para o celular mostrar "você lança como". */
  me(ctx: RequestContext): Promise<{ seller: SellerView | null }> {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .select({ id: sellers.id })
        .from(sellers)
        .where(and(eq(sellers.userId, ctx.userId), eq(sellers.active, true)));
      return { seller: row ? ((await this.rows(tx, row.id))[0] ?? null) : null };
    });
  }

  async save(ctx: RequestContext, id: string | null, body: unknown): Promise<SellerView> {
    const input = parse(sellerInput, body);
    const userId = input.userId ?? null;
    return withTenant(this.db, ctx, async (tx) => {
      const [sameCode] = await tx
        .select({ name: sellers.name })
        .from(sellers)
        .where(and(eq(sellers.code, input.code), id ? ne(sellers.id, id) : undefined));
      if (sameCode) {
        throw new AppError(
          409,
          'duplicate_seller_code',
          `O código ${input.code} já é de ${sameCode.name}. Escolha outro.`,
        );
      }
      if (userId) {
        const [member] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, ctx.tenantId)));
        if (!member) throw notFound('Usuário');
        const [linked] = await tx
          .select({ name: sellers.name })
          .from(sellers)
          .where(and(eq(sellers.userId, userId), id ? ne(sellers.id, id) : undefined));
        if (linked) {
          throw new AppError(
            409,
            'duplicate_seller_user',
            `Esse usuário já está ligado ao vendedor ${linked.name}.`,
          );
        }
      }
      const values = { name: input.name, code: input.code, userId, active: input.active };
      if (id) {
        const [before] = await tx.select().from(sellers).where(eq(sellers.id, id));
        if (!before) throw notFound('Vendedor');
        await tx
          .update(sellers)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(sellers.id, id));
        await this.audit.record(tx, ctx, {
          action: 'seller.updated',
          entity: 'seller',
          entityId: id,
          data: {
            before: {
              name: before.name,
              code: before.code,
              userId: before.userId,
              active: before.active,
            },
            after: values,
          },
        });
      } else {
        id = uuidv7();
        await tx.insert(sellers).values({ id, tenantId: ctx.tenantId, ...values });
        await this.audit.record(tx, ctx, {
          action: 'seller.created',
          entity: 'seller',
          entityId: id,
          data: values,
        });
      }
      if (input.commissionBp !== undefined) {
        await this.commissions.setSellerRate(tx, ctx, id, input.commissionBp);
      }
      const [view] = await this.rows(tx, id);
      return view!;
    });
  }
}

@Controller('sellers')
export class SellersController {
  constructor(@Inject(SellersService) private readonly sellers: SellersService) {}

  @Get()
  @RequirePermission('catalog.read')
  list(@Ctx() ctx: RequestContext) {
    return this.sellers.list(ctx);
  }

  @Get('me')
  @RequirePermission('pos.order')
  me(@Ctx() ctx: RequestContext) {
    return this.sellers.me(ctx);
  }

  @Post()
  @RequirePermission('admin.users')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.sellers.save(ctx, null, body);
  }

  @Put(':id')
  @RequirePermission('admin.users')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.sellers.save(ctx, id, body);
  }
}
