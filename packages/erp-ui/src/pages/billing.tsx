import {
  BILLING_STATE_LABELS,
  formatBRL,
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  type AccountView,
  type BillingView,
  type Cents,
  type InvoiceView,
} from '@bipae/domain';
import { Alert, Badge, Button, Card } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const day = (iso: string) => dateOnly.format(new Date(iso));

const STATE_TONE = {
  none: 'neutral',
  ok: 'success',
  due_soon: 'warning',
  grace: 'warning',
  blocked: 'danger',
} as const;

/** Mensagem da situação da cobrança, no tom do Bipaê: direto, sem susto. */
function stateMessage(b: BillingView): string | null {
  const open = b.openInvoice;
  switch (b.state) {
    case 'due_soon':
      return open ? `Sua próxima fatura vence em ${day(open.dueAt)}.` : null;
    case 'grace':
      return open
        ? `A fatura venceu em ${day(open.dueAt)}. Tudo segue funcionando por mais alguns dias (até ${b.graceDays} depois do vencimento); pague para não pausar o acesso.`
        : null;
    case 'blocked':
      return 'O acesso à retaguarda está pausado por falta de pagamento. Suas vendas no caixa sem internet continuam e nada se perde. Pagando a fatura, a conta volta na hora.';
    default:
      return null;
  }
}

/**
 * Cobrança do plano (F6-04): fatura em aberto com Pix copia e cola, troca de plano e histórico.
 * Os preços vêm da tabela de planos; plano sem preço definido não pode ser contratado por aqui.
 */
export function BillingSection({
  plans,
  currentPlanId,
}: {
  plans: AccountView['plans'];
  currentPlanId: string;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canManage = useCan('admin.users');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingView>('/account/billing'),
    // Com fatura aberta, confere o pagamento de tempos em tempos.
    refetchInterval: (q) => (q.state.data?.openInvoice?.copyPaste ? 8000 : false),
  });
  const b = billing.data;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['billing'] });
      await queryClient.invalidateQueries({ queryKey: ['account'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (billing.error) return <Alert>{(billing.error as Error).message}</Alert>;
  if (!b) return null;
  const message = stateMessage(b);
  const open = b.openInvoice;

  return (
    <Card className="xl:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Cobrança do plano</h2>
        <Badge tone={STATE_TONE[b.state]}>{BILLING_STATE_LABELS[b.state]}</Badge>
      </div>
      {b.paidUntil && (
        <p className="mt-1 text-sm text-muted">Período pago até {day(b.paidUntil)}.</p>
      )}
      {message && <Alert tone={b.state === 'blocked' ? 'danger' : 'warning'}>{message}</Alert>}
      {b.gateway.mode === 'off' && <Alert tone="warning">{b.gateway.message}</Alert>}
      {b.gateway.mode === 'simulator' && <Alert tone="warning">{b.gateway.message}</Alert>}
      {error && <Alert>{error}</Alert>}
      {b.pendingPlan && (
        <Alert tone="success" title="Troca agendada">
          Você passa para o plano {b.pendingPlan.name} quando o período pago acabar
          {b.paidUntil ? ` (${day(b.paidUntil)})` : ''}.{' '}
          {canManage && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                void run('cancel', () => api.delete('/account/billing/pending-change'))
              }
            >
              Desfazer
            </button>
          )}
        </Alert>
      )}

      {open && (
        <OpenInvoice
          invoice={open}
          gatewayMode={b.gateway.mode}
          canManage={canManage}
          busy={busy}
          onPix={() =>
            void run('pix', () => api.post(`/account/billing/invoices/${open.id}/pix`, {}))
          }
          onCheck={() =>
            void run('check', () => api.post(`/account/billing/invoices/${open.id}/check`, {}))
          }
          onSimulate={() =>
            void run('sim', () => api.post(`/account/billing/invoices/${open.id}/simulate-pay`, {}))
          }
        />
      )}

      <h3 className="mb-2 mt-5 font-semibold">Trocar de plano</h3>
      <ul className="divide-y divide-border">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="text-sm text-muted tabular-nums">
                  {p.priceCents === null
                    ? 'preço no lançamento'
                    : p.priceCents === 0
                      ? 'Grátis'
                      : `${formatBRL(p.priceCents as Cents)} por mês`}
                </span>
              </span>
              {isCurrent ? (
                <Badge tone="success">Seu plano</Badge>
              ) : p.priceCents === null ? (
                <span className="text-sm text-muted">Chega em breve</span>
              ) : (
                canManage && (
                  <Button
                    variant="secondary"
                    loading={busy === `plan-${p.id}`}
                    onClick={() =>
                      void run(`plan-${p.id}`, () =>
                        api.post('/account/billing/subscribe', { planId: p.id }),
                      )
                    }
                  >
                    {p.priceCents === 0 ? 'Voltar ao grátis' : 'Escolher'}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm text-muted">
        Ao subir de plano no meio do período, você paga só a diferença do que falta. Ao descer, a
        troca vale quando o período pago acabar. Cartão de crédito recorrente chega em breve; por
        enquanto o pagamento é por Pix.
      </p>

      {b.invoices.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 font-semibold">Faturas</h3>
          <ul className="divide-y divide-border">
            {b.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>
                  {INVOICE_KIND_LABELS[i.kind]} · {i.planName} · vence {day(i.dueAt)}
                </span>
                <span className="tabular-nums">
                  {formatBRL(i.amountCents as Cents)}{' '}
                  <Badge
                    tone={
                      i.status === 'paid' ? 'success' : i.status === 'open' ? 'warning' : 'neutral'
                    }
                  >
                    {INVOICE_STATUS_LABELS[i.status]}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function OpenInvoice({
  invoice,
  gatewayMode,
  canManage,
  busy,
  onPix,
  onCheck,
  onSimulate,
}: {
  invoice: InvoiceView;
  gatewayMode: BillingView['gateway']['mode'];
  canManage: boolean;
  busy: string | null;
  onPix: () => void;
  onCheck: () => void;
  onSimulate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!invoice.copyPaste) return;
    try {
      await navigator.clipboard.writeText(invoice.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2 p-4">
      <p className="font-semibold">
        {INVOICE_KIND_LABELS[invoice.kind]} do plano {invoice.planName}:{' '}
        {formatBRL(invoice.amountCents as Cents)}
      </p>
      <p className="text-sm text-muted">Vence em {day(invoice.dueAt)}.</p>
      {invoice.copyPaste ? (
        <>
          <p className="mt-3 text-sm">Pix copia e cola:</p>
          <textarea
            readOnly
            aria-label="Pix copia e cola"
            className="mt-1 w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs"
            rows={3}
            value={invoice.copyPaste}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>{copied ? 'Copiado!' : 'Copiar código'}</Button>
            <Button variant="secondary" loading={busy === 'check'} onClick={onCheck}>
              Já paguei
            </Button>
            {gatewayMode === 'simulator' && canManage && (
              <Button variant="secondary" loading={busy === 'sim'} onClick={onSimulate}>
                Simular pagamento
              </Button>
            )}
          </div>
          <p className="mt-2 text-sm text-muted">
            A confirmação é automática, em poucos minutos depois de pagar.
          </p>
        </>
      ) : (
        canManage &&
        gatewayMode !== 'off' && (
          <Button className="mt-3" loading={busy === 'pix'} onClick={onPix}>
            Gerar Pix
          </Button>
        )
      )}
    </div>
  );
}
