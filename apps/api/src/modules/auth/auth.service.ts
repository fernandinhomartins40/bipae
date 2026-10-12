import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  parseTaxId,
  SYSTEM_ROLES,
  uuidv7,
  type LoginInput,
  type Me,
  type SessionTokens,
  type signupInput,
  type SystemRoleKey,
} from '@bipae/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { TokenService } from '../../common/tokens';
import { asApp, withTenant, type Db, type Tx } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import {
  companies,
  fiscalProfiles,
  memberships,
  roles,
  sessions,
  stores,
  tenantEvents,
  tenants,
  units,
  users,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const INVALID_LOGIN = 'E-mail ou senha incorretos.';
const SESSION_EXPIRED = 'Sua sessão expirou. Entre novamente.';

export const DEFAULT_UNITS = [
  { code: 'UN', description: 'Unidade', decimals: 0 },
  { code: 'KG', description: 'Quilograma', decimals: 3 },
  { code: 'G', description: 'Grama', decimals: 0 },
  { code: 'L', description: 'Litro', decimals: 3 },
  { code: 'ML', description: 'Mililitro', decimals: 0 },
  { code: 'M', description: 'Metro', decimals: 2 },
  { code: 'CX', description: 'Caixa', decimals: 0 },
  { code: 'PCT', description: 'Pacote', decimals: 0 },
  { code: 'DZ', description: 'Dúzia', decimals: 0 },
];

export interface AuthResult extends SessionTokens {
  me: Me;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // Hash of a random password, verified when the e-mail does not exist so timing stays equal.
  private readonly dummyHash = hash(crypto.randomUUID());

  hashPassword(password: string) {
    return hash(password);
  }

  /**
   * Creates everything needed to sell right away: tenant, owner, system roles, company,
   * main store, units and a default fiscal profile. No mandatory setup screens (UX §9).
   */
  async signup(input: z.output<typeof signupInput>, userAgent?: string): Promise<AuthResult> {
    const tenantId = uuidv7();
    const userId = uuidv7();
    const companyId = uuidv7();
    const passwordHash = await this.hashPassword(input.password);
    const taxId = input.taxId ? parseTaxId(input.taxId) : null;

    await withTenant(this.db, { tenantId, userId }, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: input.businessName });
      await tx.insert(users).values({
        id: userId,
        name: input.ownerName,
        email: input.email,
        passwordHash,
      });
      const roleIds = await this.createSystemRoles(tx, tenantId);
      await tx.insert(memberships).values({ tenantId, userId, roleId: roleIds.owner });
      await tx.insert(companies).values({
        id: companyId,
        tenantId,
        legalName: input.businessName,
        taxId: taxId?.kind === 'cnpj' ? taxId.value : null,
      });
      await tx.insert(stores).values({ id: uuidv7(), tenantId, companyId, name: 'Loja principal' });
      await tx.insert(units).values(DEFAULT_UNITS.map((u) => ({ ...u, tenantId })));
      await tx.insert(fiscalProfiles).values({
        id: uuidv7(),
        tenantId,
        name: 'Revenda — Simples Nacional',
        data: { origem: 0, cfopInterna: '5102', cfopInterestadual: '6102', csosn: '102' },
      });
      await tx
        .insert(tenantEvents)
        .values({ id: uuidv7(), tenantId, kind: 'created', data: { planId: 'gratis' } });
      await this.audit.record(
        tx,
        { tenantId, userId },
        {
          action: 'tenant.created',
          entity: 'tenant',
          entityId: tenantId,
          data: { businessName: input.businessName },
        },
      );
    });

    return this.issueSession(tenantId, userId, userAgent);
  }

  async createSystemRoles(tx: Tx, tenantId: string): Promise<Record<SystemRoleKey, string>> {
    const ids = {} as Record<SystemRoleKey, string>;
    for (const [key, role] of Object.entries(SYSTEM_ROLES) as [
      SystemRoleKey,
      (typeof SYSTEM_ROLES)[SystemRoleKey],
    ][]) {
      ids[key] = uuidv7();
      await tx.insert(roles).values({
        id: ids[key],
        tenantId,
        systemKey: key,
        name: role.name,
        permissions: role.permissions,
      });
    }
    return ids;
  }

  async login(input: LoginInput, userAgent?: string): Promise<AuthResult> {
    const found = await this.findUserByEmail(input.email);
    const valid = await verify(found?.password_hash ?? (await this.dummyHash), input.password);
    if (!found || !valid) throw new AppError(401, 'invalid_login', INVALID_LOGIN);

    const available = await this.userTenants(found.id);
    if (available.length === 0) {
      throw new AppError(401, 'no_tenant', 'Seu usuário não está ativo em nenhuma empresa.');
    }
    const tenant = input.tenantId ? available.find((t) => t.id === input.tenantId) : available[0];
    if (!tenant) throw new AppError(403, 'forbidden', 'Você não tem acesso a esta empresa.');
    return this.issueSession(tenant.id, found.id, userAgent);
  }

  async switchTenant(userId: string, tenantId: string, userAgent?: string) {
    const available = await this.userTenants(userId);
    if (!available.some((t) => t.id === tenantId)) {
      throw new AppError(403, 'forbidden', 'Você não tem acesso a esta empresa.');
    }
    return this.issueSession(tenantId, userId, userAgent);
  }

  /** Rotates the refresh token. Reusing an old token revokes the whole session family. */
  async refresh(refreshToken: string, userAgent?: string): Promise<AuthResult> {
    const { tenantId, sessionId, secret } = this.tokens.parseRefreshToken(refreshToken);
    const outcome = await withTenant(this.db, { tenantId }, async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session || !this.tokens.secretMatches(secret, session.tokenHash)) return null;
      if (session.revokedAt) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
        await this.audit.record(
          tx,
          { tenantId, userId: session.userId },
          {
            action: 'auth.refresh_reuse_detected',
            entity: 'session',
            entityId: session.familyId,
          },
        );
        return 'reused' as const;
      }
      if (session.expiresAt.getTime() < Date.now()) return null;
      return session;
    });
    if (!outcome || outcome === 'reused') {
      throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    }
    return this.issueSession(outcome.tenantId, outcome.userId, userAgent, outcome);
  }

  async logout(refreshToken: string) {
    const { tenantId, sessionId, secret } = this.tokens.parseRefreshToken(refreshToken);
    await withTenant(this.db, { tenantId }, async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session || !this.tokens.secretMatches(secret, session.tokenHash)) return;
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.familyId, session.familyId), isNull(sessions.revokedAt)));
    });
  }

  async me(tenantId: string, userId: string, permissions: string[]): Promise<Me> {
    const [user, tenant] = await withTenant(this.db, { tenantId, userId }, async (tx) => {
      const [u] = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      const [t] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants);
      return [u, t] as const;
    });
    if (!user || !tenant) throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    return { user, tenant, permissions, tenants: await this.userTenants(userId) };
  }

  /**
   * A supervisor approves a sensitive register action (discount above the limit, cancel,
   * cash withdrawal) by typing their own credentials on the operator's screen.
   */
  async authorize(tenantId: string, email: string, password: string, permission: string) {
    const found = await this.findUserByEmail(email);
    const valid = await verify(found?.password_hash ?? (await this.dummyHash), password);
    if (!found || !valid) throw new AppError(401, 'invalid_login', INVALID_LOGIN);
    const granted = await withTenant(this.db, { tenantId, userId: found.id }, async (tx) => {
      const [row] = await tx
        .select({ permissions: roles.permissions, active: memberships.active })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.userId, found.id));
      return Boolean(row?.active && row.permissions.includes(permission));
    });
    if (!granted) {
      throw new AppError(403, 'forbidden', 'Esta pessoa não tem permissão para autorizar isso.');
    }
    return { userId: found.id, name: found.name };
  }

  async findUserByEmail(email: string) {
    return asApp(this.db, async (tx) => {
      const result = await tx.execute(sql`select * from auth_find_user(${email})`);
      return rowsOf<{ id: string; name: string; email: string; password_hash: string }>(result)[0];
    });
  }

  private async userTenants(userId: string) {
    return asApp(this.db, async (tx) => {
      const result = await tx.execute(sql`select * from auth_user_tenants(${userId})`);
      return rowsOf<{ tenant_id: string; tenant_name: string }>(result).map((r) => ({
        id: r.tenant_id,
        name: r.tenant_name,
      }));
    });
  }

  private async issueSession(
    tenantId: string,
    userId: string,
    userAgent: string | undefined,
    previous?: { id: string; familyId: string },
  ): Promise<AuthResult> {
    const sessionId = uuidv7();
    const secret = this.tokens.newRefreshSecret();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const permissions = await withTenant(this.db, { tenantId, userId }, async (tx) => {
      await tx.insert(sessions).values({
        id: sessionId,
        tenantId,
        userId,
        familyId: previous?.familyId ?? sessionId,
        tokenHash: this.tokens.hashSecret(secret),
        userAgent: userAgent?.slice(0, 200) ?? null,
        expiresAt,
      });
      if (previous) {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), replacedBy: sessionId })
          .where(eq(sessions.id, previous.id));
      }
      const [row] = await tx
        .select({ permissions: roles.permissions })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.userId, userId));
      return row?.permissions ?? [];
    });

    return {
      accessToken: await this.tokens.signAccess({ sub: userId, tid: tenantId }),
      refreshToken: `${tenantId}.${sessionId}.${secret}`,
      expiresIn: this.tokens.accessTtl,
      me: await this.me(tenantId, userId, permissions),
    };
  }
}
