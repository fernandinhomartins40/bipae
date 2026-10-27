import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { subscribeInput, type BillingView, type InvoiceView } from '@bipae/domain';
import { eq } from 'drizzle-orm';
import { Ctx, RequirePermission, type RequestContext } from '../../common/auth';
import { DB, QUEUE } from '../../common/di';
import { notFound, parse } from '../../common/errors';
import type { JobQueue } from '../../common/queue';
import { withTenant, type Db } from '../../db/client';
import { planInvoices } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { BillingService } from './billing.service';

/** Fila que confirma pagamentos e roda o ciclo (a rotina fica em modules/maintenance). */
export const BILLING_SWEEP = 'manutencao.cobranca-dos-planos';

/**
 * "Minha assinatura": o cliente vê as faturas, escolhe o plano e paga por Pix (F6-04). Fica sob
 * /account, então a conta em bloqueio gentil ainda chega aqui para pagar. Quem muda o plano de
 * verdade é a manutenção, depois que o meio de pagamento confirma.
 */
@Controller('account/billing')
export class BillingController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: JobQueue,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  get(@Ctx() ctx: RequestContext): Promise<BillingView> {
    return withTenant(this.db, ctx, (tx) => this.billing.view(tx));
  }

  @Post('subscribe')
  @RequirePermission('admin.users')
  async subscribe(
    @Ctx() ctx: RequestContext,
    @Body() body: unknown,
  ): Promise<{ invoice: InvoiceView | null; billing: BillingView }> {
    const input = parse(subscribeInput, body);
    return withTenant(this.db, ctx, async (tx) => {
      const invoice = await this.billing.subscribe(tx, ctx.tenantId, input.planId);
      await this.audit.record(tx, ctx, {
        action: invoice ? 'billing.subscribe' : 'billing.schedule_plan_change',
        entity: 'plan',
        entityId: input.planId,
        data: invoice ? { invoiceId: invoice.id, amountCents: invoice.amountCents } : undefined,
      });
      return { invoice, billing: await this.billing.view(tx) };
    });
  }

  @Delete('pending-change')
  @RequirePermission('admin.users')
  async cancelChange(@Ctx() ctx: RequestContext): Promise<BillingView> {
    return withTenant(this.db, ctx, async (tx) => {
      await this.billing.cancelPendingChange(tx);
      await this.audit.record(tx, ctx, { action: 'billing.cancel_plan_change', entity: 'plan' });
      return this.billing.view(tx);
    });
  }

  /** Gera o Pix da fatura em aberto. */
  @Post('invoices/:id/pix')
  @RequirePermission('admin.users')
  pix(@Ctx() ctx: RequestContext, @Param('id') id: string): Promise<InvoiceView> {
    return withTenant(this.db, ctx, (tx) => this.billing.ensureCharge(tx, ctx.userId, id));
  }

  /** Pede a conferência do pagamento já; a confirmação (e a troca do plano) vem da manutenção. */
  @Post('invoices/:id/check')
  async check(@Ctx() ctx: RequestContext, @Param('id') id: string): Promise<BillingView> {
    const view = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(planInvoices).where(eq(planInvoices.id, id));
      if (!row) throw notFound('Fatura');
      return this.billing.view(tx);
    });
    await this.queue.add(BILLING_SWEEP, { tenantId: ctx.tenantId }).catch(() => undefined);
    return view;
  }

  /** Só no modo de teste: marca a cobrança do simulador como paga. */
  @Post('invoices/:id/simulate-pay')
  @RequirePermission('admin.users')
  async simulatePay(@Ctx() ctx: RequestContext, @Param('id') id: string): Promise<BillingView> {
    const view = await withTenant(this.db, ctx, async (tx) => {
      const [row] = await tx.select().from(planInvoices).where(eq(planInvoices.id, id));
      if (!row) throw notFound('Fatura');
      this.billing.simulatePay(row);
      return this.billing.view(tx);
    });
    await this.queue.add(BILLING_SWEEP, { tenantId: ctx.tenantId }).catch(() => undefined);
    return view;
  }
}
