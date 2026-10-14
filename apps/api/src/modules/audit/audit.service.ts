import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type AuditEntry, type Page } from '@bipae/domain';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { withTenant, type Db, type Tx } from '../../db/client';
import { auditLog } from '../../db/schema';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  data?: unknown;
  /** Who approved a sensitive action on behalf of the actor (e.g. manager PIN). */
  authorizedBy?: string | null;
}

/** During a Bipaê support session, every audited action carries who really did it. */
function withSupportMark(data: unknown, impersonatedBy: string | undefined) {
  const plain = data === undefined ? null : JSON.parse(JSON.stringify(data));
  if (!impersonatedBy) return plain;
  return {
    ...(plain && typeof plain === 'object' ? plain : { value: plain }),
    suporteBipae: impersonatedBy,
  };
}

/** Deterministic JSON (sorted keys) so hashes are reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function auditHash(
  prevHash: string,
  entry: {
    tenantId: string;
    seq: number;
    action: string;
    entity: string;
    entityId: string | null;
    actorId: string | null;
    authorizedBy: string | null;
    data: unknown;
    createdAt: Date;
  },
): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(entry)).digest('hex');
}

/**
 * Immutable, hash-chained audit trail per tenant (ADR-0010). Entries are written in the same
 * transaction as the change they describe, so an action and its audit record commit together.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    tx: Tx,
    ctx: Pick<RequestContext, 'tenantId' | 'userId' | 'impersonatedBy'>,
    input: AuditInput,
  ) {
    // Serializes writers per tenant so sequence numbers and the hash chain never fork.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId}, 0))`);
    const [last] = await tx
      .select({ seq: auditLog.seq, hash: auditLog.hash })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const entry = {
      tenantId: ctx.tenantId,
      seq,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      actorId: ctx.userId,
      authorizedBy: input.authorizedBy ?? null,
      data: withSupportMark(input.data, ctx.impersonatedBy),
      createdAt: new Date(),
    };
    await tx.insert(auditLog).values({
      id: uuidv7(),
      ...entry,
      prevHash,
      hash: auditHash(prevHash, entry),
    });
  }

  async list(ctx: RequestContext, limit: number, offset: number): Promise<Page<AuditEntry>> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.seq))
        .limit(limit)
        .offset(offset);
      const [total] = await tx.select({ n: count() }).from(auditLog);
      return {
        items: rows.map((r) => ({
          id: r.id,
          seq: r.seq,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          actorId: r.actorId,
          authorizedBy: r.authorizedBy,
          data: r.data,
          hash: r.hash,
          createdAt: r.createdAt.toISOString(),
        })),
        total: total?.n ?? 0,
      };
    });
  }

  /** Recomputes the whole chain. Returns the first broken sequence number, if any. */
  async verify(ctx: Pick<RequestContext, 'tenantId' | 'userId'>) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx.select().from(auditLog).orderBy(asc(auditLog.seq));
      let prev = GENESIS_HASH;
      for (const [index, row] of rows.entries()) {
        const expected = auditHash(prev, {
          tenantId: row.tenantId,
          seq: row.seq,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          actorId: row.actorId,
          authorizedBy: row.authorizedBy,
          data: row.data,
          createdAt: row.createdAt,
        });
        if (row.seq !== index + 1 || row.prevHash !== prev || row.hash !== expected) {
          return { valid: false as const, brokenAt: row.seq, entries: rows.length };
        }
        prev = row.hash;
      }
      return { valid: true as const, brokenAt: null, entries: rows.length };
    });
  }

  /** Used by tests and admin tooling to check an entry belongs to the tenant. */
  async findByEntity(ctx: RequestContext, entity: string, entityId: string) {
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))
        .orderBy(asc(auditLog.seq)),
    );
  }
}
