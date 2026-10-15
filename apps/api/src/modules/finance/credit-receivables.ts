import { uuidv7 } from '@bipae/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { customers, financialEntries } from '../../db/schema';

/**
 * Crediário com controle de inadimplência (F4-09). Cada venda no crediário vira uma conta a
 * receber do cliente, com vencimento em CREDIT_TERM_DAYS; o pagamento no crediário baixa as
 * parcelas da mais antiga para a mais nova; parcela vencida há mais de OVERDUE_BLOCK_DAYS
 * bloqueia nova compra no crediário (também no caixa sem internet).
 */
export const CREDIT_TERM_DAYS = 30;
export const OVERDUE_BLOCK_DAYS = 5;

const brDay = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(at);
export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function createCreditReceivable(
  tx: Tx,
  input: {
    tenantId: string;
    companyId: string;
    taxId: string;
    saleId: string;
    saleNumber: number;
    amountCents: number;
    at: Date;
    createdBy: string;
  },
) {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.taxId, input.taxId));
  await tx
    .insert(financialEntries)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      companyId: input.companyId,
      kind: 'receivable',
      description: `Crediário · venda nº ${input.saleNumber}`,
      category: 'Crediário',
      customerId: customer?.id ?? null,
      document: input.taxId,
      amountCents: input.amountCents,
      dueDate: addDays(brDay(input.at), CREDIT_TERM_DAYS),
      groupId: uuidv7(),
      saleId: input.saleId,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing();
}

/** Venda cancelada: a conta em aberto dela é cancelada junto. */
export async function cancelCreditReceivable(tx: Tx, saleId: string) {
  await tx
    .update(financialEntries)
    .set({ status: 'cancelled', cancelReason: 'Venda cancelada', updatedAt: new Date() })
    .where(and(eq(financialEntries.saleId, saleId), eq(financialEntries.status, 'open')));
}

/** Devolução com reembolso no crediário: abate da conta em aberto da venda original. */
export async function reduceCreditReceivable(tx: Tx, saleId: string, refundCents: number) {
  const [entry] = await tx
    .select()
    .from(financialEntries)
    .where(and(eq(financialEntries.saleId, saleId), eq(financialEntries.status, 'open')));
  if (!entry) return;
  if (refundCents >= entry.amountCents) {
    await tx
      .update(financialEntries)
      .set({ status: 'cancelled', cancelReason: 'Devolução', updatedAt: new Date() })
      .where(eq(financialEntries.id, entry.id));
  } else {
    await tx
      .update(financialEntries)
      .set({ amountCents: entry.amountCents - refundCents, updatedAt: new Date() })
      .where(eq(financialEntries.id, entry.id));
  }
}

/**
 * Pagamento no crediário: baixa as contas do cliente da mais antiga para a mais nova. Se o
 * valor cobre só parte de uma, ela fica com o resto em aberto e a parte paga vira um
 * lançamento pago da mesma conta.
 */
export async function applyCreditPayment(
  tx: Tx,
  input: { tenantId: string; taxId: string; amountCents: number; paidAt: string; userId: string },
) {
  let left = input.amountCents;
  const open = await tx
    .select()
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.kind, 'receivable'),
        eq(financialEntries.status, 'open'),
        eq(financialEntries.category, 'Crediário'),
        eq(financialEntries.document, input.taxId),
      ),
    )
    .orderBy(asc(financialEntries.dueDate), asc(financialEntries.createdAt));
  for (const entry of open) {
    if (left <= 0) break;
    const paid = Math.min(left, entry.amountCents);
    if (paid === entry.amountCents) {
      await tx
        .update(financialEntries)
        .set({
          status: 'paid',
          paidAt: input.paidAt,
          paidCents: paid,
          paymentMethod: 'crediário',
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, entry.id));
    } else {
      await tx
        .update(financialEntries)
        .set({ amountCents: entry.amountCents - paid, updatedAt: new Date() })
        .where(eq(financialEntries.id, entry.id));
      await tx.insert(financialEntries).values({
        ...entry,
        id: uuidv7(),
        saleId: null,
        amountCents: paid,
        status: 'paid',
        paidAt: input.paidAt,
        paidCents: paid,
        paymentMethod: 'crediário',
        description: `${entry.description} (parte paga)`,
        createdBy: input.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    left -= paid;
  }
}

/** Clientes do crediário com conta vencida (pelo CPF/CNPJ). */
export async function overdueCredit(tx: Tx, today: string) {
  const rows = await tx
    .select({
      taxId: financialEntries.document,
      overdueCents: sql<string>`sum(${financialEntries.amountCents})::text`,
      oldestDue: sql<string>`min(${financialEntries.dueDate})::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(financialEntries)
    .where(
      and(
        eq(financialEntries.kind, 'receivable'),
        eq(financialEntries.status, 'open'),
        eq(financialEntries.category, 'Crediário'),
        sql`${financialEntries.dueDate} < ${today}`,
      ),
    )
    .groupBy(financialEntries.document);
  return rows
    .filter((r) => r.taxId)
    .map((r) => ({
      taxId: r.taxId!,
      overdueCents: Number(r.overdueCents),
      oldestDue: r.oldestDue,
      count: r.count,
      daysLate: Math.round(
        (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${r.oldestDue}T12:00:00Z`)) / 86_400_000,
      ),
    }));
}

export const todayInBrazil = () => brDay(new Date());
