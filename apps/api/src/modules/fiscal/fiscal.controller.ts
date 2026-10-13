import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  CESTS,
  CEST_SEGMENTS,
  CFOPS,
  CLASS_TRIBS,
  MERCHANDISE_ORIGINS,
  TABLE_SOURCES,
  TAX_SITUATIONS,
  cestsForNcm,
  cfopGroup,
  classTribStatus,
  findCestSegment,
  isCfopValidOn,
  type Cest,
} from '@bipae/fiscal/tables';
import { findNcm, isNcmValidOn, ncmPath, searchNcm, type Ncm } from '@bipae/fiscal/tables/ncm';
import { z } from 'zod';
import { RequirePermission } from '../../common/auth';
import { notFound, parse } from '../../common/errors';
import { today } from './fiscal-validation';

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
  @Get('ncm')
  @RequirePermission('catalog.read')
  searchNcm(@Query() query: unknown) {
    const { q, limit } = parse(ncmQuery, query);
    const date = today();
    return { items: searchNcm(q, limit).filter((ncm) => isNcmValidOn(ncm, date)).map(ncmView) };
  }

  @Get('ncm/:code')
  @RequirePermission('catalog.read')
  getNcm(@Param('code') code: string) {
    const ncm = findNcm(code);
    if (!ncm) throw notFound('NCM');
    return ncmView(ncm);
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
        return cfop.nfe && isCfopValidOn(cfop, date) && group?.direction === 'saida' && group.scope === scope;
      }).map((cfop) => ({ code: cfop.code, description: cfop.title }));
    const situations = (kind: 'icms' | 'csosn') =>
      TAX_SITUATIONS[kind].map((item) => ({ code: item.code, description: item.description }));
    return {
      origins: MERCHANDISE_ORIGINS,
      cstIcms: situations('icms'),
      csosn: situations('csosn'),
      cfopInterna: sale('interna'),
      cfopInterestadual: sale('interestadual'),
      // Só as classificações em vigor e aceitas em NF-e ou NFC-e, que é o que o Bipaê emite.
      classTrib: CLASS_TRIBS.filter(
        (item) => classTribStatus(item, date) === 'vigente' && (item.documents.nfce || item.documents.nfe),
      ).map((item) => ({
        code: item.cClassTrib,
        cst: item.cst,
        description: item.name,
        pRedIBS: item.pRedIBS,
        pRedCBS: item.pRedCBS,
        nfce: item.documents.nfce,
      })),
      cestSegments: CEST_SEGMENTS,
      counts: { cest: CESTS.length },
      sources: TABLE_SOURCES,
    };
  }
}
