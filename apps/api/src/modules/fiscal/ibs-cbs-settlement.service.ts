import { Controller, Get, Inject, Injectable, Query } from '@nestjs/common';
import type { IbsCbsSettlementView } from '@bipae/domain';
import type { CompanyRegime } from '@bipae/fiscal';
import { settleIbsCbs, type IbsCbsTotals } from '@bipae/fiscal/tables';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { companies, saleItems, sales, stores } from '../../db/schema';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** a × b ÷ c com arredondamento meio para cima, em inteiros (valores não negativos). */
function proportion(a: number, b: number, c: number): number {
  return Number((BigInt(a) * BigInt(b) * 2n + BigInt(c)) / (BigInt(c) * 2n));
}

/**
 * Apuração gerencial do IBS e da CBS (F4-13) de uma empresa (CNPJ) no mês: débitos destacados
 * nas vendas, menos as devoluções, contra os créditos destacados nas notas de compra
 * autorizadas. As regras (quem apura, crédito separado, 2026 em teste) vêm da tabela fiscal.
 */
@Injectable()
export class IbsCbsSettlementService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async settle(
    ctx: RequestContext,
    companyId: string,
    month: string,
  ): Promise<IbsCbsSettlementView> {
    if (ctx.storeIds) {
      throw new AppError(
        403,
        'store_forbidden',
        'A apuração é da empresa inteira: só quem acessa todas as lojas pode ver.',
      );
    }
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa');
      const storeIds = (
        await tx.select({ id: stores.id }).from(stores).where(eq(stores.companyId, companyId))
      ).map((s) => s.id);
      const inMonth = (column: unknown) =>
        sql`to_char(${column} at time zone 'America/Sao_Paulo', 'YYYY-MM') = ${month}`;

      const [sold] = storeIds.length
        ? await tx
            .select({
              ibs: sql<string>`coalesce(sum((${saleItems.taxes}->>'ibsCents')::bigint), 0)::text`,
              cbs: sql<string>`coalesce(sum((${saleItems.taxes}->>'cbsCents')::bigint), 0)::text`,
              withoutTax: sql<number>`count(*) filter (where ${saleItems.taxes} is null or ${saleItems.taxes}->>'ibsCents' is null or ${saleItems.taxes}->>'cbsCents' is null)::int`,
            })
            .from(saleItems)
            .innerJoin(sales, eq(sales.id, saleItems.saleId))
            .where(
              and(
                inArray(sales.storeId, storeIds),
                eq(sales.kind, 'sale'),
                eq(sales.status, 'completed'),
                inMonth(sales.occurredAt),
              ),
            )
        : [];

      // Devolução estorna o débito na proporção do valor devolvido de cada linha.
      let returnsIbs = 0;
      let returnsCbs = 0;
      const returns = storeIds.length
        ? await tx
            .select({ originalSaleId: sales.originalSaleId, data: sales.data })
            .from(sales)
            .where(
              and(
                inArray(sales.storeId, storeIds),
                eq(sales.kind, 'return'),
                eq(sales.status, 'completed'),
                inMonth(sales.occurredAt),
              ),
            )
        : [];
      const originals = returns.length
        ? await tx
            .select({
              saleId: saleItems.saleId,
              line: saleItems.line,
              totalCents: saleItems.totalCents,
              taxes: saleItems.taxes,
            })
            .from(saleItems)
            .where(inArray(saleItems.saleId, returns.map((r) => r.originalSaleId!).filter(Boolean)))
        : [];
      for (const r of returns) {
        const items = (r.data as { items?: { line: number; refundCents: number }[] }).items ?? [];
        for (const item of items) {
          const original = originals.find(
            (o) => o.saleId === r.originalSaleId && o.line === item.line,
          );
          const taxes = original?.taxes as { ibsCents?: number; cbsCents?: number } | null;
          if (!original || !taxes || original.totalCents <= 0) continue;
          const refund = Math.min(item.refundCents, original.totalCents);
          returnsIbs += proportion(taxes.ibsCents ?? 0, refund, original.totalCents);
          returnsCbs += proportion(taxes.cbsCents ?? 0, refund, original.totalCents);
        }
      }

      // Crédito só com documento fiscal eletrônico idôneo (art. 47, § 1º, II): nota autorizada.
      const bought = rowsOf<{ ibs: string; cbs: string; without: number }>(
        await tx.execute(sql`
          select
            coalesce(sum((i->'taxes'->'ibsCbs'->>'ibsCents')::bigint) filter (where p.authorized), 0)::text as ibs,
            coalesce(sum((i->'taxes'->'ibsCbs'->>'cbsCents')::bigint) filter (where p.authorized), 0)::text as cbs,
            (count(*) filter (where i->'taxes'->'ibsCbs' is null or not p.authorized))::int as without
          from purchase_invoices p, jsonb_array_elements(p.items) i
          where p.company_id = ${companyId}
            and to_char(p.issued_at at time zone 'America/Sao_Paulo', 'YYYY-MM') = ${month}
        `),
      )[0];

      const totals: IbsCbsTotals = {
        salesIbsCents: Number(sold?.ibs ?? 0),
        salesCbsCents: Number(sold?.cbs ?? 0),
        returnsIbsCents: returnsIbs,
        returnsCbsCents: returnsCbs,
        purchasesIbsCents: Number(bought?.ibs ?? 0),
        purchasesCbsCents: Number(bought?.cbs ?? 0),
      };
      const result = settleIbsCbs({
        regime: (company.taxRegime as CompanyRegime | null) ?? null,
        regularOption: company.ibsCbsRegular,
        date: `${month}-01`,
        totals,
      });
      const regular = result.mode === 'regular' ? result : null;
      return {
        companyId,
        companyName: company.tradeName ?? company.legalName,
        month,
        mode: result.mode,
        message: result.mode === 'regular' ? null : result.message,
        totals,
        ibs: regular?.ibs ?? null,
        cbs: regular?.cbs ?? null,
        period: regular?.period
          ? {
              message: regular.period.message,
              paymentWaived: regular.period.paymentWaived,
              source: regular.period.source,
            }
          : null,
        sources: [
          ...(result.mode !== 'falta-configurar' ? [result.regime.source] : []),
          ...(regular ? [regular.credit.source] : []),
        ],
        pending: {
          saleItemsWithoutTax: sold?.withoutTax ?? 0,
          purchaseItemsWithoutIbsCbs: bought?.without ?? 0,
        },
      };
    });
  }
}

@Controller('fiscal/ibs-cbs')
export class IbsCbsSettlementController {
  constructor(
    @Inject(IbsCbsSettlementService) private readonly settlement: IbsCbsSettlementService,
  ) {}

  /** ?companyId=&month=AAAA-MM */
  @Get('settlement')
  @RequirePermission('finance.read')
  settle(
    @Ctx() ctx: RequestContext,
    @Query('companyId') companyId?: string,
    @Query('month') month?: string,
  ) {
    if (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId)) {
      throw new AppError(422, 'invalid_company', 'Escolha a empresa.');
    }
    if (!month || !MONTH.test(month)) {
      throw new AppError(422, 'invalid_month', 'Informe o mês (AAAA-MM).');
    }
    return this.settlement.settle(ctx, companyId, month);
  }
}
