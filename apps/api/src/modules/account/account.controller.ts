import { Controller, Get, Inject } from '@nestjs/common';
import type { AccountView, AnnouncementView, PlanLimits } from '@bipae/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { Ctx, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { withTenant, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { plans, tenantEvents, tenants } from '../../db/schema';
import { LimitsService } from './limits.service';

/** The client's own subscription: plan, limits, usage and history ("Minha assinatura"). */
@Controller()
export class AccountController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LimitsService) private readonly limits: LimitsService,
  ) {}

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
          .map((e) => ({ kind: e.kind, data: publicEventData(e.data), createdAt: e.createdAt.toISOString() })),
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
      const result = await tx.execute(sql`select * from active_announcements(${tenant?.planId ?? ''})`);
      return rowsOf<AnnouncementView>(result);
    });
  }
}

function publicEventData(data: unknown) {
  if (!data || typeof data !== 'object') return null;
  const { reason, from, to, trialEndsAt } = data as Record<string, unknown>;
  return { reason, from, to, trialEndsAt };
}
