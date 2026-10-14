import { Injectable } from '@nestjs/common';
import {
  effectiveLimits,
  limitMessage,
  withinLimit,
  type LimitResource,
  type PlanLimits,
} from '@bipae/domain';
import { and, count, eq } from 'drizzle-orm';
import { AppError } from '../../common/errors';
import type { Tx } from '../../db/client';
import {
  companies,
  memberships,
  plans,
  products,
  stores,
  terminals,
  tenants,
} from '../../db/schema';

/**
 * Plan limits (docs/saas/plano.md). Checked inside the same tenant transaction that creates the
 * resource, so the count and the insert see the same data.
 */
@Injectable()
export class LimitsService {
  async planOf(tx: Tx) {
    const [row] = await tx
      .select({ plan: plans, overrides: tenants.limitOverrides })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId));
    if (!row) throw new AppError(404, 'not_found', 'Conta não encontrada.');
    return {
      plan: row.plan,
      limits: effectiveLimits(row.plan.limits as PlanLimits, row.overrides),
    };
  }

  async usage(tx: Tx): Promise<Record<LimitResource, number>> {
    const n = async (query: Promise<{ n: number }[]>) => Number((await query)[0]?.n ?? 0);
    return {
      companies: await n(tx.select({ n: count() }).from(companies)),
      stores: await n(tx.select({ n: count() }).from(stores)),
      terminals: await n(
        tx.select({ n: count() }).from(terminals).where(eq(terminals.status, 'active')),
      ),
      users: await n(
        tx.select({ n: count() }).from(memberships).where(eq(memberships.active, true)),
      ),
      products: await n(
        tx
          .select({ n: count() })
          .from(products)
          .where(and(eq(products.active, true))),
      ),
    };
  }

  /** Throws a friendly 403 when creating one more `resource` would exceed the plan. */
  async assertCanAdd(tx: Tx, resource: LimitResource) {
    const { plan, limits } = await this.planOf(tx);
    const limit = limits[resource];
    if (limit === null) return;
    const usage = await this.usage(tx);
    if (!withinLimit(limit, usage[resource])) {
      throw new AppError(403, 'plan_limit', limitMessage(resource, limit, plan.name));
    }
  }
}
