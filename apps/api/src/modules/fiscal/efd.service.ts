import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { efdRequest, efdSettingsInput, type EfdSettings, type EfdSummaryView } from '@bipae/domain';
import {
  buildEfdIcmsIpi,
  EfdError,
  EFD_1601_BY_UF,
  EFD_SIMPLES_BY_UF,
  efdUfRule,
  encodeEfdLatin1,
  readEfdDocument,
  EFD_YEAR_END_INVENTORY,
  type EfdCiap,
  type EfdEntry,
  type EfdInventory,
  type EfdProduct,
  type EfdPurchase,
  type EfdResult,
} from '@bipae/fiscal';
import { and, asc, eq, gte, inArray, lte, lt, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  ciapAssets,
  companies,
  efdSettings,
  fiscalDocuments,
  nfeInvoices,
  products,
  purchaseInvoices,
  sales,
  stockMovements,
  stores,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { monthRange } from './accountant-export.service';

/** Dia (AAAA-MM-DD) em Brasília, sem horário de verão desde 2019. */
const brasiliaDay = (date: Date) =>
  new Date(date.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

const companyQuery = z.object({ companyId: z.string().uuid('Escolha a empresa') });

/** Último dia do mês (AAAA-MM-DD). */
function lastDayOf(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Dia do vencimento no mês seguinte ao da escrituração, sem passar do último dia. */
function dueDate(month: string, day: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const nextYear = m === 12 ? year + 1 : year;
  const next = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(nextYear, next, 0)).getUTCDate();
  return `${nextYear}-${String(next).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

const emptySettings = (companyId: string): EfdSettings => ({
  companyId,
  profile: 'A',
  accountantName: null,
  accountantCpf: null,
  accountantCrc: null,
  accountantCnpj: null,
  accountantEmail: null,
  accountantPhone: null,
  accountantCityCode: null,
  icmsDueDay: null,
  icmsRevenueCode: null,
  ciapAccountCode: null,
  ciapAccountName: null,
  ciapAccountLevel: null,
  ciapAdjustmentCode: null,
  ciapStOutputsTaxed: null,
});

/**
 * Arquivo da EFD ICMS/IPI do mês (F4-14.b.3): as mesmas notas do pacote do contador (NFC-e pelo
 * mês da venda, NF-e pelo mês da emissão), lidas do XML autorizado e montadas pelo gerador do
 * pacote fiscal. A empresa configura o perfil, o contador e o vencimento do ICMS.
 */
@Injectable()
export class EfdService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async loadSettings(tx: Tx, companyId: string): Promise<EfdSettings> {
    const [row] = await tx.select().from(efdSettings).where(eq(efdSettings.companyId, companyId));
    if (!row) return emptySettings(companyId);
    const { tenantId: _t, updatedAt: _u, ...settings } = row;
    return settings;
  }

  settings(ctx: RequestContext, raw: unknown): Promise<EfdSettings> {
    const { companyId } = parse(companyQuery, raw);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa');
      return this.loadSettings(tx, companyId);
    });
  }

  saveSettings(ctx: RequestContext, raw: unknown): Promise<EfdSettings> {
    const input = parse(efdSettingsInput, raw);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId));
      if (!company) throw notFound('Empresa');
      const values = { ...input, tenantId: ctx.tenantId, updatedAt: new Date() };
      await tx
        .insert(efdSettings)
        .values(values)
        .onConflictDoUpdate({ target: efdSettings.companyId, set: values });
      await this.audit.record(tx, ctx, {
        action: 'fiscal.efd_settings',
        entity: 'company',
        entityId: input.companyId,
        data: { profile: input.profile, accountant: !!input.accountantName },
      });
      return input;
    });
  }

  /**
   * Estoque das lojas da empresa na data, pelos movimentos até o fim do dia (Brasília), valorizado
   * pelo custo médio do produto (products.cost_cents). Produto sem custo ou com saldo negativo
   * fica de fora e vira aviso. Sem nenhum item, devolve nada: o arquivo não afirma "sem estoque"
   * (dúvida D-040).
   */
  private async loadInventory(
    tx: Tx,
    companyId: string,
    date: string,
    warnings: string[],
  ): Promise<EfdInventory | undefined> {
    const next = new Date(Date.parse(`${date}T00:00:00-03:00`) + 24 * 3600_000);
    const balances = await tx
      .select({
        productId: stockMovements.productId,
        milli: sql<string>`sum(${stockMovements.deltaMilli})`,
      })
      .from(stockMovements)
      .innerJoin(stores, eq(stores.id, stockMovements.storeId))
      .where(and(eq(stores.companyId, companyId), lt(stockMovements.occurredAt, next)))
      .groupBy(stockMovements.productId);
    const positive = balances.filter((b) => Number(b.milli) > 0);
    const negative = balances.filter((b) => Number(b.milli) < 0).length;
    const rows = positive.length
      ? await tx
          .select()
          .from(products)
          .where(
            inArray(
              products.id,
              positive.map((b) => b.productId),
            ),
          )
      : [];
    const byId = new Map(rows.map((p) => [p.id, p]));
    const label = date.split('-').reverse().join('/');
    const items: EfdInventory['items'] = [];
    let noCost = 0;
    for (const b of positive) {
      const product = byId.get(b.productId);
      if (!product) continue;
      if (product.costCents === null || product.costCents === undefined) {
        noCost++;
        continue;
      }
      const milli = Number(b.milli);
      items.push({
        // O mesmo código das notas de venda e de compra (cProd).
        code: product.sku ?? product.id.slice(0, 60),
        description: product.name,
        unit: product.unit.toUpperCase(),
        quantity: `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`,
        unitCostCents: Number(product.costCents),
        ...(product.ncm && { ncm: product.ncm }),
        ...(product.cest && { cest: product.cest }),
      });
    }
    if (noCost > 0) {
      warnings.push(
        `${noCost} produto(s) com estoque em ${label} estão sem custo e ficaram fora do inventário. Cadastre o custo e gere de novo.`,
      );
    }
    if (negative > 0) {
      warnings.push(
        `${negative} produto(s) tinham estoque negativo em ${label} e ficaram fora do inventário.`,
      );
    }
    if (items.length === 0) {
      warnings.push(
        `O Bipaê não tem estoque com custo em ${label}, então o inventário não entrou no arquivo (bloco H sem movimento). Se a empresa tinha estoque nessa data, o contador informa o inventário.`,
      );
      return undefined;
    }
    return { date, reason: EFD_YEAR_END_INVENTORY.reason, items };
  }

  /**
   * Bens do ativo no CIAP (F4-14.b.7) que já tinham entrado até o fim do mês, com a configuração
   * da empresa (conta do ativo, código do ajuste do E111 e saídas com CST 60, dúvida D-041).
   */
  private async loadCiap(
    tx: Tx,
    companyId: string,
    lastDay: string,
    settings: EfdSettings,
  ): Promise<EfdCiap | undefined> {
    const rows = await tx
      .select()
      .from(ciapAssets)
      .where(and(eq(ciapAssets.companyId, companyId), lte(ciapAssets.enteredOn, lastDay)));
    if (rows.length === 0) return undefined;
    const keys = await tx
      .select({ id: purchaseInvoices.id, accessKey: purchaseInvoices.accessKey })
      .from(purchaseInvoices)
      .where(inArray(purchaseInvoices.id, [...new Set(rows.map((r) => r.purchaseInvoiceId))]));
    const keyOf = new Map(keys.map((k) => [k.id, k.accessKey]));
    return {
      assets: rows.map((r) => ({
        code: r.code,
        description: r.description,
        enteredOn: r.enteredOn,
        installments: r.installments,
        icms: {
          ownCents: r.icmsOwnCents,
          stCents: r.icmsStCents,
          freightCents: r.icmsFreightCents,
          difalCents: r.icmsDifalCents,
        },
        costCenter: r.costCenter,
        ...(r.usage && { usage: r.usage }),
        ...(r.writtenOffOn &&
          r.writeOffType && { disposal: { on: r.writtenOffOn, type: r.writeOffType } }),
        source: { accessKey: keyOf.get(r.purchaseInvoiceId) ?? '', line: r.itemLine },
      })),
      ...(settings.ciapAccountCode &&
        settings.ciapAccountName &&
        settings.ciapAccountLevel && {
          account: {
            code: settings.ciapAccountCode,
            name: settings.ciapAccountName,
            level: settings.ciapAccountLevel,
          },
        }),
      ...(settings.ciapAdjustmentCode && { adjustmentCode: settings.ciapAdjustmentCode }),
      stOutputsTaxed: settings.ciapStOutputsTaxed,
    };
  }

  /** Monta o arquivo do mês; a tela usa o resumo e o download usa o texto. */
  build(ctx: RequestContext, raw: unknown): Promise<{ result: EfdResult; documents: number }> {
    const { companyId, month, previousCreditCents, inventoryDate } = parse(efdRequest, raw);
    const { start, end } = monthRange(month);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa');
      const settings = await this.loadSettings(tx, companyId);
      const statuses = ['authorized', 'cancelled', 'denied'] as const;
      const nfce = await tx
        .select({ d: fiscalDocuments })
        .from(fiscalDocuments)
        .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
        .where(
          and(
            eq(fiscalDocuments.companyId, companyId),
            inArray(fiscalDocuments.status, [...statuses]),
            gte(sales.occurredAt, start),
            lt(sales.occurredAt, end),
          ),
        )
        .orderBy(asc(fiscalDocuments.series), asc(fiscalDocuments.number));
      const nfe = await tx
        .select({ d: fiscalDocuments })
        .from(fiscalDocuments)
        .innerJoin(nfeInvoices, eq(nfeInvoices.id, fiscalDocuments.invoiceId))
        .where(
          and(
            eq(fiscalDocuments.companyId, companyId),
            inArray(fiscalDocuments.status, [...statuses]),
            gte(nfeInvoices.issuedAt, start),
            lt(nfeInvoices.issuedAt, end),
          ),
        );

      const entries: EfdEntry[] = [];
      const warnings: string[] = [];
      let denied = 0;
      let outside = 0;
      for (const { d } of [...nfce, ...nfe]) {
        if (d.status === 'denied') {
          denied++;
          continue;
        }
        if (!d.nfeProc) continue;
        const document = readEfdDocument(d.nfeProc);
        // O arquivo vai pela data de emissão do XML; nota de outro mês (contingência na virada)
        // fica para o arquivo daquele mês.
        if (!document.issuedOn.startsWith(month)) {
          outside++;
          continue;
        }
        entries.push({ status: d.status === 'cancelled' ? 'cancelled' : 'authorized', document });
      }
      // Compras (F4-14.b.2): pelo mês em que a nota entrou na empresa (importação do XML).
      const purchaseRows = await tx
        .select()
        .from(purchaseInvoices)
        .where(
          and(
            eq(purchaseInvoices.companyId, companyId),
            gte(purchaseInvoices.createdAt, start),
            lt(purchaseInvoices.createdAt, end),
          ),
        );
      const productIds = [...new Set(purchaseRows.flatMap((p) => p.items.map((i) => i.productId)))];
      const productRows = productIds.length
        ? await tx.select().from(products).where(inArray(products.id, productIds))
        : [];
      const productById = new Map(productRows.map((p) => [p.id, p]));
      const purchases: EfdPurchase[] = purchaseRows.map((p) => {
        const byLine: Record<number, EfdProduct> = {};
        for (const item of p.items) {
          const product = productById.get(item.productId);
          if (!product) continue;
          byLine[item.line] = {
            // O mesmo código que vai nas notas de venda (cProd).
            code: product.sku ?? product.id.slice(0, 60),
            name: product.name,
            unit: product.unit,
            factor: item.factor,
            ...(product.ncm && { ncm: product.ncm }),
            ...(product.cest && { cest: product.cest }),
          };
        }
        return {
          enteredOn: brasiliaDay(p.createdAt),
          purpose: p.purpose,
          document: readEfdDocument(p.xml),
          products: byLine,
        };
      });
      if (denied > 0) {
        warnings.push(
          `${denied} nota(s) com uso denegado não entram no arquivo: o Bipaê ainda não gera o registro delas (situação 04).`,
        );
      }
      if (outside > 0) {
        warnings.push(
          `${outside} nota(s) da venda deste mês têm emissão em outro mês e vão no arquivo daquele mês.`,
        );
      }
      // Regras por UF (F4-14.b.4): só o que foi lido em fonte oficial; o resto é "não confirmado".
      const lastDay = `${month}-28`;
      if (company.taxRegime === 'simples' || company.taxRegime === 'mei') {
        const rule = efdUfRule(EFD_SIMPLES_BY_UF, company.uf ?? '', lastDay);
        warnings.push(
          company.taxRegime === 'mei'
            ? 'O MEI é dispensado da EFD ICMS/IPI (Protocolo ICMS 03/2011).'
            : rule
              ? `${rule.note} Fonte: ${rule.act}.`
              : 'Empresa do Simples: a regra da sua UF para a EFD ICMS/IPI ainda não foi confirmada em fonte oficial pelo Bipaê. Pelo Protocolo ICMS 49/2015, só entrega quem a UF obrigou; confira com o contador.',
        );
      }
      const r1601 = efdUfRule(EFD_1601_BY_UF, company.uf ?? '', lastDay);
      const register1601 = r1601
        ? r1601.status === 'exempt'
          ? null
          : `${r1601.note} O Bipaê ainda não gera o 1601. Fonte: ${r1601.act}.`
        : 'A obrigação do registro 1601 (vendas com cartão e Pix) na sua UF ainda não foi confirmada em fonte oficial pelo Bipaê, e ele ainda não é gerado.';
      // Inventário (F4-14.b.5): pedido explícito ou, em fevereiro, o de 31/12 do ano anterior.
      const inventoryOn =
        inventoryDate ??
        (month.slice(5) === EFD_YEAR_END_INVENTORY.month
          ? `${Number(month.slice(0, 4)) - 1}-${EFD_YEAR_END_INVENTORY.day}`
          : undefined);
      const inventory = inventoryOn
        ? await this.loadInventory(tx, companyId, inventoryOn, warnings)
        : undefined;
      // CIAP (F4-14.b.7): bens do ativo até o fim do mês.
      const ciap = await this.loadCiap(tx, companyId, lastDayOf(month), settings);
      const interstateAsset = purchases.some(
        (p) => p.purpose === 'fixed_asset' && p.document.items.some((i) => i.cfop.startsWith('6')),
      );
      if (interstateAsset) {
        warnings.push(
          'Há compra de outra UF para o ativo: o diferencial de alíquota pago na guia ainda não entra no crédito do CIAP pelo Bipaê. Confira com o contador.',
        );
      }
      let result: EfdResult;
      try {
        result = buildEfdIcmsIpi({
          month,
          company: {
            legalName: company.legalName,
            ...(company.tradeName && { tradeName: company.tradeName }),
            cnpj: company.taxId ?? '',
            ie: company.ie ?? '',
            uf: company.uf ?? '',
            cityCode: company.cityCode ?? '',
            ...(company.municipalRegistration && {
              municipalRegistration: company.municipalRegistration,
            }),
            ...(company.cep && { cep: company.cep }),
            ...(company.street && { street: company.street }),
            ...(company.streetNumber && { number: company.streetNumber }),
            ...(company.complement && { complement: company.complement }),
            ...(company.district && { district: company.district }),
            ...(company.phone && { phone: company.phone }),
          },
          profile: settings.profile,
          ...(settings.accountantName && {
            accountant: {
              name: settings.accountantName,
              ...(settings.accountantCpf && { cpf: settings.accountantCpf }),
              ...(settings.accountantCrc && { crc: settings.accountantCrc }),
              ...(settings.accountantCnpj && { cnpj: settings.accountantCnpj }),
              ...(settings.accountantEmail && { email: settings.accountantEmail }),
              ...(settings.accountantPhone && { phone: settings.accountantPhone }),
              ...(settings.accountantCityCode && { cityCode: settings.accountantCityCode }),
            },
          }),
          entries,
          purchases,
          ...(inventory && { inventory }),
          ...(ciap && { ciap }),
          simples: company.taxRegime === 'simples' || company.taxRegime === 'mei',
          previousCreditCents,
          ...(settings.icmsDueDay && { icmsDueDate: dueDate(month, settings.icmsDueDay) }),
          ...(settings.icmsRevenueCode && { icmsRevenueCode: settings.icmsRevenueCode }),
        });
      } catch (error) {
        if (error instanceof EfdError) throw new AppError(422, 'efd_invalid', error.message);
        throw error;
      }
      // O aviso genérico do 1601 dá lugar ao da UF (ou some, quando a UF dispensa).
      result.warnings = [
        ...warnings,
        ...result.warnings.filter((w) => !w.includes('registro 1601')),
        ...(register1601 ? [register1601] : []),
      ];
      return { result, documents: entries.length + purchases.length };
    });
  }

  async summary(ctx: RequestContext, raw: unknown): Promise<EfdSummaryView> {
    const { result, documents } = await this.build(ctx, raw);
    const { balanceCents: _b, ...settlement } = result.settlement;
    return {
      fileName: result.fileName,
      lineCount: result.lineCount,
      documents,
      settlement,
      warnings: result.warnings,
    };
  }

  async file(ctx: RequestContext, raw: unknown) {
    const { result, documents } = await this.build(ctx, raw);
    const { companyId, month } = parse(efdRequest, raw);
    await withTenant(this.db, ctx, async (tx) => {
      // Controle dos bens (CIAP): até qual parcela cada bem já foi num arquivo baixado.
      for (const { code, installment } of result.ciap?.installments ?? []) {
        await tx
          .update(ciapAssets)
          .set({
            appropriatedInstallments: sql`greatest(${ciapAssets.appropriatedInstallments}, ${installment})`,
          })
          .where(and(eq(ciapAssets.companyId, companyId), eq(ciapAssets.code, code)));
      }
      await this.audit.record(tx, ctx, {
        action: 'fiscal.efd_export',
        entity: 'company',
        entityId: companyId,
        data: {
          month,
          documents,
          lines: result.lineCount,
          dueCents: result.settlement.dueCents,
          ...(result.ciap && { ciapCreditCents: result.ciap.appropriationCents }),
        },
      });
    });
    return { fileName: result.fileName, bytes: encodeEfdLatin1(result.text) };
  }
}

@Controller('fiscal/efd')
export class EfdController {
  constructor(@Inject(EfdService) private readonly efd: EfdService) {}

  @Get('settings')
  @RequirePermission('finance.read')
  settings(@Ctx() ctx: RequestContext, @Query() raw: unknown) {
    return this.efd.settings(ctx, raw);
  }

  @Put('settings')
  @RequirePermission('fiscal.profile.write')
  saveSettings(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.efd.saveSettings(ctx, body);
  }

  /** ?companyId=...&month=AAAA-MM&previousCreditCents=0: apuração e avisos, antes de baixar. */
  @Get('summary')
  @RequirePermission('finance.read')
  summary(@Ctx() ctx: RequestContext, @Query() raw: unknown) {
    return this.efd.summary(ctx, raw);
  }

  /** O arquivo do mês, em ISO 8859-1, pronto para o PVA da Receita. */
  @Get('file')
  @RequirePermission('finance.read')
  async file(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() raw: unknown,
  ) {
    const { fileName, bytes } = await this.efd.file(ctx, raw);
    reply.header('content-type', 'text/plain; charset=iso-8859-1');
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }
}
