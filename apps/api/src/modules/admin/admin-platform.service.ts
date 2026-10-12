import { Inject, Injectable } from '@nestjs/common';
import { announcementInput, planInput, uuidv7, type PlatformRole } from '@bipae/domain';
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { Config } from '../../config';
import { asPlatform, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import {
  adminSessions,
  announcements,
  memberships,
  plans,
  platformAdmins,
  sessions,
  tenants,
  users,
} from '../../db/schema';
import { API_VERSION_INFO } from '../../version';
import { AuthService } from '../auth/auth.service';
import type { AdminContext } from './platform.guard';
import { PlatformAuditService } from './platform-audit.service';

@Injectable()
export class AdminPlatformService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  // ---------------------------------------------------------------- plans

  listPlans() {
    return asPlatform(this.db, async (tx) => {
      const rows = await tx
        .select({
          plan: plans,
          tenants: sql<number>`(select count(*) from tenants t where t.plan_id = "plans"."id" and t.status in ('active','trial'))`,
        })
        .from(plans)
        .orderBy(asc(plans.sort));
      return rows.map((r) => ({ ...r.plan, tenants: Number(r.tenants) }));
    });
  }

  async savePlan(admin: AdminContext, input: z.output<typeof planInput>, create: boolean) {
    return asPlatform(this.db, async (tx) => {
      const [existing] = await tx.select().from(plans).where(eq(plans.id, input.id));
      if (create && existing) throw new AppError(409, 'conflict', 'Já existe um plano com este código.');
      if (!create && !existing) throw notFound('Plano');
      const values = {
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        limits: input.limits,
        features: input.features,
        public: input.public,
        active: input.active,
        sort: input.sort,
        updatedAt: new Date(),
      };
      if (create) await tx.insert(plans).values({ id: input.id, ...values });
      else await tx.update(plans).set(values).where(eq(plans.id, input.id));
      await this.audit.record(tx, admin, {
        action: create ? 'plan.created' : 'plan.updated',
        target: input.id,
        data: create ? input : { before: existing, after: input },
      });
      return { id: input.id };
    });
  }

  // ---------------------------------------------------------------- announcements

  listAnnouncements() {
    return asPlatform(this.db, (tx) => tx.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(100));
  }

  async saveAnnouncement(admin: AdminContext, id: string | null, input: z.output<typeof announcementInput>) {
    return asPlatform(this.db, async (tx) => {
      const values = {
        title: input.title,
        body: input.body,
        level: input.level,
        planIds: input.planIds?.length ? input.planIds : null,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      };
      const announcementId = id ?? uuidv7();
      if (id) {
        const [row] = await tx.update(announcements).set(values).where(eq(announcements.id, id)).returning();
        if (!row) throw notFound('Aviso');
      } else {
        await tx.insert(announcements).values({ id: announcementId, ...values, createdBy: admin.userId });
      }
      await this.audit.record(tx, admin, { action: id ? 'announcement.updated' : 'announcement.created', target: announcementId, data: input });
      return { id: announcementId };
    });
  }

  async endAnnouncement(admin: AdminContext, id: string) {
    return asPlatform(this.db, async (tx) => {
      const [row] = await tx.update(announcements).set({ endsAt: new Date() }).where(eq(announcements.id, id)).returning();
      if (!row) throw notFound('Aviso');
      await this.audit.record(tx, admin, { action: 'announcement.ended', target: id });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- Bipaê team

  listAdmins() {
    return asPlatform(this.db, (tx) =>
      tx
        .select({
          userId: platformAdmins.userId,
          name: users.name,
          email: users.email,
          role: platformAdmins.role,
          active: platformAdmins.active,
          totpEnabled: platformAdmins.totpEnabled,
          createdAt: platformAdmins.createdAt,
          lastLogin: sql<string | null>`(select max(s.created_at) from admin_sessions s where s.user_id = ${platformAdmins.userId})`,
        })
        .from(platformAdmins)
        .innerJoin(users, eq(users.id, platformAdmins.userId))
        .orderBy(asc(users.name)),
    );
  }

  /** Grants panel access to an existing Bipaê account (the person signs up first). */
  async addAdmin(admin: AdminContext, email: string, role: PlatformRole) {
    const user = await this.auth.findUserByEmail(email);
    if (!user) {
      throw new AppError(404, 'not_found', 'Não existe conta com este e-mail. A pessoa precisa criar uma conta no Bipaê antes.');
    }
    return asPlatform(this.db, async (tx) => {
      const [existing] = await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, user.id));
      if (existing?.active) throw new AppError(409, 'conflict', 'Esta pessoa já faz parte da equipe Bipaê.');
      if (existing) {
        await tx.update(platformAdmins).set({ active: true, role, updatedAt: new Date() }).where(eq(platformAdmins.userId, user.id));
      } else {
        await tx.insert(platformAdmins).values({ userId: user.id, role, createdBy: admin.userId });
      }
      await this.audit.record(tx, admin, { action: 'admin.granted', target: user.id, data: { email, role } });
      return { userId: user.id };
    });
  }

  async updateAdmin(admin: AdminContext, userId: string, change: { role?: PlatformRole; active?: boolean }) {
    if (userId === admin.userId) throw new AppError(400, 'self_change', 'Você não pode mudar o seu próprio acesso.');
    return asPlatform(this.db, async (tx) => {
      const [current] = await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, userId));
      if (!current) throw notFound('Pessoa da equipe');
      const losesOwner = current.role === 'owner' && current.active && (change.active === false || (change.role && change.role !== 'owner'));
      if (losesOwner) {
        const [others] = await tx
          .select({ n: count() })
          .from(platformAdmins)
          .where(and(eq(platformAdmins.role, 'owner'), eq(platformAdmins.active, true), ne(platformAdmins.userId, userId)));
        if (!Number(others?.n)) throw new AppError(400, 'last_owner', 'A plataforma precisa de pelo menos um administrador ativo.');
      }
      await tx.update(platformAdmins).set({ ...change, updatedAt: new Date() }).where(eq(platformAdmins.userId, userId));
      if (change.active === false) {
        await tx.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)));
      }
      await this.audit.record(tx, admin, { action: 'admin.updated', target: userId, data: { before: { role: current.role, active: current.active }, after: change } });
      return { ok: true };
    });
  }

  /** Resets someone's 2FA (lost phone). They must enable it again at the next sign-in. */
  async resetAdminTotp(admin: AdminContext, userId: string) {
    return asPlatform(this.db, async (tx) => {
      const [row] = await tx
        .update(platformAdmins)
        .set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() })
        .where(eq(platformAdmins.userId, userId))
        .returning();
      if (!row) throw notFound('Pessoa da equipe');
      await tx.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)));
      await this.audit.record(tx, admin, { action: 'admin.totp_reset', target: userId });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- people across clients

  async searchUsers(q: string) {
    const term = `%${q.trim().replace(/[%_\\]/g, '\\$&')}%`;
    return asPlatform(this.db, async (tx) => {
      const rows = await tx
        .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
        .from(users)
        .where(or(ilike(users.email, term), ilike(users.name, term)))
        .orderBy(asc(users.email))
        .limit(50);
      const result = [];
      for (const u of rows) {
        const clientRows = await tx
          .select({ tenantId: tenants.id, name: tenants.name, status: tenants.status, active: memberships.active })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(eq(memberships.userId, u.id));
        const [staff] = await tx.select({ role: platformAdmins.role }).from(platformAdmins).where(eq(platformAdmins.userId, u.id));
        result.push({ ...u, createdAt: u.createdAt.toISOString(), clients: clientRows, staffRole: staff?.role ?? null });
      }
      return result;
    });
  }

  /** Ends every session of a person in every client (compromised account). */
  async revokeAllSessions(admin: AdminContext, userId: string) {
    return asPlatform(this.db, async (tx) => {
      const revoked = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      await this.audit.record(tx, admin, { action: 'user.sessions_revoked', target: userId, data: { sessions: revoked.length } });
      return { revoked: revoked.length };
    });
  }

  // ---------------------------------------------------------------- system

  async system() {
    return asPlatform(this.db, async (tx) => {
      const size = rowsOf<{ size: string }>(await tx.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size`));
      const tables = rowsOf<{ name: string; rows: number; size: string }>(
        await tx.execute(sql`
          select relname as name, n_live_tup::int as rows, pg_size_pretty(pg_total_relation_size(relid)) as size
          from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15`),
      );
      const migrations = rowsOf<{ name: string; applied_at: string }>(
        await tx.execute(sql`select name, applied_at from schema_migrations order by name`),
      );
      const version = rowsOf<{ version: string }>(await tx.execute(sql`select version()`));
      const memory = process.memoryUsage();
      return {
        api: API_VERSION_INFO,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: { rss: Math.round(memory.rss / 1_048_576), heapUsed: Math.round(memory.heapUsed / 1_048_576) },
        database: { kind: this.config.DATABASE_URL.startsWith('pglite://') ? 'pglite' : 'postgres', size: size[0]?.size ?? '?', version: version[0]?.version ?? '?' },
        migrations,
        tables,
        config: {
          requireTotp: this.config.PLATFORM_REQUIRE_TOTP,
          supportSessionMinutes: this.config.SUPPORT_SESSION_MINUTES,
          minimumClientVersions: this.config.minimumClientVersions,
        },
      };
    });
  }
}
