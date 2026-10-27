import { Inject, Injectable } from '@nestjs/common';
import {
  addMonths,
  BILLING_SUSPENSION_REASON,
  billingState,
  LIMIT_RESOURCES,
  LIMIT_LABELS,
  prorateUpgradeCents,
  uuidv7,
  type BillingView,
  type InvoiceView,
  type PlanLimits,
} from '@bipae/domain';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { CONFIG } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import type { Config } from '../../config';
import type { Tx } from '../../db/client';
import {
  companies,
  planInvoices,
  plans,
  tenantBilling,
  tenantEvents,
  tenants,
  users,
} from '../../db/schema';
import { LimitsService } from '../account/limits.service';
import { BillingGatewayHolder, type BillingPayer } from './billing-gateway';

const DAY_MS = 86_400_000;
/** A primeira fatura de quem assina vale por alguns dias; depois disso é só aviso, sem bloqueio. */
const FIRST_INVOICE_DAYS = 3;
/** O QR do Pix vale por um dia: a fatura costuma ser paga pelo celular, sem pressa de caixa. */
const CHARGE_VALID_MS = DAY_MS;
/** Consulta ao meio de pagamento no máximo a cada tanto. */
const CHECK_EVERY_MS = 5000;

type InvoiceRow = typeof planInvoices.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

/**
 * Cobrança automática dos planos (F6-04). Tudo aqui recebe a transação pronta: o cliente chama
 * por `withTenant` (só escolhe plano e pede o QR) e a rotina de manutenção chama pelo papel da
 * plataforma (confirma pagamento, troca o plano, bloqueia). Nenhum preço é fixo no código.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(BillingGatewayHolder) private readonly holder: BillingGatewayHolder,
    @Inject(LimitsService) private readonly limits: LimitsService,
  ) {}

  // ------------------------------------------------------------------ leitura (cliente)

  private async planName(tx: Tx, id: string): Promise<string> {
    const [p] = await tx.select({ name: plans.name }).from(plans).where(eq(plans.id, id));
    return p?.name ?? id;
  }

  private async toView(tx: Tx, row: InvoiceRow): Promise<InvoiceView> {
    return {
      id: row.id,
      kind: row.kind,
      planId: row.planId,
      planName: await this.planName(tx, row.planId),
      amountCents: row.amountCents,
      status: row.status,
      dueAt: row.dueAt.toISOString(),
      periodStart: row.periodStart?.toISOString() ?? null,
      periodEnd: row.periodEnd?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      copyPaste: row.status === 'open' ? row.copyPaste : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async view(tx: Tx, now: Date = new Date()): Promise<BillingView> {
    const [billing] = await tx.select().from(tenantBilling);
    const rows = await tx
      .select()
      .from(planInvoices)
      .orderBy(desc(planInvoices.createdAt))
      .limit(12);
    const open = rows.find((r) => r.status === 'open') ?? null;
    const [tenant] = await tx.select({ planId: tenants.planId }).from(tenants);
    const [plan] = tenant ? await tx.select().from(plans).where(eq(plans.id, tenant.planId)) : [];
    const pending = billing?.pendingPlanId
      ? { id: billing.pendingPlanId, name: await this.planName(tx, billing.pendingPlanId) }
      : null;
    return {
      gateway: this.holder.view,
      state: billingState({
        hasPaidPlan: !!billing?.paidUntil && (plan?.priceCents ?? 0) > 0,
        openInvoiceDueAt: open?.dueAt ?? null,
        now,
        graceDays: this.config.BILLING_GRACE_DAYS,
      }),
      graceDays: this.config.BILLING_GRACE_DAYS,
      paidUntil: billing?.paidUntil?.toISOString() ?? null,
      pendingPlan: pending,
      openInvoice: open ? await this.toView(tx, open) : null,
      invoices: await Promise.all(rows.map((r) => this.toView(tx, r))),
    };
  }

  // ------------------------------------------------------------------ escolha do plano (cliente)

  private async requirePlan(tx: Tx, planId: string): Promise<PlanRow> {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId));
    if (!plan || !plan.active || !plan.public) throw notFound('Plano');
    return plan;
  }

  private price(plan: PlanRow): number {
    return plan.priceCents ?? 0;
  }

  /** O plano de destino precisa comportar o que a conta já usa; senão a troca fica para depois. */
  private async assertFits(tx: Tx, target: PlanRow) {
    const usage = await this.limits.usage(tx);
    const limits = target.limits as PlanLimits;
    const over = LIMIT_RESOURCES.filter((r) => limits[r] !== null && usage[r] > limits[r]!);
    if (over.length > 0) {
      throw new AppError(
        422,
        'plan_too_small',
        `O plano ${target.name} não comporta o que você usa hoje: ${over
          .map((r) => `${usage[r]} ${LIMIT_LABELS[r].many} (limite ${limits[r]})`)
          .join(', ')}. Reduza o uso antes de trocar.`,
      );
    }
  }

  private async cancelOpen(tx: Tx) {
    await tx
      .update(planInvoices)
      .set({ status: 'canceled' })
      .where(eq(planInvoices.status, 'open'));
  }

  private async openInvoice(tx: Tx): Promise<InvoiceRow | undefined> {
    const [open] = await tx.select().from(planInvoices).where(eq(planInvoices.status, 'open'));
    return open;
  }

  /**
   * O cliente escolhe um plano. Quatro caminhos: assinar (ou voltar a assinar), subir de plano no
   * meio do período (paga só a diferença proporcional), descer de plano (vale quando o período
   * pago acabar) e escolher o plano em que já está.
   */
  async subscribe(
    tx: Tx,
    tenantId: string,
    planId: string,
    now: Date = new Date(),
  ): Promise<InvoiceView | null> {
    const target = await this.requirePlan(tx, planId);
    const [tenant] = await tx.select().from(tenants);
    if (!tenant) throw notFound('Conta');
    if (tenant.status === 'cancelled' || tenant.status === 'suspended') {
      throw new AppError(
        422,
        'billing_account_blocked',
        tenant.statusReason === BILLING_SUSPENSION_REASON
          ? 'Pague a fatura em aberto para reativar a conta.'
          : 'Esta conta está suspensa. Fale com o suporte do Bipaê.',
      );
    }
    const [current] = await tx.select().from(plans).where(eq(plans.id, tenant.planId));
    const [billing] = await tx.select().from(tenantBilling);
    const open = await this.openInvoice(tx);
    const targetPrice = this.price(target);
    const currentPrice = current ? this.price(current) : 0;
    const paying =
      !!billing?.paidUntil &&
      billing.paidUntil.getTime() > now.getTime() &&
      tenant.status === 'active';

    if (open && open.dueAt.getTime() < now.getTime() && paying) {
      throw new AppError(
        422,
        'billing_open_invoice',
        'Há uma fatura vencida. Pague antes de trocar de plano.',
      );
    }

    // Descer de plano (ou voltar ao grátis): vale quando o período pago acabar.
    if (paying && targetPrice < currentPrice) {
      await this.assertFits(tx, target);
      await tx
        .insert(tenantBilling)
        .values({ tenantId, pendingPlanId: target.id, paidUntil: billing!.paidUntil })
        .onConflictDoUpdate({
          target: tenantBilling.tenantId,
          set: { pendingPlanId: target.id, updatedAt: now },
        });
      await tx.insert(tenantEvents).values({
        id: uuidv7(),
        tenantId,
        kind: 'plan_change_scheduled',
        data: { from: current?.id, to: target.id, at: billing!.paidUntil!.toISOString() },
      });
      return null;
    }

    if (target.priceCents === null || targetPrice <= 0) {
      throw new AppError(
        422,
        'plan_without_price',
        target.priceCents === null
          ? `O plano ${target.name} ainda não tem preço definido. Fale com a equipe Bipaê.`
          : 'Para ficar no plano grátis não precisa fazer nada: ao fim do teste, a conta segue nele.',
      );
    }
    if (paying && target.id === tenant.planId) {
      if (billing?.pendingPlanId) {
        await tx
          .update(tenantBilling)
          .set({ pendingPlanId: null, updatedAt: now })
          .where(eq(tenantBilling.tenantId, tenantId));
        return null;
      }
      throw new AppError(422, 'plan_same', 'Este já é o seu plano.');
    }
    await this.assertFits(tx, target);

    if (open) await this.cancelOpen(tx);

    if (paying && targetPrice > currentPrice) {
      // Subir de plano: paga a diferença do que falta do período; o plano muda na hora do pagamento.
      const periodEnd = billing!.paidUntil!;
      const amount = prorateUpgradeCents({
        currentPriceCents: currentPrice,
        newPriceCents: targetPrice,
        periodStart: addMonths(periodEnd, -1),
        periodEnd,
        now,
      });
      if (amount <= 0) {
        throw new AppError(
          422,
          'upgrade_too_late',
          'O período pago está acabando. Aguarde a próxima fatura.',
        );
      }
      return this.insertInvoice(tx, tenantId, {
        planId: target.id,
        kind: 'upgrade',
        amountCents: amount,
        periodStart: addMonths(periodEnd, -1),
        periodEnd,
        dueAt: new Date(now.getTime() + FIRST_INVOICE_DAYS * DAY_MS),
      });
    }

    // Assinatura nova (teste, grátis ou período vencido): mensalidade cheia a partir de agora.
    await tx
      .insert(tenantBilling)
      .values({ tenantId, pendingPlanId: null })
      .onConflictDoUpdate({
        target: tenantBilling.tenantId,
        set: { pendingPlanId: null, updatedAt: now },
      });
    return this.insertInvoice(tx, tenantId, {
      planId: target.id,
      kind: 'subscription',
      amountCents: targetPrice,
      periodStart: now,
      periodEnd: addMonths(now, 1),
      dueAt: new Date(now.getTime() + FIRST_INVOICE_DAYS * DAY_MS),
    });
  }

  async cancelPendingChange(tx: Tx, now: Date = new Date()) {
    await tx.update(tenantBilling).set({ pendingPlanId: null, updatedAt: now });
  }

  private async insertInvoice(
    tx: Tx,
    tenantId: string,
    v: {
      planId: string;
      kind: InvoiceRow['kind'];
      amountCents: number;
      periodStart: Date;
      periodEnd: Date;
      dueAt: Date;
    },
  ): Promise<InvoiceView> {
    const [row] = await tx
      .insert(planInvoices)
      .values({ id: uuidv7(), tenantId, ...v })
      .returning();
    return this.toView(tx, row!);
  }

  // ------------------------------------------------------------------ cobrança Pix

  private async payerOf(tx: Tx, userId: string): Promise<BillingPayer> {
    const [user] = await tx
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    const [company] = await tx
      .select({ taxId: companies.taxId })
      .from(companies)
      .where(isNotNull(companies.taxId))
      .limit(1);
    return {
      name: user?.name ?? 'Cliente Bipaê',
      email: user?.email ?? 'sem-email@bipae.com.br',
      taxId: company?.taxId ?? null,
    };
  }

  /** Gera (ou renova, se venceu) o Pix da fatura em aberto. */
  async ensureCharge(
    tx: Tx,
    userId: string,
    invoiceId: string,
    now: Date = new Date(),
  ): Promise<InvoiceView> {
    const gateway = this.holder.gateway;
    if (!gateway) {
      throw new AppError(
        422,
        'billing_not_configured',
        this.holder.view.message ?? 'Cobrança não configurada.',
      );
    }
    const [invoice] = await tx.select().from(planInvoices).where(eq(planInvoices.id, invoiceId));
    if (!invoice) throw notFound('Fatura');
    if (invoice.status !== 'open')
      throw new AppError(422, 'invoice_closed', 'Esta fatura não está em aberto.');
    if (invoice.chargeId && invoice.copyPaste) return this.toView(tx, invoice);
    const charge = await gateway.create({
      reference: invoice.id,
      amountCents: invoice.amountCents,
      description: `Bipaê - ${await this.planName(tx, invoice.planId)}`,
      expiresAt: new Date(now.getTime() + CHARGE_VALID_MS),
      payer: await this.payerOf(tx, userId),
    });
    const [row] = await tx
      .update(planInvoices)
      .set({ provider: gateway.mode, chargeId: charge.id, copyPaste: charge.copyPaste })
      .where(eq(planInvoices.id, invoiceId))
      .returning();
    return this.toView(tx, row!);
  }

  /** Simulador: faz de conta que pagou. Recusado fora do modo de teste. */
  simulatePay(invoice: InvoiceRow): void {
    const gateway = this.holder.gateway;
    if (!gateway?.simulatePay || !invoice.chargeId || !gateway.simulatePay(invoice.chargeId)) {
      throw new AppError(
        422,
        'billing_not_simulated',
        'O pagamento simulado só existe no modo de teste.',
      );
    }
  }

  // ------------------------------------------------------------------ ciclo (plataforma)

  /** Consulta o meio de pagamento das faturas em aberto e aplica as pagas. */
  async settle(tx: Tx, now: Date, tenantId?: string): Promise<number> {
    const gateway = this.holder.gateway;
    if (!gateway) return 0;
    const rows = await tx
      .select()
      .from(planInvoices)
      .where(
        and(
          eq(planInvoices.status, 'open'),
          isNotNull(planInvoices.chargeId),
          ...(tenantId ? [eq(planInvoices.tenantId, tenantId)] : []),
        ),
      )
      .limit(500);
    let paid = 0;
    for (const invoice of rows) {
      if (invoice.checkedAt && now.getTime() - invoice.checkedAt.getTime() < CHECK_EVERY_MS)
        continue;
      let charge;
      try {
        charge = await gateway.get(invoice.chargeId!);
      } catch {
        continue; // meio fora do ar: a próxima rodada tenta de novo
      }
      if (charge.status === 'paid') {
        await this.applyPaid(tx, invoice, now);
        paid++;
      } else if (charge.status === 'expired' || charge.status === 'canceled') {
        // O QR venceu: o cliente pede outro.
        await tx
          .update(planInvoices)
          .set({ chargeId: null, copyPaste: null, checkedAt: now })
          .where(eq(planInvoices.id, invoice.id));
      } else {
        await tx
          .update(planInvoices)
          .set({ checkedAt: now })
          .where(eq(planInvoices.id, invoice.id));
      }
    }
    return paid;
  }

  /** Fatura paga: encerra a fatura, muda o plano, estende o período e libera a conta. */
  async applyPaid(tx: Tx, invoice: InvoiceRow, now: Date) {
    const [marked] = await tx
      .update(planInvoices)
      .set({ status: 'paid', paidAt: now })
      .where(and(eq(planInvoices.id, invoice.id), eq(planInvoices.status, 'open')))
      .returning({ id: planInvoices.id });
    if (!marked) return; // já aplicada: rodar duas vezes não estraga
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, invoice.tenantId));
    if (!tenant) return;
    const reactivate =
      tenant.status === 'trial' ||
      (tenant.status === 'suspended' && tenant.statusReason === BILLING_SUSPENSION_REASON);
    await tx
      .update(tenants)
      .set({
        planId: invoice.planId,
        trialEndsAt: null,
        ...(reactivate && { status: 'active', statusReason: null, statusChangedAt: now }),
      })
      .where(eq(tenants.id, tenant.id));
    if (invoice.kind === 'subscription') {
      const end =
        invoice.periodEnd && invoice.periodEnd.getTime() > now.getTime()
          ? invoice.periodEnd
          : addMonths(now, 1);
      await tx
        .insert(tenantBilling)
        .values({ tenantId: tenant.id, paidUntil: end, pendingPlanId: null })
        .onConflictDoUpdate({
          target: tenantBilling.tenantId,
          set: { paidUntil: end, pendingPlanId: null, updatedAt: now },
        });
    }
    const events = [
      {
        kind: 'billing_paid',
        data: { planId: invoice.planId, amountCents: invoice.amountCents, invoiceId: invoice.id },
      },
      ...(tenant.planId !== invoice.planId
        ? [{ kind: 'plan_changed', data: { from: tenant.planId, to: invoice.planId } }]
        : []),
      ...(reactivate ? [{ kind: 'reactivated', data: { reason: 'Pagamento confirmado' } }] : []),
    ];
    for (const e of events) {
      await tx.insert(tenantEvents).values({ id: uuidv7(), tenantId: tenant.id, ...e });
    }
  }

  /** Gera a fatura da próxima mensalidade `BILLING_ADVANCE_DAYS` antes do fim do período. */
  async generateRenewals(tx: Tx, now: Date, tenantId?: string): Promise<number> {
    const limit = new Date(now.getTime() + this.config.BILLING_ADVANCE_DAYS * DAY_MS);
    const due = await tx
      .select({ billing: tenantBilling, tenant: tenants })
      .from(tenantBilling)
      .innerJoin(tenants, eq(tenants.id, tenantBilling.tenantId))
      .where(
        and(
          isNotNull(tenantBilling.paidUntil),
          lt(tenantBilling.paidUntil, limit),
          eq(tenants.status, 'active'),
          sql`not exists (select 1 from plan_invoices i where i.tenant_id = ${tenantBilling.tenantId} and i.status = 'open')`,
          ...(tenantId ? [eq(tenants.id, tenantId)] : []),
        ),
      )
      .limit(500);
    let created = 0;
    for (const { billing, tenant } of due) {
      const planId = billing.pendingPlanId ?? tenant.planId;
      const [plan] = await tx.select().from(plans).where(eq(plans.id, planId));
      const price = plan ? this.price(plan) : 0;
      const paidUntil = billing.paidUntil!;
      if (price <= 0) {
        // Troca para o grátis: assim que o período acaba, a conta passa para ele sem cobrança.
        if (paidUntil.getTime() <= now.getTime()) {
          await tx.update(tenants).set({ planId }).where(eq(tenants.id, tenant.id));
          await tx
            .update(tenantBilling)
            .set({ paidUntil: null, pendingPlanId: null, updatedAt: now })
            .where(eq(tenantBilling.tenantId, tenant.id));
          await tx.insert(tenantEvents).values({
            id: uuidv7(),
            tenantId: tenant.id,
            kind: 'plan_changed',
            data: { from: tenant.planId, to: planId },
          });
        }
        continue;
      }
      await tx.insert(planInvoices).values({
        id: uuidv7(),
        tenantId: tenant.id,
        planId,
        kind: 'subscription',
        amountCents: price,
        periodStart: paidUntil,
        periodEnd: addMonths(paidUntil, 1),
        dueAt: paidUntil,
      });
      created++;
    }
    return created;
  }

  /** Bloqueio gentil: fatura vencida além da tolerância suspende a conta (vendas offline seguem). */
  async blockOverdue(tx: Tx, now: Date, tenantId?: string): Promise<string[]> {
    const limit = new Date(now.getTime() - this.config.BILLING_GRACE_DAYS * DAY_MS);
    const overdue = await tx
      .select({ invoice: planInvoices, tenant: tenants })
      .from(planInvoices)
      .innerJoin(tenants, eq(tenants.id, planInvoices.tenantId))
      .innerJoin(tenantBilling, eq(tenantBilling.tenantId, planInvoices.tenantId))
      .where(
        and(
          eq(planInvoices.status, 'open'),
          eq(planInvoices.kind, 'subscription'),
          lt(planInvoices.dueAt, limit),
          eq(tenants.status, 'active'),
          isNotNull(tenantBilling.paidUntil),
          ...(tenantId ? [eq(tenants.id, tenantId)] : []),
        ),
      )
      .limit(500);
    for (const { tenant, invoice } of overdue) {
      await tx
        .update(tenants)
        .set({ status: 'suspended', statusReason: BILLING_SUSPENSION_REASON, statusChangedAt: now })
        .where(eq(tenants.id, tenant.id));
      await tx.insert(tenantEvents).values({
        id: uuidv7(),
        tenantId: tenant.id,
        kind: 'billing_blocked',
        data: { invoiceId: invoice.id, reason: BILLING_SUSPENSION_REASON },
      });
    }
    return overdue.map((o) => o.tenant.id);
  }

  /** Rodada completa do ciclo, dentro da transação da plataforma. */
  async runCycle(tx: Tx, now: Date, tenantId?: string) {
    const paid = await this.settle(tx, now, tenantId);
    const created = await this.generateRenewals(tx, now, tenantId);
    const blocked = await this.blockOverdue(tx, now, tenantId);
    return { paid, created, blocked: blocked.length };
  }
}
