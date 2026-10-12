import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { platformCan, type PlatformPermission as Permission, type PlatformRole } from '@bipae/domain';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { CONFIG, DB } from '../../common/di';
import { AppError } from '../../common/errors';
import { TokenService } from '../../common/tokens';
import { asPlatform, type Db } from '../../db/client';
import { platformAdmins } from '../../db/schema';

export interface AdminContext {
  userId: string;
  role: PlatformRole;
  mfa: boolean;
  ip: string;
}

type AdminRequest = FastifyRequest & { admin?: AdminContext };

const PERMISSION_KEY = 'bipae:platform-permission';
const WITHOUT_MFA_KEY = 'bipae:platform-without-mfa';

export const PlatformPermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/** Only the 2FA setup routes may be used before the second factor is enabled. */
export const AllowWithoutMfa = () => SetMetadata(WITHOUT_MFA_KEY, true);

export const Admin = createParamDecorator((_: unknown, host: ExecutionContext): AdminContext => {
  const admin = host.switchToHttp().getRequest<AdminRequest>().admin;
  if (!admin) throw new AppError(401, 'unauthenticated', 'Entre no painel para continuar.');
  return admin;
});

/**
 * Guards the super admin panel. Staff tokens have their own audience (client tokens never
 * pass here), the staff record is checked on every request (deactivation is immediate) and,
 * in production, nothing works until the second factor (TOTP) is enabled.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'unauthenticated', 'Entre no painel para continuar.');
    }
    const claims = await this.tokens.verifyAdmin(header.slice('Bearer '.length));
    const [staff] = await asPlatform(this.db, (tx) =>
      tx.select().from(platformAdmins).where(eq(platformAdmins.userId, claims.sub)),
    );
    if (!staff?.active) throw new AppError(401, 'unauthenticated', 'Seu acesso ao painel foi removido.');

    const targets = [context.getHandler(), context.getClass()];
    const withoutMfa = this.reflector.getAllAndOverride<boolean>(WITHOUT_MFA_KEY, targets);
    if (this.config.PLATFORM_REQUIRE_TOTP && !claims.mfa && !withoutMfa) {
      throw new AppError(
        403,
        'mfa_required',
        'Ative a verificação em duas etapas para usar o painel. Ela protege os dados de todos os clientes.',
      );
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, targets);
    if (required && !platformCan(staff.role, required)) {
      throw new AppError(403, 'forbidden', 'Seu papel na equipe Bipaê não permite esta ação.');
    }
    request.admin = { userId: staff.userId, role: staff.role, mfa: claims.mfa, ip: request.ip };
    return true;
  }
}
