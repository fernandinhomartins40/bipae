import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type CompanyIcmsRuleRow, type companyIcmsRuleInput } from '@bipae/domain';
import { checkCompanyIcmsRules, type CompanyIcmsEffect, type CompanyIcmsRule } from '@bipae/fiscal';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, companyIcmsRules } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

type Input = z.output<typeof companyIcmsRuleInput>;
type Row = typeof companyIcmsRules.$inferSelect;

const effectOf = (input: Input): CompanyIcmsEffect => ({
  ...(input.rate && { rate: input.rate }),
  ...(input.baseReduction && { baseReduction: input.baseReduction }),
  ...(input.fcpRate && { fcpRate: input.fcpRate }),
  ...(input.benefitCode && { benefitCode: input.benefitCode }),
  ...(input.st && {
    st: {
      mva: input.st.mva,
      rate: input.st.rate,
      ...(input.st.baseReduction && { baseReduction: input.st.baseReduction }),
    },
  }),
});

/** A linha do banco no formato do motor fiscal. */
export const toMotorRule = (row: Row): CompanyIcmsRule => ({
  id: row.id,
  name: row.name,
  ncm: row.ncm,
  validity: { start: row.validFrom, ...(row.validTo && { end: row.validTo }) },
  effect: row.effect as CompanyIcmsEffect,
  source: row.source,
});

const view = (row: Row): CompanyIcmsRuleRow => ({
  id: row.id,
  companyId: row.companyId,
  name: row.name,
  ncm: row.ncm,
  validFrom: row.validFrom,
  validTo: row.validTo,
  effect: row.effect as CompanyIcmsRuleRow['effect'],
  source: row.source,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Regras de ICMS próprias da empresa (F3-06.e). Alterar regra fiscal é ação sensível: toda
 * mudança vai para a trilha de auditoria. A tabela inteira da empresa é conferida a cada
 * gravação, para nunca existirem duas regras valendo para o mesmo NCM no mesmo período.
 */
@Injectable()
export class IcmsRulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext, companyId?: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(companyIcmsRules)
        .where(companyId ? eq(companyIcmsRules.companyId, companyId) : undefined)
        .orderBy(asc(companyIcmsRules.name));
      return rows.map(view);
    });
  }

  save(ctx: RequestContext, id: string | null, input: Input) {
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, input.companyId));
      if (!company) throw notFound('Empresa');
      const values = {
        companyId: input.companyId,
        name: input.name,
        ncm: [...new Set(input.ncm)],
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        effect: effectOf(input),
        source: input.source,
      };
      let before: Row | undefined;
      if (id) {
        [before] = await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.id, id));
        if (!before) throw notFound('Regra de ICMS');
        await tx
          .update(companyIcmsRules)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(companyIcmsRules.id, id));
      } else {
        id = uuidv7();
        await tx.insert(companyIcmsRules).values({ id, tenantId: ctx.tenantId, ...values });
      }
      await this.assertConsistent(tx, input.companyId);
      if (before && before.companyId !== input.companyId)
        await this.assertConsistent(tx, before.companyId);
      await this.audit.record(tx, ctx, {
        action: before ? 'fiscal_rule.updated' : 'fiscal_rule.created',
        entity: 'company_icms_rule',
        entityId: id,
        data: before ? { before: view(before), after: values } : values,
      });
      const [row] = await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.id, id));
      return view(row!);
    });
  }

  remove(ctx: RequestContext, id: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.id, id));
      if (!row) throw notFound('Regra de ICMS');
      await tx.delete(companyIcmsRules).where(eq(companyIcmsRules.id, id));
      await this.audit.record(tx, ctx, {
        action: 'fiscal_rule.deleted',
        entity: 'company_icms_rule',
        entityId: id,
        data: view(row),
      });
      return { ok: true };
    });
  }

  private async assertConsistent(tx: Tx, companyId: string) {
    const rows = await tx
      .select()
      .from(companyIcmsRules)
      .where(eq(companyIcmsRules.companyId, companyId));
    const problems = checkCompanyIcmsRules(rows.map(toMotorRule));
    if (problems.length > 0) {
      throw new AppError(
        400,
        'validation',
        problems[0]!,
        problems.map((message) => ({ path: 'ncm', message })),
      );
    }
  }
}
