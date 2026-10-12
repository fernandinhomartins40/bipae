import { Inject, Injectable } from '@nestjs/common';
import { inviteUserInput, roleInput, uuidv7 } from '@bipae/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { memberships, roles, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  listRoles(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) => tx.select().from(roles).orderBy(asc(roles.createdAt)));
  }

  async createRole(ctx: RequestContext, input: z.output<typeof roleInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .insert(roles)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'role.created',
        entity: 'role',
        entityId: row!.id,
        data: input,
      });
      return row!;
    });
  }

  async updateRole(ctx: RequestContext, id: string, input: z.output<typeof roleInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [current] = await tx.select().from(roles).where(eq(roles.id, id));
      if (!current) throw notFound('Papel');
      if (current.systemKey === 'owner') {
        throw new AppError(400, 'owner_role', 'O papel de Dono sempre tem todas as permissões.');
      }
      const [row] = await tx
        .update(roles)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(roles.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'role.updated',
        entity: 'role',
        entityId: id,
        data: { before: current.permissions, after: input.permissions },
      });
      return row!;
    });
  }

  listMembers(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          roleId: memberships.roleId,
          roleName: roles.name,
          active: memberships.active,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .orderBy(asc(users.name)),
    );
  }

  /**
   * Adds a person to the team. New e-mails get an account with the given initial password;
   * existing accounts (e.g. an accountant serving many businesses) just gain access.
   */
  async addMember(ctx: RequestContext, input: z.output<typeof inviteUserInput>) {
    const existing = await this.auth.findUserByEmail(input.email);
    const passwordHash = existing ? null : await this.auth.hashPassword(input.password);
    const userId = existing?.id ?? uuidv7();

    return withTenant(this.db, ctx, async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId));
      if (!role) throw notFound('Papel');
      if (!existing) {
        await tx
          .insert(users)
          .values({ id: userId, name: input.name, email: input.email, passwordHash: passwordHash! });
      }
      await tx.insert(memberships).values({ tenantId: ctx.tenantId, userId, roleId: role.id });
      await this.audit.record(tx, ctx, {
        action: 'member.added',
        entity: 'user',
        entityId: userId,
        data: { email: input.email, role: role.name, existingAccount: Boolean(existing) },
      });
      return { userId, name: existing?.name ?? input.name, email: input.email, roleId: role.id };
    });
  }

  async updateMember(
    ctx: RequestContext,
    userId: string,
    input: { roleId?: string; active?: boolean },
  ) {
    if (userId === ctx.userId) {
      throw new AppError(400, 'self_change', 'Você não pode mudar o seu próprio acesso.');
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(memberships)
        .set(input)
        .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, ctx.tenantId)))
        .returning();
      if (!row) throw notFound('Membro da equipe');
      await this.audit.record(tx, ctx, {
        action: 'member.updated',
        entity: 'user',
        entityId: userId,
        data: input,
      });
      return row;
    });
  }
}
