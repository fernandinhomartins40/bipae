import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@bipae/domain';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../common/di';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { platformAuditLog } from '../../db/schema';
import { auditHash, GENESIS_HASH } from '../audit/audit.service';

export interface PlatformAuditInput {
  action: string;
  tenantId?: string | null;
  target?: string | null;
  data?: unknown;
}

/**
 * Hash-chained, immutable audit of everything the Bipaê staff does (one chain for the whole
 * platform). Written in the same transaction as the action it describes.
 */
@Injectable()
export class PlatformAuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(tx: Tx, actor: { userId: string | null; ip?: string | null }, input: PlatformAuditInput) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('bipae-platform-audit', 0))`);
    const [last] = await tx
      .select({ seq: platformAuditLog.seq, hash: platformAuditLog.hash })
      .from(platformAuditLog)
      .orderBy(desc(platformAuditLog.seq))
      .limit(1);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const entry = {
      tenantId: input.tenantId ?? '',
      seq,
      action: input.action,
      entity: input.target ?? '',
      entityId: null,
      actorId: actor.userId,
      authorizedBy: null,
      data: input.data === undefined ? null : JSON.parse(JSON.stringify(input.data)),
      createdAt: new Date(),
    };
    await tx.insert(platformAuditLog).values({
      id: uuidv7(),
      seq,
      actorId: actor.userId,
      action: input.action,
      tenantId: input.tenantId ?? null,
      target: input.target ?? null,
      data: entry.data,
      ip: actor.ip ?? null,
      prevHash,
      hash: auditHash(prevHash, entry),
      createdAt: entry.createdAt,
    });
  }

  async list(filters: { tenantId?: string; actorId?: string; limit: number; offset: number }) {
    return asPlatform(this.db, async (tx) => {
      const where: SQL[] = [];
      if (filters.tenantId) where.push(eq(platformAuditLog.tenantId, filters.tenantId));
      if (filters.actorId) where.push(eq(platformAuditLog.actorId, filters.actorId));
      const condition = where.length ? and(...where) : undefined;
      const rows = await tx
        .select()
        .from(platformAuditLog)
        .where(condition)
        .orderBy(desc(platformAuditLog.seq))
        .limit(filters.limit)
        .offset(filters.offset);
      const [total] = await tx.select({ n: count() }).from(platformAuditLog).where(condition);
      return {
        items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: Number(total?.n ?? 0),
      };
    });
  }

  async verify() {
    return asPlatform(this.db, async (tx) => {
      const rows = await tx.select().from(platformAuditLog).orderBy(asc(platformAuditLog.seq));
      let prev = GENESIS_HASH;
      for (const [index, row] of rows.entries()) {
        const expected = auditHash(prev, {
          tenantId: row.tenantId ?? '',
          seq: row.seq,
          action: row.action,
          entity: row.target ?? '',
          entityId: null,
          actorId: row.actorId,
          authorizedBy: null,
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
}
