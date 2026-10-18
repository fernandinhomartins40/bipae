import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CONDITIONAL_MAX_DAYS,
  conditionalCloseInput,
  conditionalInput,
  uuidv7,
  type ConditionalView,
} from '@bipae/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound, parse } from '../../common/errors';
import { assertStore, canUseStore, storeCondition } from '../../common/stores';
import { withTenant, type Db, type Tx } from '../../db/client';
import {
  companies,
  conditionalItems,
  conditionals,
  customers,
  fiscalDocuments,
  nfeInvoices,
  products,
  stockMovements,
  stores,
  tabOrders,
  users,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { NfeInvoicesService } from '../fiscal/nfe-invoices.service';

/** Hoje no fuso de Brasília, como AAAA-MM-DD. */
export function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Venda condicional (F5-12.b). As peças saem do estoque quando o cliente leva para provar e
 * voltam todas na devolução; o que ele ficou vai ao caixa como pedido da comanda (F5-08), e a
 * venda (com a NFC-e) acontece lá, do jeito de sempre e sem depender de internet no caixa. O
 * prazo segue a suspensão do ICMS do Ajuste SINIEF 02/18 (até 60 dias). As notas de remessa e
 * de retorno chegam com a NF-e da retaguarda (F5-12.c).
 */
@Injectable()
export class ConditionalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NfeInvoicesService) private readonly nfe: NfeInvoicesService,
  ) {}

  private async views(tx: Tx, rows: (typeof conditionals.$inferSelect)[]) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const invoices = await this.nfe.forConditionals(tx, ids);
    const [storeRows, customerRows, items] = await Promise.all([
      tx
        .select({ id: stores.id, name: stores.name })
        .from(stores)
        .where(inArray(stores.id, [...new Set(rows.map((r) => r.storeId))])),
      tx
        .select({ id: customers.id, name: customers.name, taxId: customers.taxId })
        .from(customers)
        .where(inArray(customers.id, [...new Set(rows.map((r) => r.customerId))])),
      tx
        .select({ i: conditionalItems, name: products.name, unit: products.unit })
        .from(conditionalItems)
        .innerJoin(products, eq(products.id, conditionalItems.productId))
        .where(inArray(conditionalItems.conditionalId, ids))
        .orderBy(products.name),
    ]);
    const today = localToday();
    return rows.map((r): ConditionalView => {
      const mine = items.filter((x) => x.i.conditionalId === r.id);
      const customer = customerRows.find((c) => c.id === r.customerId);
      return {
        id: r.id,
        number: r.number,
        storeId: r.storeId,
        storeName: storeRows.find((s) => s.id === r.storeId)?.name ?? 'Loja',
        customerId: r.customerId,
        customerName: customer?.name ?? 'Cliente',
        customerTaxId: customer?.taxId ?? null,
        status: r.status,
        dueOn: r.dueOn,
        overdue: r.status === 'open' && r.dueOn < today,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        closedAt: r.closedAt?.toISOString() ?? null,
        tabOrderId: r.tabOrderId,
        invoices: invoices
          .filter((n) => n.conditionalId === r.id)
          .map(({ conditionalId: _c, accessKey: _k, ...n }) => n),
        items: mine.map(({ i, name, unit }) => ({
          productId: i.productId,
          productName: name,
          unit,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          keptMilli: i.keptMilli,
        })),
        totalCents: mine.reduce(
          (t, { i }) => t + Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
          0,
        ),
      };
    });
  }

  async list(ctx: RequestContext, status?: string): Promise<ConditionalView[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select()
        .from(conditionals)
        .where(
          and(
            storeCondition(ctx, conditionals.storeId),
            status === 'open' || status === 'closed' || status === 'cancelled'
              ? eq(conditionals.status, status)
              : undefined,
          ),
        )
        .orderBy(desc(conditionals.createdAt))
        .limit(200);
      return this.views(tx, rows);
    });
  }

  private async load(tx: Tx, ctx: RequestContext, id: string) {
    const [row] = await tx.select().from(conditionals).where(eq(conditionals.id, id));
    if (!row || !canUseStore(ctx, row.storeId)) throw notFound('Condicional');
    return row;
  }

  get(ctx: RequestContext, id: string) {
    return withTenant(
      this.db,
      ctx,
      async (tx) => (await this.views(tx, [await this.load(tx, ctx, id)]))[0]!,
    );
  }

  /**
   * As notas do Ajuste SINIEF 02/18 saem pelo Bipaê quando a empresa da loja escolheu o perfil
   * fiscal da venda condicional (F5-12.c.2); sem ele, vale o aviso para emitir no emissor de
   * sempre.
   */
  private async fiscalCompany(tx: Tx, storeId: string) {
    const [row] = await tx
      .select({ id: companies.id, profile: companies.demonstrationProfileId })
      .from(stores)
      .innerJoin(companies, eq(companies.id, stores.companyId))
      .where(eq(stores.id, storeId));
    return row?.profile ? row.id : null;
  }

  /** A chave da remessa autorizada do condicional; null quando ela não saiu pelo Bipaê. */
  private async remessaKey(tx: Tx, conditionalId: string) {
    const [row] = await tx
      .select({ key: fiscalDocuments.accessKey })
      .from(nfeInvoices)
      .innerJoin(fiscalDocuments, eq(fiscalDocuments.invoiceId, nfeInvoices.id))
      .where(
        and(
          eq(nfeInvoices.conditionalId, conditionalId),
          eq(nfeInvoices.demonstration, 'remessa'),
          eq(fiscalDocuments.status, 'authorized'),
        ),
      );
    return row?.key ?? null;
  }

  private move(
    tx: Tx,
    ctx: RequestContext,
    m: {
      storeId: string;
      productId: string;
      deltaMilli: number;
      reason: 'conditional_out' | 'conditional_in';
      id: string;
      note: string;
      at: Date;
    },
  ) {
    return tx.insert(stockMovements).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      storeId: m.storeId,
      productId: m.productId,
      deltaMilli: m.deltaMilli,
      reason: m.reason,
      refId: m.id,
      note: m.note,
      actorId: ctx.userId,
      occurredAt: m.at,
    });
  }

  async create(ctx: RequestContext, input: z.output<typeof conditionalInput>) {
    assertStore(ctx, input.storeId);
    const today = localToday();
    const limit = addDays(today, CONDITIONAL_MAX_DAYS);
    const dueOn = input.dueOn ?? limit;
    if (dueOn < today) {
      throw new AppError(422, 'invalid_due', 'O prazo de volta não pode ser no passado.');
    }
    if (dueOn > limit) {
      throw new AppError(
        422,
        'invalid_due',
        `O prazo de volta vai até ${CONDITIONAL_MAX_DAYS} dias (Ajuste SINIEF 02/18, cláusula quarta).`,
      );
    }
    const ids = input.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError(
        422,
        'duplicated_product',
        'A mesma peça aparece duas vezes: some as quantidades.',
      );
    }
    const created = await withTenant(this.db, ctx, async (tx) => {
      const [fullCustomer] = await tx
        .select()
        .from(customers)
        .where(eq(customers.id, input.customerId));
      if (!fullCustomer) throw notFound('Cliente');
      const customer = { id: fullCustomer.id, name: fullCustomer.name };
      const found = await tx
        .select({
          id: products.id,
          name: products.name,
          priceCents: products.priceCents,
          weighable: products.isWeighable,
          active: products.active,
        })
        .from(products)
        .where(inArray(products.id, ids));
      for (const item of input.items) {
        const p = found.find((x) => x.id === item.productId);
        if (!p || !p.active) throw notFound('Produto');
        if (!p.weighable && item.quantityMilli % 1000 !== 0) {
          throw new AppError(422, 'invalid_quantity', `${p.name} vai por unidade inteira.`);
        }
      }
      const [last] = await tx
        .select({ n: sql<number>`coalesce(max(${conditionals.number}), 0)` })
        .from(conditionals)
        .where(eq(conditionals.storeId, input.storeId));
      const number = Number(last?.n ?? 0) + 1;
      const id = uuidv7();
      const now = new Date();
      const [row] = await tx
        .insert(conditionals)
        .values({
          id,
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          number,
          customerId: customer.id,
          dueOn,
          note: input.note || null,
          createdBy: ctx.userId,
          createdAt: now,
        })
        .returning();
      await tx.insert(conditionalItems).values(
        input.items.map((i) => ({
          tenantId: ctx.tenantId,
          conditionalId: id,
          productId: i.productId,
          quantityMilli: i.quantityMilli,
          unitPriceCents: found.find((p) => p.id === i.productId)!.priceCents,
        })),
      );
      for (const item of input.items) {
        await this.move(tx, ctx, {
          storeId: input.storeId,
          productId: item.productId,
          deltaMilli: -item.quantityMilli,
          reason: 'conditional_out',
          id,
          note: `Condicional nº ${number} para ${customer.name}`,
          at: now,
        });
      }
      await this.audit.record(tx, ctx, {
        action: 'conditional.created',
        entity: 'conditional',
        entityId: id,
        data: { number, customer: customer.name, dueOn, items: input.items },
      });
      // F5-12.c.2: a remessa para demonstração (CFOP 5.912) sai junto com as peças.
      const companyId = await this.fiscalCompany(tx, input.storeId);
      const remessa = companyId
        ? await this.nfe.createForConditional(tx, ctx, {
            conditionalId: id,
            companyId,
            storeId: input.storeId,
            customer: fullCustomer!,
            note: 'remessa',
            items: input.items.map((i) => ({
              productId: i.productId,
              quantityMilli: i.quantityMilli,
              unitPriceCents: found.find((p) => p.id === i.productId)!.priceCents,
            })),
            references: [],
          })
        : null;
      return { id: row!.id, remessa };
    });
    // A nota nunca impede o condicional: se faltar algo, ela fica no rascunho com o que falta.
    if (created.remessa) await this.nfe.tryIssue(ctx, created.remessa);
    return this.get(ctx, created.id);
  }

  /**
   * Volta do cliente: todas as peças entram de novo no estoque; o que ele ficou vai ao caixa
   * como pedido da comanda, e a venda baixa o estoque de novo quando for feita.
   */
  async close(ctx: RequestContext, id: string, input: z.output<typeof conditionalCloseInput>) {
    const toIssue: string[] = [];
    await withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status !== 'open') {
        throw new AppError(
          409,
          'conditional_not_open',
          'Este condicional já foi fechado ou cancelado.',
        );
      }
      const items = await tx
        .select({ i: conditionalItems, name: products.name, weighable: products.isWeighable })
        .from(conditionalItems)
        .innerJoin(products, eq(products.id, conditionalItems.productId))
        .where(eq(conditionalItems.conditionalId, id));
      for (const k of input.items) {
        if (!items.some((x) => x.i.productId === k.productId)) {
          throw new AppError(422, 'unknown_item', 'Uma das peças não faz parte deste condicional.');
        }
      }
      const kept = items.map(({ i, name, weighable }) => {
        const keptMilli = input.items.find((k) => k.productId === i.productId)?.keptMilli ?? 0;
        if (keptMilli > i.quantityMilli) {
          throw new AppError(
            422,
            'invalid_quantity',
            `${name}: o cliente não pode ficar com mais do que levou.`,
          );
        }
        if (!weighable && keptMilli % 1000 !== 0) {
          throw new AppError(422, 'invalid_quantity', `${name} vai por unidade inteira.`);
        }
        return {
          productId: i.productId,
          quantityMilli: i.quantityMilli,
          keptMilli,
          unitPriceCents: i.unitPriceCents,
        };
      });
      const now = new Date();
      const [customer] = await tx
        .select({ name: customers.name })
        .from(customers)
        .where(eq(customers.id, row.customerId));
      for (const item of kept) {
        await tx
          .update(conditionalItems)
          .set({ keptMilli: item.keptMilli })
          .where(
            and(
              eq(conditionalItems.conditionalId, id),
              eq(conditionalItems.productId, item.productId),
            ),
          );
        await this.move(tx, ctx, {
          storeId: row.storeId,
          productId: item.productId,
          deltaMilli: item.quantityMilli,
          reason: 'conditional_in',
          id,
          note: `Volta do condicional nº ${row.number}`,
          at: now,
        });
      }
      let tabOrderId: string | null = null;
      const sold = kept.filter((k) => k.keptMilli > 0);
      // F5-12.c.2: a remessa saiu por NF-e. A volta tem nota de retorno; o que o cliente ficou tem a
      // entrada simbólica e a venda por NF-e com a chave da remessa (a NFC-e não pode referenciar
      // outra nota, regra BA01-10 do MOC; dúvida D-033). A venda fica em rascunho para a pessoa
      // escolher a forma de pagamento.
      const remessa = await this.remessaKey(tx, id);
      if (remessa) {
        const companyId = (await this.fiscalCompany(tx, row.storeId)) ?? null;
        const [fullCustomer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, row.customerId));
        const note = (
          name: 'retorno' | 'entradaSimbolica' | 'venda',
          lines: { productId: string; quantityMilli: number; unitPriceCents: number }[],
        ) =>
          this.nfe.createForConditional(tx, ctx, {
            conditionalId: id,
            companyId: companyId ?? '',
            storeId: row.storeId,
            customer: fullCustomer!,
            note: name,
            items: lines,
            references: [remessa],
          });
        const returned = kept
          .filter((k) => k.keptMilli < k.quantityMilli)
          .map((k) => ({
            productId: k.productId,
            quantityMilli: k.quantityMilli - k.keptMilli,
            unitPriceCents: k.unitPriceCents,
          }));
        const keptLines = sold.map((k) => ({
          productId: k.productId,
          quantityMilli: k.keptMilli,
          unitPriceCents: k.unitPriceCents,
        }));
        if (companyId && returned.length > 0) toIssue.push(await note('retorno', returned));
        if (companyId && keptLines.length > 0) {
          toIssue.push(await note('entradaSimbolica', keptLines));
          await note('venda', keptLines);
        }
      } else if (sold.length > 0) {
        const [seller] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.userId));
        tabOrderId = uuidv7();
        await tx.insert(tabOrders).values({
          id: tabOrderId,
          tenantId: ctx.tenantId,
          storeId: row.storeId,
          label: `Condicional ${row.number}`.slice(0, 30),
          items: sold.map((k) => ({ productId: k.productId, quantityMilli: k.keptMilli })),
          waiterId: ctx.userId,
          waiterName: seller?.name ?? 'Vendedor',
        });
      }
      const [updated] = await tx
        .update(conditionals)
        .set({ status: 'closed', closedBy: ctx.userId, closedAt: now, tabOrderId })
        .where(eq(conditionals.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'conditional.closed',
        entity: 'conditional',
        entityId: id,
        data: {
          number: row.number,
          customer: customer?.name ?? null,
          kept: sold.map((k) => ({ productId: k.productId, quantityMilli: k.keptMilli })),
          returned: kept
            .filter((k) => k.keptMilli < k.quantityMilli)
            .map((k) => ({ productId: k.productId, quantityMilli: k.quantityMilli - k.keptMilli })),
        },
      });
      return updated!;
    });
    for (const invoice of toIssue) await this.nfe.tryIssue(ctx, invoice);
    return this.get(ctx, id);
  }

  /** Cancelar (o cliente não levou ou devolveu tudo): as peças voltam ao estoque. */
  async cancel(ctx: RequestContext, id: string) {
    let retorno: string | null = null;
    await withTenant(this.db, ctx, async (tx) => {
      const row = await this.load(tx, ctx, id);
      if (row.status !== 'open') {
        throw new AppError(
          409,
          'conditional_not_open',
          'Este condicional já foi fechado ou cancelado.',
        );
      }
      const items = await tx
        .select()
        .from(conditionalItems)
        .where(eq(conditionalItems.conditionalId, id));
      const now = new Date();
      for (const i of items) {
        await this.move(tx, ctx, {
          storeId: row.storeId,
          productId: i.productId,
          deltaMilli: i.quantityMilli,
          reason: 'conditional_in',
          id,
          note: `Condicional nº ${row.number} cancelado`,
          at: now,
        });
      }
      const [updated] = await tx
        .update(conditionals)
        .set({ status: 'cancelled', closedBy: ctx.userId, closedAt: now })
        .where(eq(conditionals.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'conditional.cancelled',
        entity: 'conditional',
        entityId: id,
        data: { number: row.number },
      });
      // F5-12.c.2: com a remessa por NF-e, a volta de tudo tem a nota de retorno.
      const remessa = await this.remessaKey(tx, id);
      const companyId = remessa ? await this.fiscalCompany(tx, row.storeId) : null;
      if (remessa && companyId) {
        const [fullCustomer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, row.customerId));
        retorno = await this.nfe.createForConditional(tx, ctx, {
          conditionalId: id,
          companyId,
          storeId: row.storeId,
          customer: fullCustomer!,
          note: 'retorno',
          items: items.map((i) => ({
            productId: i.productId,
            quantityMilli: i.quantityMilli,
            unitPriceCents: i.unitPriceCents,
          })),
          references: [remessa],
        });
      }
      return updated!;
    });
    if (retorno) await this.nfe.tryIssue(ctx, retorno);
    return this.get(ctx, id);
  }
}

@Controller('conditionals')
export class ConditionalsController {
  constructor(@Inject(ConditionalsService) private readonly conditionals: ConditionalsService) {}

  @Get()
  @RequirePermission('pos.sell')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.conditionals.list(ctx, status);
  }

  @Get(':id')
  @RequirePermission('pos.sell')
  get(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.conditionals.get(ctx, id);
  }

  @Post()
  @RequirePermission('pos.sell')
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.conditionals.create(ctx, parse(conditionalInput, body));
  }

  @Post(':id/close')
  @RequirePermission('pos.sell')
  close(
    @Ctx() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.conditionals.close(ctx, id, parse(conditionalCloseInput, body));
  }

  @Post(':id/cancel')
  @RequirePermission('pos.sell')
  cancel(@Ctx() ctx: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.conditionals.cancel(ctx, id);
  }
}
