import { Controller, Get, Inject, Res, StreamableFile } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AccountView, AnnouncementView, PlanLimits } from '@bipae/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import type { Config } from '../../config';
import { withTenant, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { plans, tenantEvents, tenants } from '../../db/schema';
import { DataExportService } from './data-export.service';
import { LimitsService } from './limits.service';

/** The client's own subscription: plan, limits, usage and history ("Minha assinatura"). */
@Controller()
export class AccountController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LimitsService) private readonly limits: LimitsService,
    @Inject(DataExportService) private readonly dataExport: DataExportService,
  ) {}

  /**
   * LGPD (P-03): baixar todos os dados da conta num ZIP. Só quem gerencia a equipe (o dono, nos
   * papéis padrão). Funciona também com a conta cancelada, até a exclusão definitiva.
   */
  @Get('account/export')
  @RequirePermission('admin.users')
  async export(@Ctx() ctx: RequestContext, @Res({ passthrough: true }) reply: FastifyReply) {
    // O acesso de suporte é para ajudar na tela, não para levar a base inteira do cliente (PIE R1-06).
    if (ctx.impersonatedBy) {
      throw new AppError(
        403,
        'support_export',
        'No acesso de suporte não dá para baixar os dados da conta. Peça ao dono da empresa.',
      );
    }
    const { fileName, zip } = await this.dataExport.export(ctx);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(zip);
  }

  @Get('account')
  async account(@Ctx() ctx: RequestContext): Promise<AccountView> {
    return withTenant(this.db, ctx, async (tx) => {
      const [tenant] = await tx.select().from(tenants);
      const { plan, limits } = await this.limits.planOf(tx);
      const usage = await this.limits.usage(tx);
      const events = await tx
        .select()
        .from(tenantEvents)
        .orderBy(desc(tenantEvents.createdAt))
        .limit(20);
      const catalog = await tx
        .select()
        .from(plans)
        .where(eq(plans.public, true))
        .orderBy(asc(plans.sort));
      return {
        tenant: {
          id: tenant!.id,
          name: tenant!.name,
          status: tenant!.status,
          statusReason: tenant!.statusReason,
          trialEndsAt: tenant!.trialEndsAt?.toISOString() ?? null,
          purgeAt:
            tenant!.status === 'cancelled' && tenant!.statusChangedAt
              ? new Date(
                  tenant!.statusChangedAt.getTime() + this.config.ACCOUNT_PURGE_DAYS * 86_400_000,
                ).toISOString()
              : null,
        },
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          priceCents: plan.priceCents,
          features: plan.features,
        },
        limits,
        usage,
        // Internal notes and staff ids never reach the client.
        events: events
          .filter((e) => e.kind !== 'note')
          .map((e) => ({
            kind: e.kind,
            data: publicEventData(e.data),
            createdAt: e.createdAt.toISOString(),
          })),
        plans: catalog
          .filter((p) => p.active)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            priceCents: p.priceCents,
            limits: p.limits as PlanLimits,
          })),
      };
    });
  }

  /** Bipaê announcements for this client's plan (maintenance, news). */
  @Get('announcements')
  async announcements(@Ctx() ctx: RequestContext): Promise<AnnouncementView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const [tenant] = await tx.select({ planId: tenants.planId }).from(tenants);
      const result = await tx.execute(
        sql`select * from active_announcements(${tenant?.planId ?? ''})`,
      );
      return rowsOf<AnnouncementView>(result);
    });
  }
}

function publicEventData(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const { reason, from, to, trialEndsAt } = data as Record<string, unknown>;
  return { reason, from, to, trialEndsAt };
}
