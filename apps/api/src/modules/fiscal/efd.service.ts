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
  encodeEfdLatin1,
  readEfdDocument,
  type EfdEntry,
  type EfdResult,
} from '@bipae/fiscal';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, efdSettings, fiscalDocuments, nfeInvoices, sales } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { monthRange } from './accountant-export.service';

const companyQuery = z.object({ companyId: z.string().uuid('Escolha a empresa') });

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

  /** Monta o arquivo do mês; a tela usa o resumo e o download usa o texto. */
  build(ctx: RequestContext, raw: unknown): Promise<{ result: EfdResult; documents: number }> {
    const { companyId, month, previousCreditCents } = parse(efdRequest, raw);
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
      if (company.taxRegime === 'simples' || company.taxRegime === 'mei') {
        warnings.push(
          'Empresa do Simples: confira se a sua UF obriga a EFD ICMS/IPI (Protocolo ICMS 49/2015). A lista por UF chega em breve.',
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
          previousCreditCents,
          ...(settings.icmsDueDay && { icmsDueDate: dueDate(month, settings.icmsDueDay) }),
          ...(settings.icmsRevenueCode && { icmsRevenueCode: settings.icmsRevenueCode }),
        });
      } catch (error) {
        if (error instanceof EfdError) throw new AppError(422, 'efd_invalid', error.message);
        throw error;
      }
      result.warnings.unshift(...warnings);
      return { result, documents: entries.length };
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
    await withTenant(this.db, ctx, (tx) =>
      this.audit.record(tx, ctx, {
        action: 'fiscal.efd_export',
        entity: 'company',
        entityId: companyId,
        data: { month, documents, lines: result.lineCount, dueCents: result.settlement.dueCents },
      }),
    );
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
