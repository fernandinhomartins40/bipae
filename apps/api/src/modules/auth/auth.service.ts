import { Inject, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  parseTaxId,
  SYSTEM_ROLES,
  uuidv7,
  passwordSchema,
  type inviteAcceptInput,
  type InviteInfo,
  type LoginInput,
  type Me,
  type SessionTokens,
  type signupInput,
  type SystemRoleKey,
} from '@bipae/domain';
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { TokenService } from '../../common/tokens';
import { newTotpSecret, totpUri, verifyTotp } from '../../common/totp';
import { asApp, asPlatform, withTenant, type Db, type Tx } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import {
  companies,
  fiscalProfiles,
  invites,
  memberships,
  platformAdmins,
  roles,
  sessions,
  stores,
  tenantEvents,
  tenants,
  units,
  users,
} from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';
import { mailBody, MailService } from '../mail/mail.service';

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
    @Inject(LimitsService) private readonly limits: LimitsService,
    @Inject(MailService) private readonly mail: MailService,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  private readonly box: SecretBox;

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

    await this.bootstrapPlatformOwner(userId, input.email);
    // O link de confirmação nunca impede o cadastro: sem e-mail ligado, simplesmente não vai.
    await this.sendEmailVerification({
      id: userId,
      name: input.ownerName,
      email: input.email,
    }).catch(() => false);
    return this.issueSession(tenantId, userId, userAgent);
  }

  /** Development/test convenience only (see PLATFORM_BOOTSTRAP_EMAIL). */
  private async bootstrapPlatformOwner(userId: string, email: string) {
    const target = this.config.PLATFORM_BOOTSTRAP_EMAIL;
    if (
      !target ||
      this.config.NODE_ENV === 'production' ||
      target.toLowerCase() !== email.toLowerCase()
    )
      return;
    await asPlatform(this.db, async (tx) => {
      const [existing] = await tx.select({ n: count() }).from(platformAdmins);
      if (Number(existing?.n) > 0) return;
      await tx.insert(platformAdmins).values({ userId, role: 'owner' });
    });
  }

  // ------------------------------------------------------------- two-step verification (F1-01)

  /** After the password: users with 2FA must also send the authenticator code. */
  private checkSecondFactor(
    user: { totp_enabled: boolean; totp_secret: string | null },
    code: string | undefined,
  ) {
    if (!user.totp_enabled || !user.totp_secret) return;
    if (!code) {
      throw new AppError(
        401,
        'totp_required',
        'Digite o código de 6 dígitos do seu aplicativo autenticador.',
      );
    }
    if (!verifyTotp(this.box.open(user.totp_secret), code)) {
      throw new AppError(
        401,
        'totp_invalid',
        'Código de verificação incorreto. Confira o aplicativo e tente de novo.',
      );
    }
  }

  private async ownUser(tenantId: string, userId: string) {
    const [user] = await withTenant(this.db, { tenantId, userId }, (tx) =>
      tx
        .select({
          email: users.email,
          totpSecret: users.totpSecret,
          totpEnabled: users.totpEnabled,
        })
        .from(users)
        .where(eq(users.id, userId)),
    );
    if (!user) throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    return user;
  }

  async totpStatus(tenantId: string, userId: string) {
    return { enabled: (await this.ownUser(tenantId, userId)).totpEnabled };
  }

  /** Starts (or restarts) the setup: a new seed, kept sealed until a valid code confirms it. */
  async totpSetup(tenantId: string, userId: string) {
    const user = await this.ownUser(tenantId, userId);
    if (user.totpEnabled) {
      throw new AppError(409, 'totp_enabled', 'A verificação em duas etapas já está ativa.');
    }
    const secret = newTotpSecret();
    await withTenant(this.db, { tenantId, userId }, (tx) =>
      tx
        .update(users)
        .set({ totpSecret: this.box.seal(secret), updatedAt: new Date() })
        .where(eq(users.id, userId)),
    );
    return { secret, uri: totpUri(secret, user.email, 'Bipaê') };
  }

  async totpEnable(tenantId: string, userId: string, code: string) {
    const user = await this.ownUser(tenantId, userId);
    if (user.totpEnabled) return { enabled: true };
    if (!user.totpSecret) {
      throw new AppError(409, 'totp_not_started', 'Comece pela leitura do código QR.');
    }
    if (!verifyTotp(this.box.open(user.totpSecret), code)) {
      throw new AppError(
        422,
        'totp_invalid',
        'Código incorreto. Confira o aplicativo e tente de novo.',
      );
    }
    await withTenant(this.db, { tenantId, userId }, async (tx) => {
      await tx
        .update(users)
        .set({ totpEnabled: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.audit.record(
        tx,
        { tenantId, userId },
        { action: 'auth.totp_enabled', entity: 'user', entityId: userId },
      );
    });
    return { enabled: true };
  }

  /** Turning it off asks for a current code, so a stolen open session cannot remove it. */
  async totpDisable(tenantId: string, userId: string, code: string) {
    const user = await this.ownUser(tenantId, userId);
    if (!user.totpEnabled || !user.totpSecret) return { enabled: false };
    if (!verifyTotp(this.box.open(user.totpSecret), code)) {
      throw new AppError(
        422,
        'totp_invalid',
        'Código incorreto. Confira o aplicativo e tente de novo.',
      );
    }
    await withTenant(this.db, { tenantId, userId }, async (tx) => {
      await tx
        .update(users)
        .set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.audit.record(
        tx,
        { tenantId, userId },
        { action: 'auth.totp_disabled', entity: 'user', entityId: userId },
      );
    });
    return { enabled: false };
  }

  // ------------------------------------------------------------- convite por link (F1-06)

  private async findInvite(token: string) {
    return asApp(this.db, async (tx) => {
      const hash = createHash('sha256').update(token).digest('hex');
      const result = await tx.execute(sql`select * from invite_lookup(${hash})`);
      return rowsOf<{
        id: string;
        tenant_id: string;
        tenant_name: string;
        role_id: string;
        role_name: string;
        store_ids: string[] | null;
        email: string | null;
        expires_at: string | Date;
        accepted_at: string | Date | null;
        revoked_at: string | Date | null;
      }>(result)[0];
    });
  }

  private inviteStatus(row: {
    expires_at: string | Date;
    accepted_at: unknown;
    revoked_at: unknown;
  }) {
    if (row.revoked_at) return 'revoked' as const;
    if (row.accepted_at) return 'used' as const;
    if (new Date(row.expires_at).getTime() < Date.now()) return 'expired' as const;
    return 'valid' as const;
  }

  /** O que a tela de aceite mostra antes de a pessoa entrar. */
  async inviteInfo(token: string): Promise<InviteInfo> {
    const row = await this.findInvite(token);
    if (!row) throw new AppError(404, 'not_found', 'Convite não encontrado. Confira o link.');
    return {
      businessName: row.tenant_name,
      roleName: row.role_name,
      email: row.email,
      expiresAt: new Date(row.expires_at).toISOString(),
      status: this.inviteStatus(row),
    };
  }

  /**
   * Aceita o convite: com uma conta que já existe (senha e, se tiver, o código da verificação em
   * duas etapas) ou criando uma conta nova. Uso único; quem aceita já entra na empresa.
   */
  async acceptInvite(
    token: string,
    input: z.output<typeof inviteAcceptInput>,
    userAgent?: string,
  ): Promise<AuthResult> {
    const invite = await this.findInvite(token);
    if (!invite) throw new AppError(404, 'not_found', 'Convite não encontrado. Confira o link.');
    const status = this.inviteStatus(invite);
    const reasons = {
      expired: 'Este convite venceu. Peça um novo para quem enviou.',
      used: 'Este convite já foi usado.',
      revoked: 'Este convite foi cancelado.',
    } as const;
    if (status !== 'valid') throw new AppError(410, `invite_${status}`, reasons[status]);
    if (invite.email && invite.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new AppError(403, 'invite_email', 'Este convite é para outro e-mail.');
    }

    const found = await this.findUserByEmail(input.email);
    let userId: string;
    if (found) {
      const valid = await verify(found.password_hash, input.password);
      if (!valid) throw new AppError(401, 'invalid_login', INVALID_LOGIN);
      this.checkSecondFactor(found, input.totp);
      userId = found.id;
    } else {
      if (!input.name)
        throw new AppError(400, 'validation', 'Informe o seu nome para criar a conta.');
      const parsed = passwordSchema.safeParse(input.password);
      if (!parsed.success) throw new AppError(400, 'validation', parsed.error.issues[0]!.message);
      userId = uuidv7();
    }
    const passwordHash = found ? null : await this.hashPassword(input.password);

    await withTenant(this.db, { tenantId: invite.tenant_id, userId }, async (tx) => {
      const [already] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.userId, userId));
      if (already) throw new AppError(409, 'already_member', 'Você já faz parte desta empresa.');
      await this.limits.assertCanAdd(tx, 'users');
      if (!found) {
        await tx.insert(users).values({
          id: userId,
          name: input.name!,
          email: input.email,
          passwordHash: passwordHash!,
        });
      }
      await tx.insert(memberships).values({
        tenantId: invite.tenant_id,
        userId,
        roleId: invite.role_id,
        storeIds: invite.store_ids,
      });
      // Uso único: só marca se ninguém aceitou no mesmo instante.
      const [used] = await tx
        .update(invites)
        .set({ acceptedAt: new Date(), acceptedBy: userId })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning({ id: invites.id });
      if (!used) throw new AppError(410, 'invite_used', reasons.used);
      await this.audit.record(
        tx,
        { tenantId: invite.tenant_id, userId },
        {
          action: 'invite.accepted',
          entity: 'invite',
          entityId: invite.id,
          data: { role: invite.role_name, existingAccount: Boolean(found) },
        },
      );
    });
    return this.issueSession(invite.tenant_id, userId, userAgent);
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
    this.checkSecondFactor(found, input.totp);

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
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          verifiedAt: users.emailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, userId));
      const [t] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants);
      return [u, t] as const;
    });
    if (!user || !tenant) throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    const { verifiedAt, ...who } = user;
    return {
      user: { ...who, emailVerified: verifiedAt !== null },
      tenant,
      permissions,
      tenants: await this.userTenants(userId),
    };
  }

  /**
   * A supervisor approves a sensitive register action (discount above the limit, cancel,
   * cash withdrawal) by typing their own credentials on the operator's screen.
   */
  async authorize(tenantId: string, email: string, password: string, permission: string) {
    const found = await this.findUserByEmail(email);
    const valid = await verify(found?.password_hash ?? (await this.dummyHash), password);
    // 422, não 401: a senha errada é de outra pessoa; quem está logado continua logado.
    if (!found || !valid) throw new AppError(422, 'invalid_login', INVALID_LOGIN);
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

  /** Operador que entra no caixa (F2-03): senha certa, membro ativo e com permissão de vender. */
  async operator(tenantId: string, email: string, password: string) {
    const found = await this.findUserByEmail(email);
    const valid = await verify(found?.password_hash ?? (await this.dummyHash), password);
    // 422, não 401: a senha errada é de outra pessoa; quem está logado continua logado.
    if (!found || !valid) throw new AppError(422, 'invalid_login', INVALID_LOGIN);
    const permissions = await withTenant(this.db, { tenantId, userId: found.id }, async (tx) => {
      const [row] = await tx
        .select({ permissions: roles.permissions, active: memberships.active })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(eq(memberships.userId, found.id));
      return row?.active ? row.permissions : null;
    });
    if (!permissions?.includes('pos.sell')) {
      throw new AppError(403, 'forbidden', 'Esta pessoa não pode vender no caixa desta empresa.');
    }
    return { userId: found.id, name: found.name, permissions };
  }

  /**
   * Recuperar senha (P-04.b): manda o link de uso único (1 hora) para o e-mail, se ele existir. A
   * resposta é sempre a mesma, para não revelar quais e-mails têm conta.
   */
  async forgotPassword(email: string) {
    if (!this.mail.enabled) {
      throw new AppError(
        503,
        'email_disabled',
        'O envio de e-mail ainda não está ligado. Fale com o suporte do Bipaê.',
      );
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60_000);
    const [person] = await asApp(this.db, async (tx) =>
      rowsOf<{ user_id: string; name: string; email: string }>(
        await tx.execute(
          sql`select * from auth_password_reset_issue(${email}, ${tokenHash}, ${expires})`,
        ),
      ),
    );
    if (person) {
      await this.mail.send({
        to: person.email,
        subject: 'Bipaê: crie uma senha nova',
        ...mailBody({
          greeting: `Olá, ${person.name.split(' ')[0]}!`,
          paragraphs: [
            'Recebemos um pedido para criar uma senha nova para a sua conta no Bipaê.',
            'O link vale por 1 hora e só pode ser usado uma vez. Se não foi você, ignore este e-mail: a sua senha continua a mesma.',
          ],
          action: {
            label: 'Criar senha nova',
            url: this.mail.link(`/redefinir-senha?codigo=${token}`),
          },
        }),
      });
    }
    return {
      message:
        'Se o e-mail tiver conta no Bipaê, o link chega em instantes. Confira também a caixa de spam.',
    };
  }

  /** Manda o link de confirmação do e-mail (P-04.c), válido por 7 dias. Sem e-mail ligado, nada. */
  async sendEmailVerification(person: { id: string; name: string; email: string }) {
    if (!this.mail.enabled) return false;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    await asApp(this.db, (tx) =>
      tx.execute(sql`select auth_email_verification_issue(${person.id}, ${tokenHash}, ${expires})`),
    );
    return this.mail.send({
      to: person.email,
      subject: 'Bipaê: confirme o seu e-mail',
      ...mailBody({
        greeting: `Olá, ${person.name.split(' ')[0]}!`,
        paragraphs: [
          'Que bom ter você no Bipaê. Confirme que este e-mail é seu: é por ele que mandamos os avisos da conta e o link para criar uma senha nova, se precisar.',
          'O link vale por 7 dias.',
        ],
        action: {
          label: 'Confirmar o e-mail',
          url: this.mail.link(`/confirmar-email?codigo=${token}`),
        },
      }),
    });
  }

  /** Reenviar o link para quem está logado e ainda não confirmou. */
  async resendEmailVerification(tenantId: string, userId: string) {
    if (!this.mail.enabled) {
      throw new AppError(
        503,
        'email_disabled',
        'O envio de e-mail ainda não está ligado. Fale com o suporte do Bipaê.',
      );
    }
    const me = await this.me(tenantId, userId, []);
    if (me.user.emailVerified) return { message: 'Este e-mail já está confirmado.' };
    await this.sendEmailVerification(me.user);
    return { message: `Mandamos o link para ${me.user.email}. Confira também a caixa de spam.` };
  }

  async verifyEmail(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [done] = await asApp(this.db, async (tx) =>
      rowsOf<{ user_id: string }>(
        await tx.execute(sql`select * from auth_email_verification_consume(${tokenHash})`),
      ),
    );
    if (!done) {
      throw new AppError(
        400,
        'invalid_verification',
        'Este link expirou ou já foi usado. Peça outro na retaguarda.',
      );
    }
    return { message: 'E-mail confirmado. Obrigado!' };
  }

  /** Usa o link: troca a senha e encerra as sessões abertas em todos os aparelhos. */
  async resetPassword(token: string, password: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const passwordHash = await this.hashPassword(password);
    const [done] = await asApp(this.db, async (tx) =>
      rowsOf<{ user_id: string }>(
        await tx.execute(
          sql`select * from auth_password_reset_consume(${tokenHash}, ${passwordHash})`,
        ),
      ),
    );
    if (!done) {
      throw new AppError(
        400,
        'invalid_reset',
        'Este link expirou ou já foi usado. Peça outro em "Esqueci a senha".',
      );
    }
    return { message: 'Senha nova criada. Entre com ela.' };
  }

  async findUserByEmail(email: string) {
    return asApp(this.db, async (tx) => {
      const result = await tx.execute(sql`select * from auth_find_user(${email})`);
      return rowsOf<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        totp_secret: string | null;
        totp_enabled: boolean;
      }>(result)[0];
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
