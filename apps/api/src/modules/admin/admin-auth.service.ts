import { Inject, Injectable } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { PLATFORM_ROLE_PERMISSIONS, uuidv7, type PlatformRole } from '@bipae/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { Config } from '../../config';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { TokenService } from '../../common/tokens';
import { newTotpSecret, totpUri, verifyTotp } from '../../common/totp';
import { asPlatform, type Db } from '../../db/client';
import { adminSessions, platformAdmins, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { PlatformAuditService } from './platform-audit.service';

const INVALID = 'E-mail, senha ou código incorretos.';
const SESSION_EXPIRED = 'Sua sessão do painel expirou. Entre novamente.';

export interface AdminMe {
  user: { id: string; name: string; email: string };
  role: PlatformRole;
  permissions: string[];
  totpEnabled: boolean;
  mfaRequired: boolean;
}

export interface AdminAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  me: AdminMe;
}

@Injectable()
export class AdminAuthService {
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  async login(
    email: string,
    password: string,
    totp: string | undefined,
    meta: { ip: string; userAgent?: string },
  ) {
    const found = await this.auth.findUserByEmail(email);
    const valid = await verify(
      found?.password_hash ?? (await this.auth.hashPassword('dummy-for-timing')),
      password,
    );
    const staff = found
      ? (
          await asPlatform(this.db, (tx) =>
            tx.select().from(platformAdmins).where(eq(platformAdmins.userId, found.id)),
          )
        )[0]
      : undefined;

    const fail = async (code: string, message = INVALID) => {
      await asPlatform(this.db, (tx) =>
        this.audit.record(
          tx,
          { userId: found?.id ?? null, ip: meta.ip },
          {
            action: 'admin.login_failed',
            data: { email, reason: code },
          },
        ),
      );
      throw new AppError(401, code, message);
    };

    if (!found || !valid || !staff?.active) return fail('invalid_login');
    if (staff.totpEnabled) {
      if (!totp)
        throw new AppError(
          401,
          'totp_required',
          'Digite o código de 6 dígitos do seu aplicativo autenticador.',
        );
      if (!verifyTotp(this.box.open(staff.totpSecret!), totp))
        return fail('totp_invalid', 'Código de verificação incorreto.');
    }
    await asPlatform(this.db, (tx) =>
      this.audit.record(
        tx,
        { userId: found.id, ip: meta.ip },
        { action: 'admin.login', data: { mfa: staff.totpEnabled } },
      ),
    );
    return this.issue(found.id, staff.totpEnabled, meta);
  }

  async refresh(token: string, meta: { ip: string; userAgent?: string }) {
    const [scope, sessionId, secret, ...rest] = token.split('.');
    if (scope !== 'adm' || !sessionId || !secret || rest.length)
      throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    const session = await asPlatform(this.db, async (tx) => {
      const [row] = await tx.select().from(adminSessions).where(eq(adminSessions.id, sessionId));
      if (!row || !this.tokens.secretMatches(secret, row.tokenHash)) return null;
      if (row.revokedAt) {
        // Reuse of a rotated token: revoke every open session of this staff member.
        await tx
          .update(adminSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(adminSessions.userId, row.userId), isNull(adminSessions.revokedAt)));
        return null;
      }
      if (row.expiresAt.getTime() < Date.now()) return null;
      await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.id, row.id));
      return row;
    });
    if (!session) throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
    const [staff] = await asPlatform(this.db, (tx) =>
      tx.select().from(platformAdmins).where(eq(platformAdmins.userId, session.userId)),
    );
    if (!staff?.active)
      throw new AppError(401, 'unauthenticated', 'Seu acesso ao painel foi removido.');
    return this.issue(session.userId, staff.totpEnabled, meta);
  }

  async logout(token: string) {
    const [, sessionId] = token.split('.');
    if (!sessionId) return;
    await asPlatform(this.db, (tx) =>
      tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.id, sessionId)),
    );
  }

  async me(userId: string): Promise<AdminMe> {
    return asPlatform(this.db, async (tx) => {
      const [row] = await tx
        .select({
          user: { id: users.id, name: users.name, email: users.email },
          staff: platformAdmins,
        })
        .from(platformAdmins)
        .innerJoin(users, eq(users.id, platformAdmins.userId))
        .where(eq(platformAdmins.userId, userId));
      if (!row) throw new AppError(401, 'unauthenticated', SESSION_EXPIRED);
      return {
        user: row.user,
        role: row.staff.role,
        permissions: PLATFORM_ROLE_PERMISSIONS[row.staff.role],
        totpEnabled: row.staff.totpEnabled,
        mfaRequired: this.config.PLATFORM_REQUIRE_TOTP,
      };
    });
  }

  /** Step 1 of 2FA: a new secret (not active until confirmed with a code). */
  async totpSetup(userId: string, ip: string) {
    const me = await this.me(userId);
    if (me.totpEnabled)
      throw new AppError(409, 'conflict', 'A verificação em duas etapas já está ativa.');
    const secret = newTotpSecret();
    await asPlatform(this.db, (tx) =>
      tx
        .update(platformAdmins)
        .set({ totpSecret: this.box.seal(secret), updatedAt: new Date() })
        .where(eq(platformAdmins.userId, userId)),
    );
    void ip;
    return { secret, uri: totpUri(secret, me.user.email) };
  }

  /** Step 2 of 2FA: confirm with a code; returns a new session that counts as verified. */
  async totpEnable(userId: string, code: string, meta: { ip: string; userAgent?: string }) {
    const [staff] = await asPlatform(this.db, (tx) =>
      tx.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)),
    );
    if (!staff?.totpSecret)
      throw new AppError(400, 'validation', 'Gere o código QR antes de confirmar.');
    if (staff.totpEnabled)
      throw new AppError(409, 'conflict', 'A verificação em duas etapas já está ativa.');
    if (!verifyTotp(this.box.open(staff.totpSecret), code)) {
      throw new AppError(
        400,
        'totp_invalid',
        'Código incorreto. Confira a hora do celular e tente o código atual.',
      );
    }
    await asPlatform(this.db, async (tx) => {
      await tx
        .update(platformAdmins)
        .set({ totpEnabled: true, updatedAt: new Date() })
        .where(eq(platformAdmins.userId, userId));
      await this.audit.record(tx, { userId, ip: meta.ip }, { action: 'admin.totp_enabled' });
    });
    return this.issue(userId, true, meta);
  }

  private async issue(
    userId: string,
    mfa: boolean,
    meta: { ip: string; userAgent?: string },
  ): Promise<AdminAuthResult> {
    const sessionId = uuidv7();
    const secret = this.tokens.newRefreshSecret();
    await asPlatform(this.db, (tx) =>
      tx.insert(adminSessions).values({
        id: sessionId,
        userId,
        tokenHash: this.tokens.hashSecret(secret),
        userAgent: meta.userAgent?.slice(0, 200) ?? null,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + this.config.ADMIN_SESSION_HOURS * 3_600_000),
      }),
    );
    return {
      accessToken: await this.tokens.signAdmin({ sub: userId, mfa }),
      refreshToken: `adm.${sessionId}.${secret}`,
      expiresIn: this.config.ADMIN_ACCESS_TTL_SECONDS,
      me: await this.me(userId),
    };
  }
}
