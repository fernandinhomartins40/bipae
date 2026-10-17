import { Controller, Get, Inject, Injectable, Query, Res, StreamableFile } from '@nestjs/common';
import { readSaleNfce } from '@bipae/fiscal';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { notFound, parse } from '../../common/errors';
import { createZip } from '../../common/zip';
import { withTenant, type Db } from '../../db/client';
import {
  companies,
  fiscalDocuments,
  fiscalEvents,
  fiscalInutilizations,
  nfeInvoices,
  sales,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';

const query = z.object({
  companyId: z.string().uuid('Escolha a empresa'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM)'),
});

/** Data de emissão e valor da NF-e autorizada, direto do XML. */
function readNfeSummary(xml: string): { issuedAt: string; totalCents: number } {
  const issuedAt = /<dhEmi>([^<]+)<\/dhEmi>/.exec(xml)?.[1];
  const total = /<ICMSTot>[\s\S]*?<vNF>(\d+)\.(\d{2})<\/vNF>/.exec(xml);
  if (!issuedAt || !total) throw new Error('XML da NF-e sem data ou valor.');
  return { issuedAt, totalCents: Number(total[1]) * 100 + Number(total[2]) };
}

const STATUS: Record<string, string> = {
  authorized: 'Autorizada',
  cancelled: 'Cancelada',
  denied: 'Uso denegado',
};

/** Centavos → "1234,56" (o contador abre o CSV no Excel em português). */
const money = (cents: number) =>
  `${Math.trunc(cents / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;

/** Início do mês em Brasília (-03:00, sem horário de verão desde 2019) e o do mês seguinte. */
function monthRange(month: string) {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
  return {
    start: new Date(`${month}-01T00:00:00-03:00`),
    end: new Date(`${next}-01T00:00:00-03:00`),
  };
}

/**
 * Pacote do mês para o contador (F4-14.a): um ZIP com o XML autorizado de cada NFC-e emitida no
 * mês (inclusive as que depois foram canceladas), o XML de cada cancelamento, o de cada
 * inutilização de números e um resumo em CSV. É o que o escritório de contabilidade importa no
 * sistema dele. Só documentos com resposta da SEFAZ entram: nota que nunca saiu não tem XML
 * válido para o fisco.
 */
@Injectable()
export class AccountantExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async export(ctx: RequestContext, raw: unknown) {
    const { companyId, month } = parse(query, raw);
    const { start, end } = monthRange(month);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa');
      // Mês da venda (data de emissão), como o contador apura.
      const docs = await tx
        .select({ d: fiscalDocuments })
        .from(fiscalDocuments)
        .innerJoin(sales, eq(sales.id, fiscalDocuments.saleId))
        .where(
          and(
            eq(fiscalDocuments.companyId, companyId),
            inArray(fiscalDocuments.status, ['authorized', 'cancelled', 'denied']),
            gte(sales.occurredAt, start),
            lt(sales.occurredAt, end),
          ),
        )
        .orderBy(asc(fiscalDocuments.series), asc(fiscalDocuments.number));
      // NF-e da retaguarda (F3-33): pelo mês em que foi emitida.
      const nfes = await tx
        .select({ d: fiscalDocuments })
        .from(fiscalDocuments)
        .innerJoin(nfeInvoices, eq(nfeInvoices.id, fiscalDocuments.invoiceId))
        .where(
          and(
            eq(fiscalDocuments.companyId, companyId),
            inArray(fiscalDocuments.status, ['authorized', 'cancelled', 'denied']),
            gte(nfeInvoices.issuedAt, start),
            lt(nfeInvoices.issuedAt, end),
          ),
        )
        .orderBy(asc(fiscalDocuments.series), asc(fiscalDocuments.number));
      docs.push(...nfes);
      const events = docs.length
        ? await tx
            .select()
            .from(fiscalEvents)
            .where(
              and(
                inArray(
                  fiscalEvents.documentId,
                  docs.map((r) => r.d.id),
                ),
                eq(fiscalEvents.status, 'registered'),
              ),
            )
        : [];
      const inutilizations = await tx
        .select()
        .from(fiscalInutilizations)
        .where(
          and(
            eq(fiscalInutilizations.companyId, companyId),
            eq(fiscalInutilizations.status, 'registered'),
            gte(fiscalInutilizations.createdAt, start),
            lt(fiscalInutilizations.createdAt, end),
          ),
        );

      const files: { name: string; data: string }[] = [];
      const csv = [
        'chave;modelo;serie;numero;emissao;situacao;valor;protocolo;protocolo_cancelamento',
      ];
      let totalCents = 0;
      for (const { d } of docs) {
        if (!d.nfeProc || !d.accessKey) continue;
        files.push(
          d.model === '55'
            ? { name: `NFe/${d.accessKey}-procNFe.xml`, data: d.nfeProc }
            : { name: `NFCe/${d.accessKey}-procNFCe.xml`, data: d.nfeProc },
        );
        const cancel = events.find((e) => e.documentId === d.id);
        if (cancel?.procXml) {
          files.push({ name: `Eventos/${d.accessKey}-cancelamento.xml`, data: cancel.procXml });
        }
        let issuedAt = '';
        let value = 0;
        try {
          const nota = d.model === '55' ? readNfeSummary(d.nfeProc) : readSaleNfce(d.nfeProc);
          issuedAt = nota.issuedAt;
          value = nota.totalCents;
        } catch {
          // XML fora do formato (não deveria acontecer): vai sem data e valor no resumo.
        }
        if (d.status === 'authorized') totalCents += value;
        csv.push(
          [
            d.accessKey,
            d.model,
            d.series ?? '',
            d.number ?? '',
            issuedAt,
            STATUS[d.status] ?? d.status,
            money(value),
            d.protocol ?? '',
            cancel?.protocol ?? '',
          ].join(';'),
        );
      }
      for (const i of inutilizations) {
        if (!i.procXml) continue;
        files.push({
          name: `Inutilizacoes/serie${i.series}-${i.numberFrom}-a-${i.numberTo}.xml`,
          data: i.procXml,
        });
      }
      // BOM: o Excel abre o CSV com os acentos certos.
      files.push({ name: 'resumo.csv', data: `\uFEFF${csv.join('\r\n')}\r\n` });
      await this.audit.record(tx, ctx, {
        action: 'fiscal.accountant_export',
        entity: 'company',
        entityId: companyId,
        data: { month, documents: docs.length, inutilizations: inutilizations.length },
      });
      const cnpj = company.taxId ?? 'empresa';
      return {
        fileName: `bipae-contador-${cnpj}-${month}.zip`,
        zip: createZip(files),
        totals: { documents: csv.length - 1, totalCents },
      };
    });
  }
}

@Controller('fiscal')
export class AccountantExportController {
  constructor(
    @Inject(AccountantExportService) private readonly exporter: AccountantExportService,
  ) {}

  /** ?companyId=...&month=AAAA-MM: o ZIP do mês para o contador. */
  @Get('accountant-export')
  @RequirePermission('finance.read')
  async export(
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() raw: unknown,
  ) {
    const { fileName, zip } = await this.exporter.export(ctx, raw);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(zip);
  }
}
