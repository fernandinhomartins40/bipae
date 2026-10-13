import { Inject, Injectable } from '@nestjs/common';
import { inviteCreateInput, inviteUserInput, roleInput, uuidv7 } from '@bipae/domain';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { invites, memberships, roles, stores, users } from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LimitsService) private readonly limits: LimitsService,
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
          storeIds: memberships.storeIds,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .orderBy(asc(users.name)),
    );
  }

  /**
   * Cria a conta de uma pessoa nova na equipe, com senha inicial (ex.: o caixa da loja). Quem já
   * tem conta no Bipaê (ex.: o contador de várias empresas) só entra se aceitar um convite.
   */
  async addMember(ctx: RequestContext, input: z.output<typeof inviteUserInput>) {
    if (await this.auth.findUserByEmail(input.email)) {
      throw new AppError(
        409,
        'use_invite',
        'Esta pessoa já tem conta no Bipaê. Envie um convite por link para ela aceitar.',
      );
    }
    const passwordHash = await this.auth.hashPassword(input.password);
    const userId = uuidv7();

    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'users');
      const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId));
      if (!role) throw notFound('Papel');
      await tx.insert(users).values({
        id: userId,
        name: input.name,
        email: input.email,
        passwordHash,
      });
      await tx.insert(memberships).values({ tenantId: ctx.tenantId, userId, roleId: role.id });
      await this.audit.record(tx, ctx, {
        action: 'member.added',
        entity: 'user',
        entityId: userId,
        data: { email: input.email, role: role.name },
      });
      return { userId, name: input.name, email: input.email, roleId: role.id };
    });
  }

  // ------------------------------------------------------------- convites por link (F1-06)

  /** Cria o convite e devolve o link uma única vez; no banco fica só o hash do segredo. */
  async createInvite(ctx: RequestContext, input: z.output<typeof inviteCreateInput>) {
    const secret = randomBytes(24).toString('base64url');
    const id = uuidv7();
    const token = `${id}.${secret}`;
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    return withTenant(this.db, ctx, async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId));
      if (!role) throw notFound('Papel');
      if (role.systemKey === 'owner') {
        throw new AppError(422, 'invalid_role', 'O papel de Dono não pode ser dado por convite.');
      }
      if (input.storeIds && input.storeIds.length > 0) {
        const ids = [...new Set(input.storeIds)];
        const found = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(inArray(stores.id, ids));
        if (found.length !== ids.length) {
          throw new AppError(422, 'invalid_store', 'Uma das lojas escolhidas não existe.');
        }
      }
      await tx.insert(invites).values({
        id,
        tenantId: ctx.tenantId,
        roleId: role.id,
        storeIds: input.storeIds ?? null,
        email: input.email ?? null,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdBy: ctx.userId,
        expiresAt,
      });
      await this.audit.record(tx, ctx, {
        action: 'invite.created',
        entity: 'invite',
        entityId: id,
        data: { role: role.name, email: input.email ?? null },
      });
      return { id, token, path: `/convite/${token}`, expiresAt: expiresAt.toISOString() };
    });
  }

  /** Convites ainda válidos (não usados, não revogados, dentro da validade). */
  listInvites(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          id: invites.id,
          roleName: roles.name,
          email: invites.email,
          storeIds: invites.storeIds,
          createdAt: invites.createdAt,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .innerJoin(roles, eq(roles.id, invites.roleId))
        .where(
          and(
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invites.createdAt)),
    );
  }

  async revokeInvite(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
        .returning({ id: invites.id });
      if (!row) throw notFound('Convite');
      await this.audit.record(tx, ctx, {
        action: 'invite.revoked',
        entity: 'invite',
        entityId: id,
      });
      return { revoked: true };
    });
  }

  async updateMember(
    ctx: RequestContext,
    userId: string,
    input: { roleId?: string; active?: boolean; storeIds?: string[] | null },
  ) {
    if (userId === ctx.userId) {
      throw new AppError(400, 'self_change', 'Você não pode mudar o seu próprio acesso.');
    }
    return withTenant(this.db, ctx, async (tx) => {
      if (input.storeIds && input.storeIds.length > 0) {
        // Lista de lojas não tem chave estrangeira: confirma que são desta empresa.
        const ids = [...new Set(input.storeIds)];
        const found = await tx
          .select({ id: stores.id })
          .from(stores)
          .where(inArray(stores.id, ids));
        if (found.length !== ids.length) {
          throw new AppError(422, 'invalid_store', 'Uma das lojas escolhidas não existe.');
        }
      }
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
