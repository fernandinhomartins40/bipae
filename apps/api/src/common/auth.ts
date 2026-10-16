import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { accountAccess, hasPermission, TERMINAL_HEADER, type Permission } from '@bipae/domain';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { withTenant, type Db } from '../db/client';
import { apiKeys, memberships, roles, tenants, terminals } from '../db/schema';
import { apiKeyTenant, hashApiKey, isApiKey } from './api-keys';
import { DB } from './di';
import { AppError, forbidden } from './errors';
import { TokenService } from './tokens';

export interface RequestContext {
  tenantId: string;
  userId: string;
  permissions: string[];
  terminalId: string | null;
  /** Lojas que a pessoa pode usar (F1-05); null = todas. */
  storeIds: string[] | null;
  /** Bipaê staff member acting as this client (support session); recorded in the audit. */
  impersonatedBy?: string;
  /** Read-only support session: every change is refused. */
  readOnly?: boolean;
  /** Pedido feito com chave da API pública (ADR-0016): fica marcado na auditoria. */
  apiKeyId?: string;
}

/** Routes a blocked account (suspended, cancelled, expired trial) may still use. */
const ALLOWED_WHEN_BLOCKED = ['/v1/sync/events', '/v1/auth/me', '/v1/account'];

type AuthedRequest = FastifyRequest & { ctx?: RequestContext };

const PUBLIC_KEY = 'bipae:public';
const PERMISSION_KEY = 'bipae:permission';
const PUBLIC_API_KEY = 'bipae:public-api';

/** Marks a route as not requiring authentication. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Rota da API pública (ADR-0016): a única que aceita chave de API, além do login normal. */
export const PublicApi = () => SetMetadata(PUBLIC_API_KEY, true);

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
    const bearer = header.slice('Bearer '.length);
    if (isApiKey(bearer)) return this.withApiKey(request, bearer, targets);
    const claims = await this.tokens.verifyAccess(bearer);

    // Permissions and account status are loaded fresh on each request, so revocations and
    // suspensions apply immediately.
    const found = await withTenant(
      this.db,
      { tenantId: claims.tid, userId: claims.sub },
      async (tx) => {
        const [row] = await tx
          .select({
            permissions: roles.permissions,
            active: memberships.active,
            storeIds: memberships.storeIds,
          })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .where(and(eq(memberships.userId, claims.sub), eq(memberships.tenantId, claims.tid)));
        const [tenant] = await tx
          .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
          .from(tenants);
        // Pedido vindo de um caixa: a loja do caixa precisa estar entre as lojas da pessoa.
        const terminalHeader = request.headers[TERMINAL_HEADER];
        let terminalStore: string | null = null;
        if (
          row?.storeIds &&
          typeof terminalHeader === 'string' &&
          /^[0-9a-f-]{36}$/i.test(terminalHeader)
        ) {
          const [t] = await tx
            .select({ storeId: terminals.storeId })
            .from(terminals)
            .where(eq(terminals.id, terminalHeader));
          terminalStore = t?.storeId ?? null;
        }
        return {
          permissions: row?.active ? row.permissions : null,
          storeIds: row?.storeIds ?? null,
          terminalStore,
          tenant,
        };
      },
    );
    const permissions = found.permissions;
    if (!permissions || !found.tenant) {
      throw new AppError(401, 'unauthenticated', 'Seu acesso a esta empresa foi removido.');
    }

    const path = request.url.split('?')[0] ?? '';
    const access = accountAccess(found.tenant.status, found.tenant.trialEndsAt);
    if (
      !access.allowed &&
      !ALLOWED_WHEN_BLOCKED.some((p) => path === p || path.startsWith(`${p}/`))
    ) {
      throw new AppError(403, `account_${access.code}`, access.message!);
    }
    if (claims.ro && request.method !== 'GET') {
      throw new AppError(
        403,
        'read_only',
        'Acesso de suporte somente leitura: nada pode ser alterado.',
      );
    }

    if (found.storeIds && found.terminalStore && !found.storeIds.includes(found.terminalStore)) {
      throw new AppError(
        403,
        'store_forbidden',
        'Este caixa é de uma loja que você não tem acesso.',
      );
    }

    const terminal = request.headers[TERMINAL_HEADER];
    request.ctx = {
      tenantId: claims.tid,
      userId: claims.sub,
      permissions,
      terminalId: typeof terminal === 'string' ? terminal : null,
      storeIds: found.storeIds,
      ...(claims.imp && { impersonatedBy: claims.imp }),
      ...(claims.ro && { readOnly: true }),
    };

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (required && !hasPermission(permissions, required)) throw forbidden();
    return true;
  }

  /**
   * Chave da API pública (ADR-0016). Só vale em rota marcada com @PublicApi(). A chave nunca
   * tem mais poder do que quem a criou: valem os escopos que essa pessoa ainda tem.
   */
  private async withApiKey(
    request: AuthedRequest,
    key: string,
    targets: Parameters<Reflector['getAllAndOverride']>[1],
  ): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(PUBLIC_API_KEY, targets)) {
      throw new AppError(
        403,
        'api_key_route',
        'Esta rota não faz parte da API pública do Bipaê. As rotas estão em /v1/public/openapi.json.',
      );
    }
    const invalid = () =>
      new AppError(401, 'invalid_api_key', 'Chave de API inválida ou revogada.');
    const tenantId = apiKeyTenant(key);
    if (!tenantId) throw invalid();
    const found = await withTenant(this.db, { tenantId }, async (tx) => {
      const [k] = await tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, hashApiKey(key)));
      if (!k || k.revokedAt) return null;
      const [member] = await tx
        .select({
          permissions: roles.permissions,
          active: memberships.active,
          storeIds: memberships.storeIds,
        })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.userId, k.createdBy), eq(memberships.tenantId, tenantId)));
      const [tenant] = await tx
        .select({ status: tenants.status, trialEndsAt: tenants.trialEndsAt })
        .from(tenants);
      const now = new Date();
      // Último uso, sem escrever a cada pedido: no máximo uma vez por minuto.
      if (!k.lastUsedAt || now.getTime() - k.lastUsedAt.getTime() > 60_000) {
        await tx.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, k.id));
      }
      return { k, member, tenant };
    });
    if (!found?.member?.active || !found.tenant) throw invalid();
    const access = accountAccess(found.tenant.status, found.tenant.trialEndsAt);
    if (!access.allowed) throw new AppError(403, `account_${access.code}`, access.message!);
    const permissions = found.k.scopes.filter((s) => found.member!.permissions.includes(s));
    request.ctx = {
      tenantId,
      userId: found.k.createdBy,
      permissions,
      terminalId: null,
      storeIds: found.member.storeIds,
      apiKeyId: found.k.id,
    };
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (required && !hasPermission(permissions, required)) throw forbidden();
    return true;
  }
}
