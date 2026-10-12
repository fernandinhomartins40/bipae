import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, TERMINAL_HEADER, type Permission } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { withTenant, type Db } from '../db/client';
import { memberships, roles } from '../db/schema';
import { DB } from './di';
import { AppError, forbidden } from './errors';
import { TokenService } from './tokens';

export interface RequestContext {
  tenantId: string;
  userId: string;
  permissions: string[];
  terminalId: string | null;
}

type AuthedRequest = FastifyRequest & { ctx?: RequestContext };

const PUBLIC_KEY = 'bipae:public';
const PERMISSION_KEY = 'bipae:permission';

/** Marks a route as not requiring authentication. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Requires a permission from the catalog (packages/domain/permissions). */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** Injects the authenticated request context. */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<AuthedRequest>().ctx;
  if (!ctx) throw new AppError(401, 'unauthenticated', 'Entre na sua conta para continuar.');
  return ctx;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'unauthenticated', 'Entre na sua conta para continuar.');
    }
    const claims = await this.tokens.verifyAccess(header.slice('Bearer '.length));

    // Permissions are loaded fresh on each request so revocations apply immediately.
    const permissions = await withTenant(
      this.db,
      { tenantId: claims.tid, userId: claims.sub },
      async (tx) => {
        const [row] = await tx
          .select({ permissions: roles.permissions, active: memberships.active })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .where(and(eq(memberships.userId, claims.sub), eq(memberships.tenantId, claims.tid)));
        return row?.active ? row.permissions : null;
      },
    );
    if (!permissions) {
      throw new AppError(401, 'unauthenticated', 'Seu acesso a esta empresa foi removido.');
    }

    const terminal = request.headers[TERMINAL_HEADER];
    request.ctx = {
      tenantId: claims.tid,
      userId: claims.sub,
      permissions,
      terminalId: typeof terminal === 'string' ? terminal : null,
    };

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (required && !hasPermission(permissions, required)) throw forbidden();
    return true;
  }
}
