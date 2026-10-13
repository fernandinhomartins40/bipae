import { Inject, Injectable } from '@nestjs/common';
import {
  allocateNfceSeries,
  companyInput,
  storeInput,
  storeUpdateInput,
  terminalInput,
  uuidv7,
  type Terminal,
} from '@bipae/domain';
import { asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { companies, priceTables, stores, terminals } from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';

function toTerminal(row: typeof terminals.$inferSelect): Terminal {
  return {
    id: row.id,
    storeId: row.storeId,
    name: row.name,
    platform: row.platform,
    nfceSeries: row.nfceSeries,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LimitsService) private readonly limits: LimitsService,
  ) {}

  listCompanies(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx.select().from(companies).orderBy(asc(companies.createdAt)),
    );
  }

  async updateCompany(ctx: RequestContext, id: string, input: z.output<typeof companyInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(companies)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(companies.id, id))
        .returning();
      if (!row) throw notFound('Empresa');
      await this.audit.record(tx, ctx, {
        action: 'company.updated',
        entity: 'company',
        entityId: id,
        data: input,
      });
      return row;
    });
  }

  async createCompany(ctx: RequestContext, input: z.output<typeof companyInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'companies');
      const [row] = await tx
        .insert(companies)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'company.created',
        entity: 'company',
        entityId: row!.id,
        data: input,
      });
      return row!;
    });
  }

  listStores(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx.select().from(stores).orderBy(asc(stores.createdAt)),
    );
  }

  async createStore(ctx: RequestContext, input: z.output<typeof storeInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'stores');
      const [row] = await tx
        .insert(stores)
        .values({ id: uuidv7(), tenantId: ctx.tenantId, ...input })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'store.created',
        entity: 'store',
        entityId: row!.id,
        data: input,
      });
      return row!;
    });
  }

  /** Rename a store or change its default price table (a price change, so it is audited). */
  async updateStore(ctx: RequestContext, id: string, input: z.output<typeof storeUpdateInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      if (input.priceTableId) {
        // FK checks ignore RLS: confirm the table belongs to this client.
        const [table] = await tx
          .select({ id: priceTables.id })
          .from(priceTables)
          .where(eq(priceTables.id, input.priceTableId));
        if (!table)
          throw new AppError(422, 'invalid_price_table', 'Tabela de preço não encontrada.');
      }
      const [row] = await tx
        .update(stores)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(stores.id, id))
        .returning();
      if (!row) throw notFound('Loja');
      await this.audit.record(tx, ctx, {
        action: 'store.updated',
        entity: 'store',
        entityId: id,
        data: input,
      });
      return row;
    });
  }

  async listTerminals(ctx: RequestContext): Promise<Terminal[]> {
    const rows = await withTenant(this.db, ctx, (tx) =>
      tx.select().from(terminals).orderBy(asc(terminals.nfceSeries)),
    );
    return rows.map(toTerminal);
  }

  /**
   * Registers a terminal and allocates its exclusive NFC-e series within the company
   * (ADR-0012 §4). A per-company advisory lock prevents two registrations racing for a series.
   */
  async createTerminal(ctx: RequestContext, input: z.output<typeof terminalInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'terminals');
      const [store] = await tx.select().from(stores).where(eq(stores.id, input.storeId));
      if (!store) throw notFound('Loja');
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'nfce-series:' + store.companyId}, 0))`,
      );
      const used = await tx
        .select({ series: terminals.nfceSeries })
        .from(terminals)
        .where(eq(terminals.companyId, store.companyId));
      const series = allocateNfceSeries(used.map((u) => u.series));
      const [row] = await tx
        .insert(terminals)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          companyId: store.companyId,
          storeId: store.id,
          name: input.name,
          platform: input.platform,
          nfceSeries: series,
        })
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'terminal.created',
        entity: 'terminal',
        entityId: row!.id,
        data: { ...input, nfceSeries: series },
      });
      return toTerminal(row!);
    });
  }

  /** Revoked terminals keep their series forever, so it is never reused. */
  async revokeTerminal(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx
        .update(terminals)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(eq(terminals.id, id))
        .returning();
      if (!row) throw notFound('Caixa');
      await this.audit.record(tx, ctx, {
        action: 'terminal.revoked',
        entity: 'terminal',
        entityId: id,
        data: { nfceSeries: row.nfceSeries },
      });
      return toTerminal(row);
    });
  }
}
