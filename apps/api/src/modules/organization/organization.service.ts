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
import { findCompanyRegime } from '@bipae/fiscal';
import { PDV_PAYMENT_TPAG, revenueAlerts } from '@bipae/fiscal/tables';
import { findMunicipio } from '@bipae/fiscal/tables/municipios';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { assertStore, storeCondition } from '../../common/stores';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, fiscalProfiles, priceTables, sales, stores, terminals } from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { AuditService } from '../audit/audit.service';

type CompanyInput = z.output<typeof companyInput>;

/** Município da tabela do IBGE e da UF da empresa; Pix e vale só com códigos da tabela (D-029). */
function assertCompanyFiscal(input: CompanyInput, uf: string | null | undefined) {
  if (input.cityCode) {
    const city = findMunicipio(input.cityCode);
    if (!city)
      throw new AppError(422, 'invalid_city', 'Município não encontrado na tabela do IBGE.');
    if (uf && city.uf !== uf) {
      throw new AppError(
        422,
        'invalid_city',
        `${city.name} não fica em ${uf}: confira a UF ou o município.`,
      );
    }
  }
  for (const [method, code] of Object.entries(input.nfcePaymentCodes ?? {})) {
    const rule = PDV_PAYMENT_TPAG[method];
    if (!rule || !(rule.options ?? [rule.code]).includes(code)) {
      throw new AppError(422, 'invalid_payment_code', `Código ${code} não vale para ${method}.`);
    }
  }
}

/** O perfil fiscal da venda condicional é desta empresa (D-033). */
async function assertDemonstrationProfile(tx: Tx, input: CompanyInput) {
  if (!input.demonstrationProfileId) return;
  const [profile] = await tx
    .select({ id: fiscalProfiles.id })
    .from(fiscalProfiles)
    .where(eq(fiscalProfiles.id, input.demonstrationProfileId));
  if (!profile) throw notFound('Perfil fiscal');
}

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

  /**
   * Receita do ano da empresa (vendas menos devoluções registradas no Bipaê, no fuso de Brasília)
   * e os avisos dos limites do regime (F3-29): MEI, teto do Simples e sublimite do ICMS e do ISS.
   */
  async revenue(ctx: RequestContext, id: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    const year = today.slice(0, 4);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, id));
      if (!company) throw notFound('Empresa');
      const [row] = await tx
        .select({
          cents: sql<string>`coalesce(sum(case when ${sales.kind} = 'return' then -${sales.totalCents} else ${sales.totalCents} end), 0)::text`,
        })
        .from(sales)
        .innerJoin(stores, eq(stores.id, sales.storeId))
        .where(
          and(
            eq(stores.companyId, id),
            eq(sales.status, 'completed'),
            sql`to_char(${sales.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY') = ${year}`,
          ),
        );
      const yearRevenueCents = Number(row?.cents ?? 0);
      const regime = company.taxRegime ? findCompanyRegime(company.taxRegime) : null;
      return {
        year: Number(year),
        yearRevenueCents,
        alerts: regime ? revenueAlerts({ regime: regime.id, yearRevenueCents, date: today }) : [],
        note: 'Conta só as vendas registradas no Bipaê neste ano. Se a empresa vende por outros canais, o contador soma o resto.',
      };
    });
  }

  async updateCompany(ctx: RequestContext, id: string, input: z.output<typeof companyInput>) {
    return withTenant(this.db, ctx, async (tx) => {
      const [current] = await tx
        .select({ uf: companies.uf })
        .from(companies)
        .where(eq(companies.id, id));
      assertCompanyFiscal(input, input.uf ?? current?.uf);
      await assertDemonstrationProfile(tx, input);
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
    assertCompanyFiscal(input, input.uf);
    return withTenant(this.db, ctx, async (tx) => {
      await this.limits.assertCanAdd(tx, 'companies');
      await assertDemonstrationProfile(tx, input);
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
      tx.select().from(stores).where(storeCondition(ctx, stores.id)).orderBy(asc(stores.createdAt)),
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
      tx
        .select()
        .from(terminals)
        .where(storeCondition(ctx, terminals.storeId))
        .orderBy(asc(terminals.nfceSeries)),
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
      assertStore(ctx, input.storeId);
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
