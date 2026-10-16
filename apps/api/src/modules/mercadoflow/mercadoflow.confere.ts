import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '@bipae/domain';
import { dec, toCents } from '@bipae/fiscal';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { assertStore, storeCondition } from '../../common/stores';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  confereEntries,
  confereNotices,
  mercadoflowLinks,
  productBarcodes,
  productPacks,
  products,
  stockMovements,
  supplierIssues,
  supplierProductCodes,
  suppliers,
  users,
  type ConfereEntryItem,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import {
  MERCADOFLOW_CLIENT,
  MercadoflowError,
  MercadoflowUnavailableError,
  type MercadoflowClient,
} from './mercadoflow.client';
import { MercadoflowWebhooks } from './mercadoflow.webhook';

/** Item da entrada pronta para o estoque (seção 6.4 do contrato). */
export interface ConfereEntryLine {
  item: number;
  gtin?: string | null;
  packGtin?: string | null;
  supplierCode?: string | null;
  invoiceDescription?: string | null;
  description?: string | null;
  invoiceUnit?: string | null;
  invoiceQuantity?: number | string | null;
  saleUnit?: string | null;
  unitsPerPack?: number | null;
  expectedUnits?: number | string | null;
  receivedUnits?: number | string | null;
  unitCost?: number | string | null;
  lot?: string | null;
  expiry?: string | null;
  divergence?: string | null;
}

export interface ConfereEntry {
  documentId: string;
  accessKey: string;
  number?: string;
  series?: string;
  supplierCnpj?: string | null;
  supplierName?: string | null;
  issuedAt?: string;
  checkStatus?: 'NAO_INICIADA' | 'EM_ANDAMENTO' | 'CONCLUIDA';
  checkId?: string | null;
  items: ConfereEntryLine[];
}

export interface EntryResult {
  status: 'applied' | 'needs_products' | 'already_applied';
  /** Itens que ainda não têm produto no Bipaê (cadastrar ou associar antes de dar entrada). */
  missing: {
    item: number;
    gtin: string | null;
    supplierCode: string | null;
    description: string;
  }[];
  applied: number;
}

const ISSUE_KINDS = new Set(['AVARIA', 'VALIDADE', 'TROCADO']);

/** Cabeçalho da nota no aviso confere.document.received (seção 8 do contrato). */
interface NoticeData {
  documentId?: string;
  accessKey?: string;
  supplierName?: string;
  number?: string | number;
  issuedAt?: string;
  totalValue?: number | string;
  itemsCount?: number;
}

const validDate = (value: string | undefined) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Valor em reais do JSON → centavos, pelo decimal. */
const reaisToCents = (value: number | string | undefined) => {
  if (value === undefined || value === null || value === '') return null;
  try {
    return toCents(dec(value));
  } catch {
    return null;
  }
};

/**
 * Roda o trabalho do aviso no escopo do cliente (isolamento e auditoria por cliente) e volta
 * para o papel da plataforma, para o webhook registrar que tratou o aviso.
 */
export async function asTenant<T>(tx: Tx, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await tx.execute(
    sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '', true)`,
  );
  await tx.execute(sql`set local role bipae_app`);
  try {
    return await fn();
  } finally {
    await tx.execute(sql`set local role bipae_platform`);
  }
}

/** Número do JSON (unidades, custo) para decimal sem passar por conta de ponto flutuante. */
const decimal = (value: number | string | null | undefined) =>
  value === null || value === undefined || value === '' ? null : dec(String(value));

const toMilli = (value: number | string | null | undefined) => {
  const d = decimal(value);
  return d === null ? null : d.mul(1000).toDecimalPlaces(0).toNumber();
};

/**
 * Confere dentro do Bipaê (seção 6 do contrato). A leitura na SEFAZ, o certificado, o saldo e a
 * conferência ficam no MercadoFlow; o Bipaê é a tela e dá entrada no estoque. O certificado vai
 * direto ao MercadoFlow: o Bipaê não guarda o arquivo nem a senha.
 */
@Injectable()
export class MercadoflowConfere {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MERCADOFLOW_CLIENT) private readonly client: MercadoflowClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MercadoflowWebhooks) webhooks: MercadoflowWebhooks,
  ) {
    // Conferência concluída no celular ou em outro aparelho: dá entrada sozinha quando todos os
    // itens já têm produto; senão fica esperando a tela de produtos novos.
    webhooks.on('confere.check.finished', async (tx, event) => {
      const entry = (event.data.entry ?? event.data) as ConfereEntry;
      if (!event.marketId || !entry?.accessKey) throw new Error('Aviso sem a entrada.');
      const [link] = await tx
        .select()
        .from(mercadoflowLinks)
        .where(eq(mercadoflowLinks.marketId, event.marketId));
      if (!link) throw new Error('Nenhuma loja do Bipaê tem este mercado.');
      await asTenant(tx, link.tenantId, () =>
        this.applyEntry(
          tx,
          { tenantId: link.tenantId, userId: null },
          link.storeId,
          link.marketId!,
          entry,
          {},
        ),
      );
    });

    // Nota nova no Confere (MF-14): guarda o aviso para a notificação e o contador do menu.
    webhooks.on('confere.document.received', async (tx, event) => {
      const doc = event.data as NoticeData;
      if (!event.marketId || !doc?.documentId) throw new Error('Aviso sem o documento.');
      const [link] = await tx
        .select()
        .from(mercadoflowLinks)
        .where(eq(mercadoflowLinks.marketId, event.marketId));
      if (!link) throw new Error('Nenhuma loja do Bipaê tem este mercado.');
      await asTenant(tx, link.tenantId, () =>
        tx
          .insert(confereNotices)
          .values({
            id: uuidv7(),
            tenantId: link.tenantId,
            storeId: link.storeId,
            documentId: String(doc.documentId).slice(0, 80),
            accessKey: /^\d{44}$/.test(doc.accessKey ?? '') ? doc.accessKey! : null,
            supplierName: doc.supplierName ? String(doc.supplierName).slice(0, 200) : null,
            invoiceNumber: doc.number ? String(doc.number).slice(0, 20) : null,
            issuedAt: validDate(doc.issuedAt),
            totalCents: reaisToCents(doc.totalValue),
            itemsCount: Number.isSafeInteger(doc.itemsCount) ? doc.itemsCount! : null,
          })
          .onConflictDoNothing(),
      );
    });
  }

  /** Avisos de nota ainda não vistos, das lojas que a pessoa enxerga (mais novos primeiro). */
  async notices(ctx: RequestContext) {
    return withTenant(this.db, ctx, async (tx) => {
      const where = and(isNull(confereNotices.seenAt), storeCondition(ctx, confereNotices.storeId));
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(confereNotices)
        .where(where)) as [{ count: number }];
      const items = await tx
        .select({
          id: confereNotices.id,
          storeId: confereNotices.storeId,
          documentId: confereNotices.documentId,
          supplierName: confereNotices.supplierName,
          invoiceNumber: confereNotices.invoiceNumber,
          totalCents: confereNotices.totalCents,
          itemsCount: confereNotices.itemsCount,
          receivedAt: confereNotices.receivedAt,
        })
        .from(confereNotices)
        .where(where)
        .orderBy(desc(confereNotices.receivedAt))
        .limit(20);
      return { unseen: count, items };
    });
  }

  /** A tela de Notas de entrada da loja abriu: os avisos dela deixam de contar no menu. */
  async markNoticesSeen(ctx: RequestContext, storeId: string) {
    assertStore(ctx, storeId);
    await withTenant(this.db, ctx, (tx) =>
      tx
        .update(confereNotices)
        .set({ seenAt: new Date() })
        .where(and(eq(confereNotices.storeId, storeId), isNull(confereNotices.seenAt))),
    );
    return { ok: true };
  }

  /** Vínculo ativo da loja com a permissão do Confere. */
  private async link(ctx: RequestContext, storeId: string) {
    assertStore(ctx, storeId);
    const [link] = await withTenant(this.db, ctx, (tx) =>
      tx.select().from(mercadoflowLinks).where(eq(mercadoflowLinks.storeId, storeId)),
    );
    if (!link || link.status !== 'ATIVA' || !link.marketId) {
      throw new AppError(
        400,
        'confere_not_linked',
        'Ative o Confere: vincule esta loja ao MercadoFlow em Configurações → MercadoFlow.',
      );
    }
    if (!link.scopes.includes('confere:use')) {
      throw new AppError(
        403,
        'confere_scope',
        'O vínculo desta loja não autoriza o Confere. Ajuste as permissões no MercadoFlow.',
      );
    }
    return link;
  }

  private async actor(ctx: RequestContext) {
    const [user] = await withTenant(this.db, ctx, (tx) =>
      tx.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId!)),
    );
    return user?.name ?? 'Bipaê';
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof MercadoflowError) {
        throw new AppError(error.status === 404 ? 404 : 400, 'mercadoflow', error.message);
      }
      if (error instanceof MercadoflowUnavailableError) {
        throw new AppError(
          502,
          'mercadoflow_unavailable',
          'O MercadoFlow não respondeu agora. Tente de novo em alguns minutos.',
        );
      }
      throw error;
    }
  }

  /** Repassa uma chamada do Confere da loja; acrescenta quem fez (actor) nas ações. */
  async proxy(
    ctx: RequestContext,
    storeId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ) {
    const link = await this.link(ctx, storeId);
    const withActor =
      method === 'GET' ? undefined : { ...(body ?? {}), actor: await this.actor(ctx) };
    return this.call(() =>
      this.client.request<unknown>(method, `/markets/${link.marketId}/confere${path}`, {
        ...(withActor && { body: withActor }),
        attempts: method === 'GET' ? 3 : 1,
      }),
    );
  }

  /** Lê a entrada pronta da nota no MercadoFlow e dá entrada no estoque do Bipaê. */
  async enter(
    ctx: RequestContext,
    storeId: string,
    documentId: string,
    mapping: Record<string, string>,
    direct: boolean,
  ) {
    const link = await this.link(ctx, storeId);
    const response = await this.call(() =>
      this.client.get<{ entry?: ConfereEntry } & Partial<ConfereEntry>>(
        `/markets/${link.marketId}/confere/documents/${documentId}/entry`,
      ),
    );
    const entry = (response.entry ?? response) as ConfereEntry;
    if (entry.checkStatus !== 'CONCLUIDA' && !direct) {
      throw new AppError(
        400,
        'check_pending',
        'Conclua a conferência antes de dar entrada (ou use a entrada direta pela nota).',
      );
    }
    return withTenant(this.db, ctx, (tx) =>
      this.applyEntry(tx, ctx, storeId, link.marketId!, entry, mapping, direct),
    );
  }

  /**
   * Dá entrada de uma conferência no estoque. Idempotente pela nota + conferência; conferência
   * refeita lança só a diferença. Produto achado pelo GTIN, depois pelo código da caixa e depois
   * pelo código do fornecedor (aprendido na primeira vez).
   */
  async applyEntry(
    tx: Tx,
    ctx: { tenantId: string; userId: string | null },
    storeId: string,
    marketId: string,
    entry: ConfereEntry,
    mapping: Record<string, string>,
    direct = false,
  ): Promise<EntryResult> {
    const tenantId = ctx.tenantId;
    const checkId = entry.checkId ?? (direct ? `nota:${entry.documentId}` : null);
    if (!checkId)
      throw new AppError(400, 'check_pending', 'A conferência desta nota ainda não foi concluída.');
    const [done] = await tx
      .select()
      .from(confereEntries)
      .where(
        and(
          eq(confereEntries.tenantId, tenantId),
          eq(confereEntries.accessKey, entry.accessKey),
          eq(confereEntries.checkId, checkId),
        ),
      );
    if (done?.status === 'applied') return { status: 'already_applied', missing: [], applied: 0 };

    // Fornecedor pelo CNPJ da nota: cria se ainda não existe.
    const cnpj = entry.supplierCnpj?.replace(/\D/g, '') || null;
    let [supplier] = cnpj
      ? await tx
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.taxId, cnpj)))
      : [];
    if (!supplier && cnpj) {
      const id = uuidv7();
      await tx.insert(suppliers).values({
        id,
        tenantId,
        name: entry.supplierName ?? cnpj,
        taxId: cnpj,
        notes: `Cadastrado pelo Confere (NF-e ${entry.number ?? ''}).`,
      });
      [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
    }

    const lines: ConfereEntryItem[] = [];
    const missing: EntryResult['missing'] = [];
    for (const line of entry.items) {
      let productId: string | null = mapping[String(line.item)] ?? null;
      if (productId) {
        const [known] = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
        if (!known) throw notFound(`Produto do item ${line.item}`);
      }
      if (!productId && line.gtin) {
        const [byGtin] = await tx
          .select()
          .from(productBarcodes)
          .where(and(eq(productBarcodes.tenantId, tenantId), eq(productBarcodes.code, line.gtin)));
        productId = byGtin?.productId ?? null;
      }
      if (!productId && line.packGtin) {
        const [byPack] = await tx
          .select()
          .from(productPacks)
          .where(
            and(eq(productPacks.tenantId, tenantId), eq(productPacks.packGtin, line.packGtin)),
          );
        const [byCode] = byPack
          ? []
          : await tx
              .select()
              .from(productBarcodes)
              .where(
                and(
                  eq(productBarcodes.tenantId, tenantId),
                  eq(productBarcodes.code, line.packGtin),
                ),
              );
        productId = byPack?.productId ?? byCode?.productId ?? null;
      }
      if (!productId && supplier && line.supplierCode) {
        const [byCode] = await tx
          .select()
          .from(supplierProductCodes)
          .where(
            and(
              eq(supplierProductCodes.tenantId, tenantId),
              eq(supplierProductCodes.supplierId, supplier.id),
              eq(supplierProductCodes.supplierCode, line.supplierCode),
            ),
          );
        productId = byCode?.productId ?? null;
      }
      if (!productId) {
        missing.push({
          item: line.item,
          gtin: line.gtin ?? null,
          supplierCode: line.supplierCode ?? null,
          description: line.description ?? line.invoiceDescription ?? `Item ${line.item}`,
        });
        continue;
      }
      // Aprende o código do fornecedor para a próxima nota (já em unidades de venda).
      if (supplier && line.supplierCode) {
        await tx
          .insert(supplierProductCodes)
          .values({
            tenantId,
            supplierId: supplier.id,
            supplierCode: line.supplierCode,
            productId,
            factor: String(line.unitsPerPack ?? 1),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              supplierProductCodes.tenantId,
              supplierProductCodes.supplierId,
              supplierProductCodes.supplierCode,
            ],
            set: { productId, updatedAt: new Date() },
          });
      }
      const units =
        entry.checkStatus === 'CONCLUIDA'
          ? (line.receivedUnits ?? line.expectedUnits)
          : line.expectedUnits;
      const cost = decimal(line.unitCost);
      lines.push({
        item: line.item,
        productId,
        quantityMilli: toMilli(units) ?? 0,
        unitCostCents: cost === null ? null : toCents(cost),
      });
    }

    const id = done?.id ?? uuidv7();
    if (missing.length > 0) {
      const values = {
        id,
        tenantId,
        storeId,
        marketId,
        documentId: entry.documentId,
        accessKey: entry.accessKey,
        checkId,
        supplierId: supplier?.id ?? null,
        status: 'needs_products' as const,
        entry,
        items: lines,
      };
      await tx
        .insert(confereEntries)
        .values(values)
        .onConflictDoUpdate({
          target: confereEntries.id,
          set: { entry, items: lines, supplierId: values.supplierId },
        });
      return { status: 'needs_products', missing, applied: 0 };
    }

    // Conferência refeita: desconta o que as conferências anteriores desta nota já lançaram.
    const previous = await tx
      .select({ items: confereEntries.items })
      .from(confereEntries)
      .where(
        and(
          eq(confereEntries.tenantId, tenantId),
          eq(confereEntries.accessKey, entry.accessKey),
          eq(confereEntries.status, 'applied'),
          ne(confereEntries.checkId, checkId),
        ),
      );
    const already = new Map<string, number>();
    for (const row of previous)
      for (const l of row.items)
        if (l.productId)
          already.set(l.productId, (already.get(l.productId) ?? 0) + l.quantityMilli);
    const totals = new Map<string, number>();
    for (const l of lines)
      totals.set(l.productId!, (totals.get(l.productId!) ?? 0) + l.quantityMilli);
    const now = new Date();
    for (const [productId, total] of totals) {
      const delta = total - (already.get(productId) ?? 0);
      if (delta !== 0) {
        await tx.insert(stockMovements).values({
          id: uuidv7(),
          tenantId,
          storeId,
          productId,
          deltaMilli: delta,
          reason: 'confere',
          refId: id,
          note: `NF-e ${entry.number ?? ''} (Confere${previous.length ? ', conferência refeita' : ''})`,
          actorId: ctx.userId ?? null,
          occurredAt: now,
        });
      }
    }
    // Último custo do produto, por unidade de venda, como veio da nota.
    for (const l of lines) {
      if (l.unitCostCents !== null) {
        await tx
          .update(products)
          .set({ costCents: l.unitCostCents, updatedAt: now })
          .where(eq(products.id, l.productId!));
      }
    }
    // Pendências com o fornecedor: falta, sobra e as divergências marcadas na conferência.
    if (entry.checkStatus === 'CONCLUIDA') {
      for (const line of entry.items) {
        const expected = toMilli(line.expectedUnits);
        const received = toMilli(line.receivedUnits);
        const kinds = new Set<string>();
        if (expected !== null && received !== null && received < expected) kinds.add('FALTA');
        if (expected !== null && received !== null && received > expected) kinds.add('SOBRA');
        if (line.divergence && ISSUE_KINDS.has(line.divergence)) kinds.add(line.divergence);
        const cost = decimal(line.unitCost);
        for (const kind of kinds) {
          await tx
            .insert(supplierIssues)
            .values({
              id: uuidv7(),
              tenantId,
              storeId,
              supplierId: supplier?.id ?? null,
              supplierName: entry.supplierName ?? cnpj ?? 'Fornecedor',
              accessKey: entry.accessKey,
              invoiceNumber: entry.number ?? null,
              item: line.item,
              description: line.description ?? line.invoiceDescription ?? `Item ${line.item}`,
              kind: kind as 'FALTA',
              expectedMilli: expected,
              receivedMilli: received,
              unitCostCents: cost === null ? null : toCents(cost),
            })
            .onConflictDoUpdate({
              target: [
                supplierIssues.tenantId,
                supplierIssues.accessKey,
                supplierIssues.item,
                supplierIssues.kind,
              ],
              set: { expectedMilli: expected, receivedMilli: received },
            });
        }
      }
    }
    await tx
      .insert(confereEntries)
      .values({
        id,
        tenantId,
        storeId,
        marketId,
        documentId: entry.documentId,
        accessKey: entry.accessKey,
        checkId,
        supplierId: supplier?.id ?? null,
        status: 'applied',
        entry,
        items: lines,
        appliedBy: ctx.userId ?? null,
        appliedAt: now,
      })
      .onConflictDoUpdate({
        target: confereEntries.id,
        set: {
          status: 'applied',
          entry,
          items: lines,
          appliedBy: ctx.userId ?? null,
          appliedAt: now,
        },
      });
    // Entrada pelo aviso do MercadoFlow não tem usuário: a auditoria registra sem autor.
    await this.audit.record(
      tx,
      { tenantId, userId: ctx.userId as string },
      {
        action: 'confere.entry_applied',
        entity: 'confere_entry',
        entityId: id,
        data: {
          accessKey: entry.accessKey,
          checkId,
          items: lines.length,
          supplier: entry.supplierName ?? cnpj,
        },
      },
    );
    return { status: 'applied', missing: [], applied: lines.length };
  }

  /** Entradas que esperam produtos novos e as já feitas (para a lista de notas). */
  entries(ctx: RequestContext, storeId: string) {
    assertStore(ctx, storeId);
    return withTenant(this.db, ctx, (tx) =>
      tx
        .select({
          documentId: confereEntries.documentId,
          accessKey: confereEntries.accessKey,
          checkId: confereEntries.checkId,
          status: confereEntries.status,
          appliedAt: confereEntries.appliedAt,
        })
        .from(confereEntries)
        .where(eq(confereEntries.storeId, storeId)),
    );
  }

  issues(ctx: RequestContext) {
    return withTenant(this.db, ctx, (tx) =>
      tx.select().from(supplierIssues).orderBy(supplierIssues.createdAt),
    );
  }

  async resolveIssue(ctx: RequestContext, id: string, note: string | null) {
    return withTenant(this.db, ctx, async (tx) => {
      const [issue] = await tx.select().from(supplierIssues).where(eq(supplierIssues.id, id));
      if (!issue) throw notFound('Pendência');
      await tx
        .update(supplierIssues)
        .set({ status: 'resolvida', resolvedAt: new Date(), note })
        .where(eq(supplierIssues.id, id));
      return { ok: true };
    });
  }
}
