import { Inject, Injectable } from '@nestjs/common';
import {
  creditPaymentInput,
  customerInput,
  partyInput,
  uuidv7,
  type CustomerCredit,
  type Page,
  type Party,
} from '@bipae/domain';
import { asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { withTenant, type Db, type Tx } from '../../db/client';
import { customerCreditEntries, customers, priceTables, suppliers } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { applyCreditPayment, todayInBrazil } from '../finance/credit-receivables';

export type PartyKind = 'customer' | 'supplier';
type CustomerData = z.output<typeof customerInput>;
type PartyData = z.output<typeof partyInput>;

const LABEL: Record<PartyKind, string> = { customer: 'Cliente', supplier: 'Fornecedor' };

function toParty(row: typeof customers.$inferSelect | typeof suppliers.$inferSelect): Party {
  return {
    id: row.id,
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    address: row.address as Party['address'],
    notes: row.notes,
    ...('marketingConsent' in row && {
      marketingConsent: row.marketingConsent,
      priceTableId: row.priceTableId,
      creditLimitCents: row.creditLimitCents,
    }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PartiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private table(kind: PartyKind) {
    return kind === 'customer' ? customers : suppliers;
  }

  async list(
    ctx: RequestContext,
    kind: PartyKind,
    query: { q?: string | undefined; limit: number; offset: number },
  ): Promise<Page<Party>> {
    const table = this.table(kind);
    return withTenant(this.db, ctx, async (tx) => {
      let where: SQL | undefined;
      if (query.q) {
        const term = query.q.trim();
        const digits = term.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
        where = or(
          ilike(table.name, `%${term.replace(/[%_\\]/g, '\\$&')}%`),
          digits.length >= 3 ? eq(table.taxId, digits) : undefined,
          digits.length >= 8 ? eq(table.phone, digits) : undefined,
        );
      }
      const rows = await tx
        .select()
        .from(table)
        .where(where)
        .orderBy(asc(sql`lower(${table.name})`))
        .limit(query.limit)
        .offset(query.offset);
      const [total] = await tx.select({ n: count() }).from(table).where(where);
      return { items: rows.map(toParty), total: total?.n ?? 0 };
    });
  }

  async get(ctx: RequestContext, kind: PartyKind, id: string): Promise<Party> {
    const table = this.table(kind);
    const [row] = await withTenant(this.db, ctx, (tx) =>
      tx.select().from(table).where(eq(table.id, id)),
    );
    if (!row) throw notFound(LABEL[kind]);
    return toParty(row);
  }

  async save(
    ctx: RequestContext,
    kind: PartyKind,
    id: string | null,
    input: CustomerData | PartyData,
  ): Promise<Party> {
    const table = this.table(kind);
    const base = {
      name: input.name,
      taxId: input.taxId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    };
    return withTenant(this.db, ctx, async (tx) => {
      let consentChanged = false;
      let limitChanged = false;
      let creditLimit: number | null = null;
      let values: Record<string, unknown> = base;
      if (kind === 'customer' && 'marketingConsent' in input) {
        const [current] = id
          ? await tx
              .select({ consent: customers.marketingConsent, limit: customers.creditLimitCents })
              .from(customers)
              .where(eq(customers.id, id))
          : [];
        consentChanged = (current?.consent ?? false) !== input.marketingConsent;
        // Limite do crediário: campo ausente mantém o atual; mudar exige a permissão própria.
        const asked = (input as CustomerData).creditLimitCents;
        creditLimit = asked === undefined ? (current?.limit ?? null) : asked;
        limitChanged = creditLimit !== (current?.limit ?? null);
        if (limitChanged && !ctx.permissions.includes('parties.credit')) {
          throw new AppError(
            403,
            'forbidden',
            'Você não tem permissão para mudar o limite do crediário.',
          );
        }
        if (creditLimit !== null && !base.taxId) {
          throw new AppError(
            422,
            'credit_needs_tax_id',
            'Para vender no crediário, informe o CPF ou CNPJ do cliente.',
          );
        }
        const priceTableId = (input as CustomerData).priceTableId ?? null;
        if (priceTableId) {
          // FK checks ignore RLS: confirm the table belongs to this client.
          const [table] = await tx
            .select({ id: priceTables.id })
            .from(priceTables)
            .where(eq(priceTables.id, priceTableId));
          if (!table)
            throw new AppError(422, 'invalid_price_table', 'Tabela de preço não encontrada.');
        }
        values = {
          ...base,
          priceTableId,
          marketingConsent: input.marketingConsent,
          creditLimitCents: creditLimit,
          ...(consentChanged && { marketingConsentAt: new Date() }),
        };
      }

      const [row] = id
        ? await tx
            .update(table)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(table.id, id))
            .returning()
        : await tx
            .insert(table)
            .values({ id: uuidv7(), tenantId: ctx.tenantId, ...(values as typeof base) })
            .returning();
      if (!row) throw notFound(LABEL[kind]);

      await this.audit.record(tx, ctx, {
        action: `${kind}.${id ? 'updated' : 'created'}`,
        entity: kind,
        entityId: row.id,
        data: { name: input.name },
      });
      if (consentChanged) {
        // LGPD: keep proof of when and how consent was given or withdrawn.
        await this.audit.record(tx, ctx, {
          action: 'customer.marketing_consent_changed',
          entity: 'customer',
          entityId: row.id,
          data: { consent: (input as CustomerData).marketingConsent, channel: 'backoffice' },
        });
      }
      if (limitChanged) {
        await this.audit.record(tx, ctx, {
          action: 'customer.credit_limit_changed',
          entity: 'customer',
          entityId: row.id,
          data: { limitCents: creditLimit },
        });
      }
      return toParty(row);
    });
  }

  /** Saldo devedor do crediário pelo CPF/CNPJ: a soma do extrato. */
  private async balance(tx: Tx, taxId: string): Promise<number> {
    const [sum] = await tx
      .select({ cents: sql<string>`coalesce(sum(${customerCreditEntries.amountCents}), 0)::text` })
      .from(customerCreditEntries)
      .where(eq(customerCreditEntries.customerTaxId, taxId));
    return Number(sum?.cents ?? 0);
  }

  /** Crediário do cliente (F2-02): limite, saldo devedor e o extrato, mais novo primeiro. */
  async credit(ctx: RequestContext, id: string): Promise<CustomerCredit> {
    return withTenant(this.db, ctx, async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) throw notFound('Cliente');
      const limitCents = customer.creditLimitCents;
      if (!customer.taxId)
        return { limitCents, balanceCents: 0, availableCents: null, entries: [] };
      const balanceCents = await this.balance(tx, customer.taxId);
      const entries = await tx
        .select()
        .from(customerCreditEntries)
        .where(eq(customerCreditEntries.customerTaxId, customer.taxId))
        .orderBy(desc(customerCreditEntries.createdAt))
        .limit(100);
      return {
        limitCents,
        balanceCents,
        availableCents: limitCents === null ? null : Math.max(0, limitCents - balanceCents),
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          amountCents: e.amountCents,
          saleId: e.saleId,
          note: e.note,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    });
  }

  /** Recebe uma parcela do crediário: diminui o saldo e fica na auditoria. */
  async receiveCredit(
    ctx: RequestContext,
    id: string,
    input: z.output<typeof creditPaymentInput>,
  ): Promise<CustomerCredit> {
    await withTenant(this.db, ctx, async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) throw notFound('Cliente');
      if (!customer.taxId) {
        throw new AppError(422, 'credit_needs_tax_id', 'O cliente não tem CPF ou CNPJ cadastrado.');
      }
      if (input.amountCents > (await this.balance(tx, customer.taxId))) {
        throw new AppError(
          422,
          'credit_overpaid',
          'O valor é maior que o saldo devedor do cliente no crediário.',
        );
      }
      const entryId = uuidv7();
      await tx.insert(customerCreditEntries).values({
        id: entryId,
        tenantId: ctx.tenantId,
        customerTaxId: customer.taxId,
        kind: 'payment',
        amountCents: -input.amountCents,
        note: input.note ?? null,
        createdBy: ctx.userId,
      });
      await applyCreditPayment(tx, {
        tenantId: ctx.tenantId,
        taxId: customer.taxId,
        amountCents: input.amountCents,
        paidAt: todayInBrazil(),
        userId: ctx.userId,
      });
      await this.audit.record(tx, ctx, {
        action: 'customer.credit_payment',
        entity: 'customer',
        entityId: id,
        data: { amountCents: input.amountCents, entryId },
      });
    });
    return this.credit(ctx, id);
  }
}
