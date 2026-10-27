import { Inject, Injectable } from '@nestjs/common';
import {
  addMonths,
  BILLING_SUSPENSION_REASON,
  billingState,
  uuidv7,
  type AdminBillingDetail,
  type AdminBillingRow,
  type AdminInvoiceView,
} from '@bipae/domain';
import { and, desc, eq, ilike, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { Config } from '../../config';
import { asPlatform, type Db, type Tx } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { planInvoices, plans, tenantBilling, tenantEvents, tenants } from '../../db/schema';
import type { AdminContext } from './platform.guard';
import { PlatformAuditService } from './platform-audit.service';

const DAY_MS = 86_400_000;

export type BillingFilter = 'all' | 'overdue' | 'open' | 'paused';

type InvoiceRow = typeof planInvoices.$inferSelect;

/**
 * Cobrança por cliente no painel da plataforma (F6-04.d): lista com inadimplência, faturas de cada
 * cliente, pausar e retomar a cobrança e perdoar uma fatura. Roda pelo papel da plataforma (só
 * aqui, em `modules/admin`) e cada ação grava a trilha de auditoria da plataforma e o histórico do
 * cliente na mesma transação. Nenhum preço é decidido aqui: os valores vêm das faturas e dos
 * planos já cadastrados.
 */
@Injectable()
export class AdminBillingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  private daysLate(dueAt: Date | null, now: Date): number {
    if (!dueAt || dueAt.getTime() >= now.getTime()) return 0;
    return Math.floor((now.getTime() - dueAt.getTime()) / DAY_MS);
  }

  private toRow(
    t: typeof tenants.$inferSelect,
    plan: typeof plans.$inferSelect | undefined,
    billing: typeof tenantBilling.$inferSelect | undefined,
    open: InvoiceRow | undefined,
    now: Date,
  ): AdminBillingRow {
    return {
      tenantId: t.id,
      name: t.name,
      planId: t.planId,
      planName: plan?.name ?? t.planId,
      tenantStatus: t.status,
      state: billingState({
        hasPaidPlan: !!billing?.paidUntil && (plan?.priceCents ?? 0) > 0,
        openInvoiceDueAt: open?.dueAt ?? null,
        now,
        graceDays: this.config.BILLING_GRACE_DAYS,
      }),
      paidUntil: billing?.paidUntil?.toISOString() ?? null,
      paused: !!billing?.pausedAt,
      openInvoiceAmountCents: open?.amountCents ?? null,
      openInvoiceDueAt: open?.dueAt.toISOString() ?? null,
      daysLate: this.daysLate(open?.dueAt ?? null, now),
    };
  }

  async list(
    input: { filter: BillingFilter; q?: string; limit: number; offset: number },
    now: Date = new Date(),
  ) {
    return asPlatform(this.db, async (tx) => {
      const where: SQL[] = [];
      if (input.q) where.push(ilike(tenants.name, `%${input.q}%`));
      if (input.filter === 'overdue') {
        where.push(
          sql`exists (select 1 from plan_invoices i where i.tenant_id = ${tenants.id} and i.status = 'open' and i.due_at < ${now.toISOString()}::timestamptz)`,
        );
      } else if (input.filter === 'open') {
        where.push(
          sql`exists (select 1 from plan_invoices i where i.tenant_id = ${tenants.id} and i.status = 'open')`,
        );
      } else if (input.filter === 'paused') {
        where.push(
          sql`exists (select 1 from tenant_billing b where b.tenant_id = ${tenants.id} and b.paused_at is not null)`,
        );
      }
      const base = where.length ? and(...where) : undefined;
      const rows = await tx
        .select()
        .from(tenants)
        .where(base)
        .orderBy(desc(tenants.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const ids = rows.map((r) => r.id);
      const [planRows, billingRows, openRows] = ids.length
        ? await Promise.all([
            tx.select().from(plans),
            tx.select().from(tenantBilling).where(inArray(tenantBilling.tenantId, ids)),
            tx
              .select()
              .from(planInvoices)
              .where(and(inArray(planInvoices.tenantId, ids), eq(planInvoices.status, 'open'))),
          ])
        : [[], [], []];
      const items = rows.map((t) =>
        this.toRow(
          t,
          planRows.find((p) => p.id === t.planId),
          billingRows.find((b) => b.tenantId === t.id),
          openRows.find((i) => i.tenantId === t.id),
          now,
        ),
      );
      // Totais da inadimplência da plataforma inteira (não só da página).
      const [totals] = rowsOf<{ count: number; cents: string }>(
        await tx.execute(sql`
          select count(*)::int as count, coalesce(sum(amount_cents), 0)::text as cents
          from plan_invoices where status = 'open' and due_at < ${now.toISOString()}::timestamptz
        `),
      );
      return {
        items,
        overdue: { count: Number(totals?.count ?? 0), amountCents: Number(totals?.cents ?? 0) },
      };
    });
  }

  private invoiceView(row: InvoiceRow, planName: string): AdminInvoiceView {
    return {
      id: row.id,
      kind: row.kind,
      planId: row.planId,
      planName,
      amountCents: row.amountCents,
      status: row.status,
      dueAt: row.dueAt.toISOString(),
      periodStart: row.periodStart?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      copyPaste: null,
      method: row.method ?? null,
      boletoLine: null,
      boletoUrl: null,
      createdAt: row.createdAt.toISOString(),
      waivedAt: row.waivedAt?.toISOString() ?? null,
      waivedReason: row.waivedReason,
      cardError: row.cardError,
    };
  }

  private async load(tx: Tx, id: string, now: Date): Promise<AdminBillingDetail> {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) throw notFound('Cliente');
    const planRows = await tx.select().from(plans);
    const [billing] = await tx.select().from(tenantBilling).where(eq(tenantBilling.tenantId, id));
    const invoices = await tx
      .select()
      .from(planInvoices)
      .where(eq(planInvoices.tenantId, id))
      .orderBy(desc(planInvoices.createdAt))
      .limit(50);
    const name = (planId: string) => planRows.find((p) => p.id === planId)?.name ?? planId;
    const open = invoices.find((i) => i.status === 'open');
    const pending = billing?.pendingPlanId
      ? { id: billing.pendingPlanId, name: name(billing.pendingPlanId) }
      : null;
    return {
      ...this.toRow(
        tenant,
        planRows.find((p) => p.id === tenant.planId),
        billing,
        open,
        now,
      ),
      pausedAt: billing?.pausedAt?.toISOString() ?? null,
      pausedReason: billing?.pausedReason ?? null,
      pendingPlan: pending,
      card: billing?.cardTokenSealed
        ? { brand: billing.cardBrand ?? null, last4: billing.cardLast4 ?? null }
        : null,
      invoices: invoices.map((i) => this.invoiceView(i, name(i.planId))),
    };
  }

  detail(id: string, now: Date = new Date()): Promise<AdminBillingDetail> {
    return asPlatform(this.db, (tx) => this.load(tx, id, now));
  }

  private async event(
    tx: Tx,
    admin: AdminContext,
    tenantId: string,
    kind: 'billing_paused' | 'billing_resumed' | 'billing_waived',
    data: Record<string, unknown>,
    action: string,
  ) {
    await tx
      .insert(tenantEvents)
      .values({ id: uuidv7(), tenantId, kind, data, adminId: admin.userId });
    await this.audit.record(tx, admin, { action, tenantId, target: 'billing', data });
  }

  /** Libera a conta que estava bloqueada só por causa da cobrança. */
  private async releaseBillingBlock(tx: Tx, tenant: typeof tenants.$inferSelect, now: Date) {
    if (tenant.status === 'suspended' && tenant.statusReason === BILLING_SUSPENSION_REASON) {
      await tx
        .update(tenants)
        .set({ status: 'active', statusReason: null, statusChangedAt: now })
        .where(eq(tenants.id, tenant.id));
      return true;
    }
    return false;
  }

  /**
   * Pausa a cobrança: sem faturas novas, sem cartão cobrado e sem bloqueio por atraso. Se a conta
   * estava bloqueada pela cobrança, volta a funcionar. Pagamentos que chegarem continuam valendo.
   */
  async pause(admin: AdminContext, id: string, reason: string, now: Date = new Date()) {
    return asPlatform(this.db, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw notFound('Cliente');
      const [billing] = await tx.select().from(tenantBilling).where(eq(tenantBilling.tenantId, id));
      if (billing?.pausedAt) throw new AppError(409, 'conflict', 'A cobrança já está pausada.');
      await tx
        .insert(tenantBilling)
        .values({ tenantId: id, pausedAt: now, pausedReason: reason })
        .onConflictDoUpdate({
          target: tenantBilling.tenantId,
          set: { pausedAt: now, pausedReason: reason, updatedAt: now },
        });
      const released = await this.releaseBillingBlock(tx, tenant, now);
      await this.event(tx, admin, id, 'billing_paused', { reason, released }, 'billing.pause');
      return this.load(tx, id, now);
    });
  }

  /**
   * Retoma a cobrança. Uma fatura que já tinha vencido ganha vencimento hoje, para a tolerância
   * contar a partir de agora e o cliente não ser bloqueado no mesmo instante.
   */
  async resume(admin: AdminContext, id: string, now: Date = new Date()) {
    return asPlatform(this.db, async (tx) => {
      const [billing] = await tx.select().from(tenantBilling).where(eq(tenantBilling.tenantId, id));
      if (!billing?.pausedAt) throw new AppError(409, 'conflict', 'A cobrança não está pausada.');
      await tx
        .update(tenantBilling)
        .set({ pausedAt: null, pausedReason: null, updatedAt: now })
        .where(eq(tenantBilling.tenantId, id));
      const moved = await tx
        .update(planInvoices)
        .set({ dueAt: now })
        .where(
          and(
            eq(planInvoices.tenantId, id),
            eq(planInvoices.status, 'open'),
            lt(planInvoices.dueAt, now),
          ),
        )
        .returning({ id: planInvoices.id });
      await this.event(
        tx,
        admin,
        id,
        'billing_resumed',
        { pausedFor: now.getTime() - billing.pausedAt.getTime(), invoicesMoved: moved.length },
        'billing.resume',
      );
      return this.load(tx, id, now);
    });
  }

  /**
   * Perdoa uma fatura em aberto: ela fica cancelada (com quem perdoou e por quê) e, se era a
   * mensalidade, o período vale como pago. A conta bloqueada pela cobrança volta a funcionar.
   */
  async waive(
    admin: AdminContext,
    id: string,
    invoiceId: string,
    reason: string,
    now: Date = new Date(),
  ) {
    return asPlatform(this.db, async (tx) => {
      const [invoice] = await tx
        .select()
        .from(planInvoices)
        .where(and(eq(planInvoices.id, invoiceId), eq(planInvoices.tenantId, id)));
      if (!invoice) throw notFound('Fatura');
      if (invoice.status !== 'open') {
        throw new AppError(422, 'invoice_closed', 'Só dá para perdoar uma fatura em aberto.');
      }
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw notFound('Cliente');
      await tx
        .update(planInvoices)
        .set({ status: 'canceled', waivedAt: now, waivedReason: reason })
        .where(eq(planInvoices.id, invoiceId));
      if (invoice.kind === 'subscription') {
        const end =
          invoice.periodEnd && invoice.periodEnd.getTime() > now.getTime()
            ? invoice.periodEnd
            : addMonths(now, 1);
        await tx
          .insert(tenantBilling)
          .values({ tenantId: id, paidUntil: end })
          .onConflictDoUpdate({
            target: tenantBilling.tenantId,
            set: { paidUntil: end, updatedAt: now },
          });
      }
      const released = await this.releaseBillingBlock(tx, tenant, now);
      await this.event(
        tx,
        admin,
        id,
        'billing_waived',
        { invoiceId, amountCents: invoice.amountCents, kind: invoice.kind, reason, released },
        'billing.waive',
      );
      return this.load(tx, id, now);
    });
  }
}
