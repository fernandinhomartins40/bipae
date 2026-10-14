import { Inject, Injectable } from '@nestjs/common';
import {
  adminCreateTenantInput,
  changePlanInput,
  effectiveLimits,
  impersonateInput,
  platformCan,
  uuidv7,
  type PlanLimits,
  type TenantStatus,
} from '@bipae/domain';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { TokenService } from '../../common/tokens';
import { asPlatform, withTenant, type Db, type Tx } from '../../db/client';
import {
  auditLog,
  companies,
  memberships,
  plans,
  products,
  roles,
  sales,
  sessions,
  stores,
  syncEvents,
  tenantEvents,
  tenants,
  terminals,
  users,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { AdminContext } from './platform.guard';
import { PlatformAuditService } from './platform-audit.service';
import { MercadoflowAccounts } from '../mercadoflow/mercadoflow.accounts';

const DAY = 86_400_000;

function daysAgo(n: number) {
  return new Date(Date.now() - n * DAY);
}

@Injectable()
export class AdminTenantsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly tenantAudit: AuditService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(MercadoflowAccounts) private readonly mercadoflow: MercadoflowAccounts,
  ) {}

  /** A assinatura mudou: avisa o MercadoFlow (liga ou desliga o desconto de cliente Bipaê). */
  private notifyMercadoflow(tenantId: string) {
    void this.mercadoflow.syncCustomers(tenantId).catch(() => undefined);
  }

  // ---------------------------------------------------------------- overview

  async dashboard() {
    return asPlatform(this.db, async (tx) => {
      const byStatus = await tx
        .select({ status: tenants.status, n: count() })
        .from(tenants)
        .groupBy(tenants.status);
      const byPlan = await tx
        .select({
          planId: tenants.planId,
          name: plans.name,
          priceCents: plans.priceCents,
          n: count(),
        })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(inArray(tenants.status, ['active', 'trial']))
        .groupBy(tenants.planId, plans.name, plans.priceCents);
      const signups = await tx
        .select({
          day: sql<string>`to_char(${tenants.createdAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`,
          n: count(),
        })
        .from(tenants)
        .where(gte(tenants.createdAt, daysAgo(30)))
        .groupBy(sql`1`)
        .orderBy(sql`1`);
      const salesByDay = await tx
        .select({
          day: sql<string>`to_char(${sales.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`,
          n: count(),
          totalCents: sql<number>`coalesce(sum(${sales.totalCents}), 0)`,
        })
        .from(sales)
        .where(
          and(
            gte(sales.occurredAt, daysAgo(30)),
            eq(sales.kind, 'sale'),
            eq(sales.status, 'completed'),
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`);
      const [activeTerminals] = await tx
        .select({ n: sql<number>`count(distinct ${syncEvents.terminalId})` })
        .from(syncEvents)
        .where(gte(syncEvents.receivedAt, daysAgo(1)));
      const [activeTenants7d] = await tx
        .select({ n: sql<number>`count(distinct ${sessions.tenantId})` })
        .from(sessions)
        .where(gte(sessions.createdAt, daysAgo(7)));
      const trialsEnding = await tx
        .select({ id: tenants.id, name: tenants.name, trialEndsAt: tenants.trialEndsAt })
        .from(tenants)
        .where(
          and(eq(tenants.status, 'trial'), sql`${tenants.trialEndsAt} < now() + interval '7 days'`),
        )
        .orderBy(asc(tenants.trialEndsAt))
        .limit(10);
      const mrrCents = byPlan.reduce((sum, p) => sum + Number(p.priceCents ?? 0) * Number(p.n), 0);
      return {
        tenants: Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])) as Partial<
          Record<TenantStatus, number>
        >,
        byPlan: byPlan.map((p) => ({ planId: p.planId, name: p.name, tenants: Number(p.n) })),
        mrrCents,
        activeTerminals24h: Number(activeTerminals?.n ?? 0),
        activeTenants7d: Number(activeTenants7d?.n ?? 0),
        signups: signups.map((s) => ({ day: s.day, count: Number(s.n) })),
        sales: salesByDay.map((s) => ({
          day: s.day,
          count: Number(s.n),
          totalCents: Number(s.totalCents),
        })),
        trialsEnding: trialsEnding.map((t) => ({
          ...t,
          trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
        })),
      };
    });
  }

  // ---------------------------------------------------------------- list and detail

  async list(query: {
    q?: string | undefined;
    status?: string | undefined;
    planId?: string | undefined;
    limit: number;
    offset: number;
  }) {
    return asPlatform(this.db, async (tx) => {
      const where: SQL[] = [];
      if (query.status) where.push(eq(tenants.status, query.status as TenantStatus));
      if (query.planId) where.push(eq(tenants.planId, query.planId));
      if (query.q) {
        const term = `%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%`;
        where.push(
          or(
            ilike(tenants.name, term),
            sql`exists (select 1 from companies c where c.tenant_id = ${tenants.id} and (c.tax_id ilike ${term} or c.legal_name ilike ${term}))`,
            sql`exists (select 1 from memberships m join users u on u.id = m.user_id where m.tenant_id = ${tenants.id} and u.email ilike ${term})`,
          )!,
        );
      }
      const condition = where.length ? and(...where) : undefined;
      const rows = await tx
        .select({
          id: tenants.id,
          name: tenants.name,
          status: tenants.status,
          planId: tenants.planId,
          planName: plans.name,
          trialEndsAt: tenants.trialEndsAt,
          createdAt: tenants.createdAt,
          owner: sql<
            string | null
          >`(select u.email from memberships m join roles r on r.id = m.role_id join users u on u.id = m.user_id where m.tenant_id = ${tenants.id} and r.system_key = 'owner' order by m.created_at limit 1)`,
          users: sql<number>`(select count(*) from memberships m where m.tenant_id = ${tenants.id} and m.active)`,
          terminals: sql<number>`(select count(*) from terminals t where t.tenant_id = ${tenants.id} and t.status = 'active')`,
          products: sql<number>`(select count(*) from products p where p.tenant_id = ${tenants.id})`,
          sales30d: sql<number>`(select count(*) from sales s where s.tenant_id = ${tenants.id} and s.kind = 'sale' and s.occurred_at > now() - interval '30 days')`,
          lastActivity: sql<
            string | null
          >`greatest((select max(e.received_at) from sync_events e where e.tenant_id = ${tenants.id}), (select max(s.created_at) from sessions s where s.tenant_id = ${tenants.id}))`,
        })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(condition)
        .orderBy(desc(tenants.createdAt))
        .limit(query.limit)
        .offset(query.offset);
      const [total] = await tx.select({ n: count() }).from(tenants).where(condition);
      return {
        items: rows.map((r) => ({
          ...r,
          users: Number(r.users),
          terminals: Number(r.terminals),
          products: Number(r.products),
          sales30d: Number(r.sales30d),
          trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          lastActivity: r.lastActivity ? new Date(r.lastActivity).toISOString() : null,
        })),
        total: Number(total?.n ?? 0),
      };
    });
  }

  async detail(id: string) {
    return asPlatform(this.db, async (tx) => {
      const [row] = await tx
        .select({ tenant: tenants, plan: plans })
        .from(tenants)
        .innerJoin(plans, eq(plans.id, tenants.planId))
        .where(eq(tenants.id, id));
      if (!row) throw notFound('Cliente');
      const companyRows = await tx
        .select()
        .from(companies)
        .where(eq(companies.tenantId, id))
        .orderBy(asc(companies.createdAt));
      const storeRows = await tx
        .select()
        .from(stores)
        .where(eq(stores.tenantId, id))
        .orderBy(asc(stores.createdAt));
      const terminalRows = await tx
        .select({
          id: terminals.id,
          name: terminals.name,
          platform: terminals.platform,
          nfceSeries: terminals.nfceSeries,
          status: terminals.status,
          storeId: terminals.storeId,
          lastSync: sql<
            string | null
          >`(select max(e.received_at) from sync_events e where e.terminal_id = "terminals"."id")`,
          lastSeq: sql<number>`(select coalesce(max(e.device_seq), 0) from sync_events e where e.terminal_id = "terminals"."id")`,
        })
        .from(terminals)
        .where(eq(terminals.tenantId, id))
        .orderBy(asc(terminals.nfceSeries));
      const members = await tx
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          role: roles.name,
          systemKey: roles.systemKey,
          active: memberships.active,
          lastLogin: sql<
            string | null
          >`(select max(s.created_at) from sessions s where s.user_id = ${users.id} and s.tenant_id = ${id})`,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.tenantId, id))
        .orderBy(asc(users.name));
      const usage = {
        companies: companyRows.length,
        stores: storeRows.length,
        terminals: terminalRows.filter((t) => t.status === 'active').length,
        users: members.filter((m) => m.active).length,
        products: Number(
          (
            await tx
              .select({ n: count() })
              .from(products)
              .where(and(eq(products.tenantId, id), eq(products.active, true)))
          )[0]?.n ?? 0,
        ),
      };
      const [sales30] = await tx
        .select({ n: count(), totalCents: sql<number>`coalesce(sum(${sales.totalCents}), 0)` })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, id),
            eq(sales.kind, 'sale'),
            eq(sales.status, 'completed'),
            gte(sales.occurredAt, daysAgo(30)),
          ),
        );
      const events = await tx
        .select({ event: tenantEvents, adminName: users.name })
        .from(tenantEvents)
        .leftJoin(users, eq(users.id, tenantEvents.adminId))
        .where(eq(tenantEvents.tenantId, id))
        .orderBy(desc(tenantEvents.createdAt))
        .limit(100);
      const recentAudit = await tx
        .select({
          seq: auditLog.seq,
          action: auditLog.action,
          data: auditLog.data,
          createdAt: auditLog.createdAt,
          actorId: auditLog.actorId,
        })
        .from(auditLog)
        .where(eq(auditLog.tenantId, id))
        .orderBy(desc(auditLog.seq))
        .limit(50);
      return {
        tenant: {
          ...row.tenant,
          createdAt: row.tenant.createdAt.toISOString(),
          trialEndsAt: row.tenant.trialEndsAt?.toISOString() ?? null,
          statusChangedAt: row.tenant.statusChangedAt?.toISOString() ?? null,
        },
        plan: row.plan,
        limits: effectiveLimits(row.plan.limits as PlanLimits, row.tenant.limitOverrides),
        usage,
        sales30d: { count: Number(sales30?.n ?? 0), totalCents: Number(sales30?.totalCents ?? 0) },
        companies: companyRows,
        stores: storeRows,
        terminals: terminalRows.map((t) => ({
          ...t,
          lastSeq: Number(t.lastSeq),
          lastSync: t.lastSync ? new Date(t.lastSync).toISOString() : null,
        })),
        members: members.map((m) => ({
          ...m,
          lastLogin: m.lastLogin ? new Date(m.lastLogin).toISOString() : null,
        })),
        events: events.map((e) => ({
          ...e.event,
          createdAt: e.event.createdAt.toISOString(),
          adminName: e.adminName,
        })),
        audit: recentAudit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      };
    });
  }

  // ---------------------------------------------------------------- actions

  private async requireTenant(tx: Tx, id: string) {
    const [row] = await tx.select().from(tenants).where(eq(tenants.id, id));
    if (!row) throw notFound('Cliente');
    return row;
  }

  private async event(
    tx: Tx,
    admin: AdminContext,
    tenantId: string,
    kind: string,
    data: unknown,
    action: string,
  ) {
    await tx
      .insert(tenantEvents)
      .values({ id: uuidv7(), tenantId, kind, data, adminId: admin.userId });
    await this.audit.record(tx, admin, { action, tenantId, target: 'tenant', data });
  }

  async changePlan(admin: AdminContext, id: string, input: z.output<typeof changePlanInput>) {
    const result = await asPlatform(this.db, async (tx) => {
      const current = await this.requireTenant(tx, id);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId));
      if (!plan) throw notFound('Plano');
      const trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;
      if (trialEndsAt && trialEndsAt.getTime() < Date.now()) {
        throw new AppError(400, 'validation', 'A data de fim do teste precisa ser no futuro.');
      }
      // A trial puts the client in "trial"; a plain plan change reactivates an expired trial.
      const status: TenantStatus = trialEndsAt
        ? 'trial'
        : current.status === 'trial'
          ? 'active'
          : current.status;
      await tx
        .update(tenants)
        .set({
          planId: plan.id,
          trialEndsAt,
          status,
          statusChangedAt: status !== current.status ? new Date() : current.statusChangedAt,
        })
        .where(eq(tenants.id, id));
      await this.event(
        tx,
        admin,
        id,
        trialEndsAt ? 'trial_set' : 'plan_changed',
        {
          from: current.planId,
          to: plan.id,
          trialEndsAt: trialEndsAt?.toISOString() ?? null,
          reason: input.reason,
        },
        trialEndsAt ? 'tenant.trial_set' : 'tenant.plan_changed',
      );
      return { planId: plan.id, status, trialEndsAt: trialEndsAt?.toISOString() ?? null };
    });
    this.notifyMercadoflow(id);
    return result;
  }

  async setStatus(
    admin: AdminContext,
    id: string,
    status: 'active' | 'suspended' | 'cancelled',
    reason: string,
  ) {
    const result = await asPlatform(this.db, async (tx) => {
      const current = await this.requireTenant(tx, id);
      if (current.status === status) {
        throw new AppError(409, 'conflict', 'O cliente já está nesse status.');
      }
      await tx
        .update(tenants)
        .set({
          status,
          statusReason: status === 'active' ? null : reason,
          statusChangedAt: new Date(),
          ...(status === 'active' && { trialEndsAt: null }),
        })
        .where(eq(tenants.id, id));
      if (status !== 'active') {
        // Suspending or cancelling ends every open session at once.
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.tenantId, id), isNull(sessions.revokedAt)));
      }
      const kind = status === 'active' ? 'reactivated' : status;
      await this.event(
        tx,
        admin,
        id,
        kind,
        { from: current.status, to: status, reason },
        `tenant.${kind}`,
      );
      return { status };
    });
    this.notifyMercadoflow(id);
    return result;
  }

  async setLimits(admin: AdminContext, id: string, overrides: Partial<PlanLimits>, reason: string) {
    return asPlatform(this.db, async (tx) => {
      const current = await this.requireTenant(tx, id);
      const clean = Object.keys(overrides).length ? overrides : null;
      await tx.update(tenants).set({ limitOverrides: clean }).where(eq(tenants.id, id));
      await this.event(
        tx,
        admin,
        id,
        'limits_changed',
        { from: current.limitOverrides, to: clean, reason },
        'tenant.limits_changed',
      );
      return { limitOverrides: clean };
    });
  }

  async addNote(admin: AdminContext, id: string, note: string) {
    return asPlatform(this.db, async (tx) => {
      await this.requireTenant(tx, id);
      await this.event(tx, admin, id, 'note', { note }, 'tenant.note');
      return { ok: true };
    });
  }

  /** Ends every session of one person in this client (lost phone, staff leaving). */
  async revokeUserSessions(admin: AdminContext, tenantId: string, userId: string) {
    return asPlatform(this.db, async (tx) => {
      await this.requireTenant(tx, tenantId);
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.tenantId, tenantId),
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });
      await this.audit.record(tx, admin, {
        action: 'tenant.user_sessions_revoked',
        tenantId,
        target: userId,
        data: { sessions: revoked.length },
      });
      return { revoked: revoked.length };
    });
  }

  /**
   * Support access: a short-lived client token acting as the client's owner, marked with the
   * staff member. Read-only by default; writable access needs the "manage" permission.
   */
  async impersonate(admin: AdminContext, id: string, input: z.output<typeof impersonateInput>) {
    if (!input.readOnly && !platformCan(admin.role, 'platform.tenants.manage')) {
      throw new AppError(
        403,
        'forbidden',
        'Seu papel só permite acesso de suporte somente leitura.',
      );
    }
    const owner = await asPlatform(this.db, async (tx) => {
      const tenant = await this.requireTenant(tx, id);
      const [row] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(
          and(
            eq(memberships.tenantId, id),
            eq(roles.systemKey, 'owner'),
            eq(memberships.active, true),
          ),
        )
        .orderBy(asc(memberships.createdAt))
        .limit(1);
      if (!row)
        throw new AppError(
          409,
          'conflict',
          'Este cliente não tem um dono ativo para o acesso de suporte.',
        );
      await this.event(
        tx,
        admin,
        id,
        'support_session',
        { reason: input.reason, readOnly: input.readOnly },
        'tenant.support_session',
      );
      return { userId: row.userId, tenantName: tenant.name };
    });
    // Also visible in the client's own audit trail.
    await withTenant(this.db, { tenantId: id, userId: owner.userId }, (tx) =>
      this.tenantAudit.record(
        tx,
        { tenantId: id, userId: owner.userId, impersonatedBy: admin.userId },
        {
          action: 'support.session_started',
          entity: 'tenant',
          entityId: id,
          data: { reason: input.reason, readOnly: input.readOnly },
        },
      ),
    );
    const ttl = this.config.SUPPORT_SESSION_MINUTES * 60;
    return {
      accessToken: await this.tokens.signAccess(
        { sub: owner.userId, tid: id, imp: admin.userId, ro: input.readOnly },
        ttl,
      ),
      expiresIn: ttl,
      tenantName: owner.tenantName,
      readOnly: input.readOnly,
    };
  }

  /** Onboarding by the Bipaê team (sales): creates the client exactly like a signup. */
  async create(admin: AdminContext, input: z.output<typeof adminCreateTenantInput>) {
    const result = await this.auth.signup({
      ownerName: input.ownerName,
      businessName: input.businessName,
      email: input.ownerEmail,
      password: input.password,
      taxId: null,
    });
    const tenantId = result.me.tenant.id;
    if (input.planId !== 'gratis' || input.trialEndsAt) {
      await this.changePlan(admin, tenantId, {
        planId: input.planId,
        trialEndsAt: input.trialEndsAt ?? null,
        reason: 'Cliente criado pela equipe Bipaê',
      });
    }
    await asPlatform(this.db, (tx) =>
      this.audit.record(tx, admin, {
        action: 'tenant.created_by_admin',
        tenantId,
        data: { businessName: input.businessName, ownerEmail: input.ownerEmail },
      }),
    );
    return { id: tenantId };
  }
}
