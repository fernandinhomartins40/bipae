import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { ProductPricing } from '@bipae/domain';
import { findCompanyRegime, saleTaxSummaries, type SaleFiscalProfile } from '@bipae/fiscal';
import { asc, eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { companies, companyIcmsRules, fiscalProfiles, products } from '../../db/schema';
import { toMotorRule } from '../fiscal/icms-rules.service';

/** Operação de referência: R$ 100,00. Assim cada centavo de imposto é 0,01% (1 bp) do preço. */
const REFERENCE_CENTS = 10_000;

/**
 * Formação de preço (F4-03): os impostos que a venda do produto paga, em percentual do preço,
 * calculados pelo motor fiscal com o perfil do produto e o regime da empresa. A conta do preço
 * (divisor de markup) fica na tela, com a margem e as despesas que a pessoa escolhe.
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async pricing(
    ctx: RequestContext,
    productId: string,
    companyId?: string,
  ): Promise<ProductPricing> {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    return withTenant(this.db, ctx, async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, productId));
      if (!product) throw notFound('Produto');
      const [company] = companyId
        ? await tx.select().from(companies).where(eq(companies.id, companyId))
        : await tx.select().from(companies).orderBy(asc(companies.createdAt)).limit(1);
      if (!company) throw new AppError(422, 'invalid_company', 'Empresa não encontrada.');
      const regime = company.taxRegime ? findCompanyRegime(company.taxRegime) : null;
      const [profile] = product.fiscalProfileId
        ? await tx
            .select({ data: fiscalProfiles.data })
            .from(fiscalProfiles)
            .where(eq(fiscalProfiles.id, product.fiscalProfileId))
        : [];
      const rules = (
        await tx.select().from(companyIcmsRules).where(eq(companyIcmsRules.companyId, company.id))
      ).map(toMotorRule);
      const [summary] =
        saleTaxSummaries({
          company: { uf: company.uf, taxRegime: company.taxRegime },
          items: [
            {
              operationCents: REFERENCE_CENTS,
              profile: (profile?.data as SaleFiscalProfile | undefined) ?? null,
              ncm: product.ncm,
            },
          ],
          rules,
          date: today,
        }) ?? [];

      const taxes: ProductPricing['taxes'] = [];
      const add = (label: string, cents: number | null | undefined) => {
        if (cents) taxes.push({ label, bp: cents });
      };
      const notes: string[] = [];
      if (summary) {
        add('ICMS', summary.icmsCents);
        add('FCP', summary.fcpCents);
        add('PIS', summary.pisCents);
        add('COFINS', summary.cofinsCents);
        // Em 2026 o IBS e a CBS são de teste e compensados; a partir de 2027 entram no preço.
        if (today >= '2027-01-01') {
          add('CBS', summary.cbsCents);
          add('IBS', summary.ibsCents);
        } else if (summary.cbsCents || summary.ibsCents) {
          notes.push('IBS e CBS de 2026 são de teste e compensados: não entram no preço.');
        }
      }
      const simples = regime?.pisCofins === 'das';
      if (simples) {
        notes.push(
          'No Simples Nacional os tributos estão no DAS: informe a alíquota efetiva do DAS como imposto.',
        );
      }
      return {
        productId: product.id,
        productName: product.name,
        costCents: product.costCents,
        priceCents: product.priceCents,
        companyId: company.id,
        regime: regime?.label ?? null,
        simples,
        taxes,
        taxesBp: taxes.reduce((sum, t) => sum + t.bp, 0),
        pending: summary?.pending ?? [
          'Configure a UF e o regime da empresa e o perfil fiscal do produto.',
        ],
        notes,
      };
    });
  }
}

@Controller()
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  /** Impostos da venda do produto em % do preço, para formar o preço (F4-03). */
  @Get('products/:id/pricing')
  @RequirePermission('catalog.read')
  get(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.pricing.pricing(ctx, id, companyId);
  }
}
