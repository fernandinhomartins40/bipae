import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { certificateUploadInput, companyIcmsRuleInput, sefazStatusInput } from '@bipae/domain';
import { COMPANY_REGIMES } from '@bipae/fiscal';
import {
  CESTS,
  CEST_SEGMENTS,
  CFOPS,
  CLASS_TRIBS,
  ICMS_GENERAL_RATES,
  ICMS_RATES_CHECKED_AT,
  MERCHANDISE_ORIGINS,
  TABLE_SOURCES,
  TAX_SITUATIONS,
  cestsForNcm,
  cfopGroup,
  icmsProductRates,
  ST_REFERENCE_UFS,
  ST_SEGMENT_UFS,
  stReferencesFor,
  cbenefLookup,
  CBENEF_UFS,
  stStatusFor,
  classTribStatus,
  findCestSegment,
  isCfopValidOn,
  type Cest,
} from '@bipae/fiscal/tables';
import { IBS_CBS_REGIME_RULES } from '@bipae/fiscal/tables';
import { findMunicipio, searchMunicipios } from '@bipae/fiscal/tables/municipios';
import { findNcm, isNcmValidOn, ncmPath, searchNcm, type Ncm } from '@bipae/fiscal/tables/ncm';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { AppError, notFound, parse } from '../../common/errors';
import { today } from './fiscal-validation';
import { CertificatesService } from './certificates.service';
import { SefazService } from './sefaz.service';
import { IcmsRulesService } from './icms-rules.service';

const ncmQuery = z.object({
  q: z.string().trim().min(2, 'Digite pelo menos 2 caracteres para buscar o NCM').max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const cestQuery = z.object({
  ncm: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{8}$/, 'NCM deve ter 8 dígitos')),
});

/** O NCM com o caminho do capítulo até ele: a descrição sozinha quase sempre é "Outros". */
const ncmView = (ncm: Ncm) => ({
  code: ncm.code,
  description: ncm.description,
  path: ncmPath(ncm.code)
    .slice(0, -1)
    .map((level) => level.description),
});

const cestView = (cest: Cest) => ({
  cest: cest.cest,
  description: cest.description,
  segment: findCestSegment(cest.segment)?.name ?? cest.segment,
  ncm: cest.ncmText ?? cest.ncm.join(', '),
});

/**
 * Consulta às tabelas fiscais oficiais, para as telas de cadastro: busca de NCM, sugestão de CEST
 * e as listas de códigos do perfil fiscal. São dados públicos, iguais para todas as empresas.
 */
@Controller('fiscal')
export class FiscalController {
  constructor(
    @Inject(IcmsRulesService) private readonly rules: IcmsRulesService,
    @Inject(CertificatesService) private readonly certificates: CertificatesService,
    @Inject(SefazService) private readonly sefaz: SefazService,
  ) {}

  // ---------------------------------------------------------------- certificado A1 (F3-10)

  @Get('certificates')
  @RequirePermission('catalog.read')
  listCertificates(@Ctx() ctx: RequestContext) {
    return this.certificates.list(ctx);
  }

  @Post('certificates/:companyId')
  @RequirePermission('fiscal.profile.write')
  uploadCertificate(
    @Ctx() ctx: RequestContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ) {
    return this.certificates.upload(ctx, companyId, parse(certificateUploadInput, body));
  }

  @Delete('certificates/:companyId')
  @RequirePermission('fiscal.profile.write')
  removeCertificate(
    @Ctx() ctx: RequestContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
  ) {
    return this.certificates.remove(ctx, companyId);
  }

  // ---------------------------------------------------------------- SEFAZ em homologação (F3-11)

  /** Pergunta à SEFAZ de homologação se o serviço está no ar, usando o certificado da empresa. */
  @Post('sefaz/status/:companyId')
  @RequirePermission('fiscal.profile.write')
  sefazStatus(
    @Ctx() ctx: RequestContext,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ) {
    return this.sefaz.status(ctx, companyId, parse(sefazStatusInput, body ?? {}).model);
  }

  // ---------------------------------------------------------------- regras de ICMS da empresa

  @Get('icms-rules')
  @RequirePermission('catalog.read')
  listRules(@Ctx() ctx: RequestContext, @Query('companyId') companyId?: string) {
    return this.rules.list(
      ctx,
      companyId && /^[0-9a-f-]{36}$/.test(companyId) ? companyId : undefined,
    );
  }

  @Post('icms-rules')
  @RequirePermission('fiscal.profile.write')
  createRule(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.rules.save(ctx, null, parse(companyIcmsRuleInput, body));
  }

  @Put('icms-rules/:id')
  @RequirePermission('fiscal.profile.write')
  updateRule(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.rules.save(ctx, id, parse(companyIcmsRuleInput, body));
  }

  @Delete('icms-rules/:id')
  @RequirePermission('fiscal.profile.write')
  removeRule(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.rules.remove(ctx, id);
  }

  // ---------------------------------------------------------------- tabelas oficiais

  @Get('ncm')
  @RequirePermission('catalog.read')
  searchNcm(@Query() query: unknown) {
    const { q, limit } = parse(ncmQuery, query);
    const date = today();
    return {
      items: searchNcm(q, limit)
        .filter((ncm) => isNcmValidOn(ncm, date))
        .map(ncmView),
    };
  }

  /** Municípios do IBGE da UF (F3-14): ?uf=SP&q=campinas. */
  @Get('municipios')
  @RequirePermission('catalog.read')
  municipios(@Query('uf') uf?: string, @Query('q') q?: string) {
    if (!uf || !/^[A-Z]{2}$/.test(uf)) throw new AppError(422, 'invalid_uf', 'Informe a UF.');
    return searchMunicipios(uf, q ?? '', 20);
  }

  @Get('municipios/:code')
  @RequirePermission('catalog.read')
  municipio(@Param('code') code: string) {
    const city = findMunicipio(code);
    if (!city) throw new AppError(404, 'not_found', 'Município não encontrado.');
    return city;
  }

  @Get('ncm/:code')
  @RequirePermission('catalog.read')
  getNcm(@Param('code') code: string) {
    const ncm = findNcm(code);
    if (!ncm) throw notFound('NCM');
    return ncmView(ncm);
  }

  /**
   * Alíquotas por mercadoria que o Portal Nacional da DIFAL publica para a UF (F3-25), com a data
   * e a marcação de defasado. Referência para o contador, não regra do motor.
   */
  /**
   * Substituição tributária por UF (F3-26): a MVA (IVA-ST) oficial da SEFAZ para o NCM na data,
   * gerada do ato publicado. Referência para a regra de ICMS da empresa, não regra do motor.
   */
  @Get('st-references')
  @RequirePermission('catalog.read')
  stReferences(@Query() query: unknown) {
    const { uf, ncm, date } = parse(
      z.object({
        uf: z.string({ message: 'Informe a UF' }).trim().toUpperCase().length(2, 'Informe a UF'),
        ncm: z
          .string({ message: 'Informe o NCM' })
          .trim()
          .regex(/^[\d.]{2,10}$/, 'NCM inválido'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      query,
    );
    const day =
      date ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return {
      uf,
      covered: ST_REFERENCE_UFS.includes(uf),
      items: stReferencesFor(uf, ncm, day),
      // Está ou saiu da ST na UF (lista de mercadorias da SEFAZ, por CEST).
      listed: ST_SEGMENT_UFS.includes(uf),
      status: stStatusFor(uf, ncm, day, (cest) => CESTS.find((c) => c.cest === cest)?.ncm ?? []),
    };
  }

  /**
   * Código de benefício fiscal (cBenef, F3-27.b): o que a tabela oficial da UF diz do código, se
   * vale na data e para quais CST. Referência para a regra de ICMS; quem escolhe é a empresa.
   */
  @Get('cbenef')
  @RequirePermission('catalog.read')
  cbenef(@Query() query: unknown) {
    const { uf, code, date } = parse(
      z.object({
        uf: z.string({ message: 'Informe a UF' }).trim().toUpperCase().length(2, 'Informe a UF'),
        code: z
          .string({ message: 'Informe o código' })
          .trim()
          .min(2, 'Informe o código')
          .max(10, 'O código tem no máximo 10 caracteres'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      query,
    );
    const day =
      date ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return { ...cbenefLookup(uf, code, day), ufs: CBENEF_UFS };
  }

  @Get('icms-products')
  @RequirePermission('catalog.read')
  icmsProducts(@Query() query: unknown) {
    const { uf } = parse(
      z.object({
        uf: z.string({ message: 'Informe a UF' }).trim().toUpperCase().length(2, 'Informe a UF'),
      }),
      query,
    );
    const found = icmsProductRates(uf);
    if (!found) throw notFound('UF');
    return {
      ...found,
      source: { page: TABLE_SOURCES.difal.page, downloadedAt: TABLE_SOURCES.difal.downloadedAt },
    };
  }

  @Get('cest')
  @RequirePermission('catalog.read')
  cestForNcm(@Query() query: unknown) {
    const { ncm } = parse(cestQuery, query);
    return { items: cestsForNcm(ncm, today()).map(cestView) };
  }

  /** As listas de códigos que o perfil fiscal oferece, já filtradas pelo que vale hoje. */
  @Get('options')
  @RequirePermission('catalog.read')
  options() {
    const date = today();
    const sale = (scope: 'interna' | 'interestadual') =>
      CFOPS.filter((cfop) => {
        const group = cfopGroup(cfop.code);
        return (
          cfop.nfe &&
          isCfopValidOn(cfop, date) &&
          group?.direction === 'saida' &&
          group.scope === scope
        );
      }).map((cfop) => ({ code: cfop.code, description: cfop.title }));
    const situations = (kind: 'icms' | 'csosn' | 'pis') =>
      TAX_SITUATIONS[kind].map((item) => ({ code: item.code, description: item.description }));
    return {
      origins: MERCHANDISE_ORIGINS,
      cstIcms: situations('icms'),
      csosn: situations('csosn'),
      cstPisCofins: situations('pis'),
      cfopInterna: sale('interna'),
      cfopInterestadual: sale('interestadual'),
      // Só as classificações em vigor e aceitas em NF-e ou NFC-e, que é o que o Bipaê emite.
      classTrib: CLASS_TRIBS.filter(
        (item) =>
          classTribStatus(item, date) === 'vigente' && (item.documents.nfce || item.documents.nfe),
      ).map((item) => ({
        code: item.cClassTrib,
        cst: item.cst,
        description: item.name,
        pRedIBS: item.pRedIBS,
        pRedCBS: item.pRedCBS,
        nfce: item.documents.nfce,
      })),
      // Regimes de empresa e a situação da alíquota geral do ICMS de cada UF, para o cadastro da
      // empresa mostrar o que já está coberto e o que ainda falta configurar.
      regimes: COMPANY_REGIMES.map((regime) => ({
        id: regime.id,
        label: regime.label,
        hint: regime.hint,
        crt: regime.crt,
        icmsCode: regime.icmsCode,
        // Pode optar por apurar o IBS e a CBS pelo regime regular (F4-13).
        ibsCbsRegularOption: IBS_CBS_REGIME_RULES.some(
          (rule) => rule.regularOption === true && rule.regimes.includes(regime.id),
        ),
      })),
      ufRates: ICMS_GENERAL_RATES.map((item) => ({
        uf: item.uf,
        status: item.status,
        rate: item.rate ?? null,
        law: item.law,
      })),
      ufRatesCheckedAt: ICMS_RATES_CHECKED_AT,
      cestSegments: CEST_SEGMENTS,
      counts: { cest: CESTS.length },
      sources: TABLE_SOURCES,
    };
  }
}
