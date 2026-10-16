import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { apiKeyInput, uuidv7, type ApiKeyCreated, type ApiKeyView } from '@bipae/domain';
import { desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { generateApiKey } from '../../common/api-keys';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { apiKeys, tenants, users } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Chaves da API pública (F6-01.a, ADR-0016): o dono cria, vê e revoga. */
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async views(tx: Tx, rows: (typeof apiKeys.$inferSelect)[]): Promise<ApiKeyView[]> {
    const people = rows.length
      ? await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...new Set(rows.map((r) => r.createdBy))]))
      : [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.keyPrefix,
      scopes: r.scopes,
      createdByName: people.find((p) => p.id === r.createdBy)?.name ?? 'Usuário',
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
  }

  list(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) =>
      this.views(tx, await tx.select().from(apiKeys).orderBy(desc(apiKeys.createdAt))),
    );
  }

  async create(ctx: RequestContext, input: z.output<typeof apiKeyInput>): Promise<ApiKeyCreated> {
    // Ninguém cria chave com permissão que não tem.
    const missing = input.scopes.filter((s) => !ctx.permissions.includes(s));
    if (missing.length > 0) {
      throw new AppError(
        403,
        'forbidden_scope',
        'Você não pode dar à chave uma permissão que não tem.',
      );
    }
    return withTenant(this.db, ctx, async (tx) => {
      const { key, prefix, hash } = generateApiKey(ctx.tenantId);
      const [row] = await tx
        .insert(apiKeys)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          name: input.name,
          keyPrefix: prefix,
          keyHash: hash,
          scopes: input.scopes,
          createdBy: ctx.userId,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'api_key.created',
        entity: 'api_key',
        entityId: row!.id,
        data: { name: input.name, prefix, scopes: input.scopes },
      });
      return { ...(await this.views(tx, [row!]))[0]!, key };
    });
  }

  async revoke(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, id));
      if (!row) throw notFound('Chave');
      if (row.revokedAt) return (await this.views(tx, [row]))[0]!;
      const [updated] = await tx
        .update(apiKeys)
        .set({ revokedAt: new Date(), revokedBy: ctx.userId })
        .where(eq(apiKeys.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'api_key.revoked',
        entity: 'api_key',
        entityId: id,
        data: { name: row.name, prefix: row.keyPrefix },
      });
      return (await this.views(tx, [updated!]))[0]!;
    });
  }

  /** Para o parceiro conferir a chave: de quem é e o que ela pode. */
  me(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants);
      const [key] = ctx.apiKeyId
        ? await tx.select({ name: apiKeys.name }).from(apiKeys).where(eq(apiKeys.id, ctx.apiKeyId))
        : [];
      return {
        tenantId: ctx.tenantId,
        tenantName: tenant?.name ?? null,
        apiKey: ctx.apiKeyId ? { id: ctx.apiKeyId, name: key?.name ?? null } : null,
        scopes: ctx.permissions,
      };
    });
  }
}

@Controller('api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('admin.integrations')
  list(@Ctx() ctx: RequestContext) {
    return this.keys.list(ctx);
  }

  @Post()
  @RequirePermission('admin.integrations')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.keys.create(ctx, parse(apiKeyInput, body));
  }

  @Post(':id/revoke')
  @RequirePermission('admin.integrations')
  revoke(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.keys.revoke(ctx, id);
  }
}
