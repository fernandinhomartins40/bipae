import { inArray, sql, type Column, type SQL } from 'drizzle-orm';
import type { RequestContext } from './auth';
import { AppError } from './errors';

/**
 * Permissões por loja (F1-05). `ctx.storeIds` vem do vínculo da pessoa com a empresa:
 * `null` = todas as lojas; uma lista = só essas lojas.
 */
export function canUseStore(ctx: RequestContext, storeId: string): boolean {
  return !ctx.storeIds || ctx.storeIds.includes(storeId);
}

export function assertStore(ctx: RequestContext, storeId: string): void {
  if (!canUseStore(ctx, storeId)) {
    throw new AppError(403, 'store_forbidden', 'Você não tem acesso a esta loja.');
  }
}

/** Condição SQL para filtrar consultas pelas lojas da pessoa (undefined = sem filtro). */
export function storeCondition(ctx: RequestContext, column: Column): SQL | undefined {
  if (!ctx.storeIds) return undefined;
  if (ctx.storeIds.length === 0) return sql`false`;
  return inArray(column, ctx.storeIds);
}
