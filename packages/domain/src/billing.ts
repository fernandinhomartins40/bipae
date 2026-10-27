import { z } from 'zod';

/**
 * Cobrança automática dos planos (F6-04). Regras puras do ciclo mensal: nenhum preço mora aqui.
 * O preço de cada plano vem da tabela `plans` (configurável no painel; o E8 ainda não decidiu).
 */

/** Tolerância padrão depois do vencimento, antes do bloqueio gentil (BILLING_GRACE_DAYS). */
export const DEFAULT_BILLING_GRACE_DAYS = 5;
/** Quantos dias antes do fim do período a próxima fatura é gerada (BILLING_ADVANCE_DAYS). */
export const DEFAULT_BILLING_ADVANCE_DAYS = 7;
/** Motivo gravado na suspensão por mensalidade em aberto; só ele é desfeito pelo pagamento. */
export const BILLING_SUSPENSION_REASON = 'Mensalidade em aberto';

export const INVOICE_STATUSES = ['open', 'paid', 'canceled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** `subscription`: mensalidade cheia; `upgrade`: diferença proporcional de uma troca para cima. */
export const INVOICE_KINDS = ['subscription', 'upgrade'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  subscription: 'Mensalidade',
  upgrade: 'Troca de plano',
};
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: 'Em aberto',
  paid: 'Paga',
  canceled: 'Cancelada',
};

/** Situação da cobrança vista pelo cliente. */
export type BillingState =
  /** Sem mensalidade (plano grátis ou ainda sem plano pago). */
  | 'none'
  | 'ok'
  /** Fatura aberta ainda dentro do prazo. */
  | 'due_soon'
  /** Venceu, dentro da tolerância: tudo funciona, com aviso. */
  | 'grace'
  /** Passou da tolerância: conta em bloqueio gentil (só vendas offline e a tela de assinatura). */
  | 'blocked';

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  none: 'Sem mensalidade',
  ok: 'Em dia',
  due_soon: 'Fatura a pagar',
  grace: 'Vencida, dentro do prazo de tolerância',
  blocked: 'Bloqueada por falta de pagamento',
};

const DAY_MS = 86_400_000;

/** Soma meses no calendário UTC; dia 31 em mês curto cai no último dia do mês de destino. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

/**
 * Valor da troca para um plano mais caro no meio do período: a diferença de preço vezes a parte
 * do período que ainda falta, com arredondamento para o centavo mais próximo (metade para cima).
 * Aritmética inteira, nunca ponto flutuante (ADR-0008).
 */
export function prorateUpgradeCents(input: {
  currentPriceCents: number;
  newPriceCents: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): number {
  const diff = BigInt(input.newPriceCents - input.currentPriceCents);
  if (diff <= 0n) return 0;
  const total = BigInt(input.periodEnd.getTime() - input.periodStart.getTime());
  if (total <= 0n) return 0;
  const remainingRaw =
    input.periodEnd.getTime() - Math.max(input.now.getTime(), input.periodStart.getTime());
  const remaining = BigInt(Math.max(0, remainingRaw));
  const value = (diff * remaining * 2n + total) / (total * 2n);
  return Number(value);
}

/** Situação da cobrança a partir da fatura em aberto mais antiga (vencimento) e da tolerância. */
export function billingState(input: {
  hasPaidPlan: boolean;
  openInvoiceDueAt: Date | null;
  now: Date;
  graceDays: number;
}): BillingState {
  if (input.openInvoiceDueAt) {
    const due = input.openInvoiceDueAt.getTime();
    if (input.now.getTime() <= due) return 'due_soon';
    if (input.now.getTime() <= due + input.graceDays * DAY_MS) return 'grace';
    return 'blocked';
  }
  return input.hasPaidPlan ? 'ok' : 'none';
}

export const subscribeInput = z.object({ planId: z.string().trim().min(1).max(60) });

/** Meio de cobrança do Bipaê (conta da plataforma, não da loja). */
export interface BillingGatewayView {
  mode: 'simulator' | 'pix' | 'off';
  /** Pix recorrente com cartão salvo ainda não existe: aparece como "chega em breve". */
  cardAvailable: false;
  message: string | null;
}

export interface InvoiceView {
  id: string;
  kind: InvoiceKind;
  planId: string;
  planName: string;
  amountCents: number;
  status: InvoiceStatus;
  dueAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  /** Pix copia e cola da cobrança, quando já foi gerada. */
  copyPaste: string | null;
  createdAt: string;
}

export interface BillingView {
  gateway: BillingGatewayView;
  state: BillingState;
  graceDays: number;
  /** Até quando o período pago vale. */
  paidUntil: string | null;
  /** Troca para um plano mais barato, aplicada quando o período pago acabar. */
  pendingPlan: { id: string; name: string } | null;
  openInvoice: InvoiceView | null;
  invoices: InvoiceView[];
}

/** Cobrança como o painel da plataforma enxerga cada cliente. */
export interface TenantBillingSummary {
  state: BillingState;
  paidUntil: string | null;
  openInvoiceAmountCents: number | null;
  openInvoiceDueAt: string | null;
}
