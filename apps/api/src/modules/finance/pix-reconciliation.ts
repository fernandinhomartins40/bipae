import {
  decidePixMatch,
  isPixMemo,
  extractEndToEndId,
  PIX_MATCH_LABELS,
  type PixKnownCharge,
  type PixOpenReceivable,
} from '@bipae/domain';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import type { Tx } from '../../db/client';
import { bankTransactions, customers, financialEntries, pixCharges } from '../../db/schema';
import type { AuditService } from '../audit/audit.service';

/** Mesma janela das sugestões da conciliação manual (F4-07). */
export const PIX_WINDOW_DAYS = 10;

/**
 * Dá baixa numa conta a receber paga por Pix. Só age se ela ainda estiver em aberto: rodar duas
 * vezes (aviso repetido, importação repetida) não estraga nada. Devolve se a baixa foi feita.
 */
export async function settleReceivableByPix(
  tx: Tx,
  entryId: string,
  paidOn: string,
  paidCents: number,
): Promise<boolean> {
  const done = await tx
    .update(financialEntries)
    .set({
      status: 'paid',
      paidAt: paidOn,
      paidCents,
      paymentMethod: 'pix',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(financialEntries.id, entryId),
        eq(financialEntries.status, 'open'),
        eq(financialEntries.kind, 'receivable'),
      ),
    )
    .returning({ id: financialEntries.id });
  return done.length > 0;
}

/**
 * Concilia sozinho as entradas de Pix pendentes do extrato (F6-02): pelo código fim a fim de uma
 * cobrança paga, ou por valor, vencimento e nome do pagador contra as contas a receber (regras em
 * `decidePixMatch`). Na dúvida deixa pendente. Cada conciliação grava a trilha de auditoria na
 * mesma transação; o resultado depende só dos dados, então rodar de novo é seguro.
 */
export async function reconcilePix(
  tx: Tx,
  ctx: RequestContext,
  audit: AuditService,
): Promise<number> {
  const pending = (
    await tx
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.status, 'pending'), gt(bankTransactions.amountCents, 0)))
      .orderBy(asc(bankTransactions.postedOn))
      .limit(500)
  ).filter((t) => isPixMemo(t.memo));
  if (pending.length === 0) return 0;

  const e2es = [
    ...new Set(pending.map((t) => extractEndToEndId(t.memo)).filter((v): v is string => !!v)),
  ];
  const charges: (PixKnownCharge & { amountCents: number })[] = e2es.length
    ? (
        await tx
          .select({
            id: pixCharges.id,
            endToEndId: pixCharges.endToEndId,
            entryId: pixCharges.entryId,
            amountCents: pixCharges.amountCents,
          })
          .from(pixCharges)
          .where(and(inArray(pixCharges.endToEndId, e2es), eq(pixCharges.status, 'paid')))
      ).map((c) => ({ ...c }))
    : [];
  const rows = await tx
    .select({ e: financialEntries, customer: customers.name })
    .from(financialEntries)
    .leftJoin(customers, eq(customers.id, financialEntries.customerId))
    .where(
      and(
        eq(financialEntries.status, 'open'),
        eq(financialEntries.kind, 'receivable'),
        inArray(financialEntries.amountCents, [...new Set(pending.map((t) => t.amountCents))]),
      ),
    );
  const receivables: PixOpenReceivable[] = rows.map(({ e, customer }) => ({
    id: e.id,
    amountCents: e.amountCents,
    dueDate: e.dueDate,
    partyName: customer ?? null,
  }));

  let matched = 0;
  for (const t of pending) {
    const decision = decidePixMatch(t, charges, receivables, PIX_WINDOW_DAYS);
    if (decision.kind === 'none') continue;
    const reason = PIX_MATCH_LABELS[decision.reason];
    if (decision.kind === 'charge') {
      const charge = charges.find((c) => c.id === decision.chargeId)!;
      // O valor do extrato precisa ser o da cobrança: senão alguém pagou outra coisa.
      if (charge.amountCents !== t.amountCents) continue;
      charges.splice(charges.indexOf(charge), 1);
      if (decision.entryId) {
        // Normalmente a cobrança já quitou a conta ao ser confirmada; isto só cobre o que faltou.
        await settleReceivableByPix(tx, decision.entryId, t.postedOn, t.amountCents);
      }
      await tx
        .update(bankTransactions)
        .set({
          status: 'matched',
          pixChargeId: decision.chargeId,
          entryId: decision.entryId,
          autoMatched: true,
          matchReason: reason,
          resolvedAt: new Date(),
        })
        .where(eq(bankTransactions.id, t.id));
      await audit.record(tx, ctx, {
        action: 'finance.pix_auto_matched',
        entity: 'pix_charge',
        entityId: decision.chargeId,
        data: { bankTransactionId: t.id, amountCents: t.amountCents, reason: decision.reason },
      });
      matched++;
      continue;
    }
    const settled = await settleReceivableByPix(tx, decision.entryId, t.postedOn, t.amountCents);
    if (!settled) continue;
    receivables.splice(
      receivables.findIndex((r) => r.id === decision.entryId),
      1,
    );
    await tx
      .update(bankTransactions)
      .set({
        status: 'matched',
        entryId: decision.entryId,
        autoMatched: true,
        matchReason: reason,
        resolvedAt: new Date(),
      })
      .where(eq(bankTransactions.id, t.id));
    await audit.record(tx, ctx, {
      action: 'finance.pix_auto_matched',
      entity: 'financial_entry',
      entityId: decision.entryId,
      data: { bankTransactionId: t.id, amountCents: t.amountCents, reason: decision.reason },
    });
    matched++;
  }
  return matched;
}
