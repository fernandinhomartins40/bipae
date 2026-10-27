import {
  BILLING_STATE_LABELS,
  formatBRL,
  INVOICE_KIND_LABELS,
  INVOICE_METHOD_LABELS,
  INVOICE_STATUS_LABELS,
  type AdminBillingDetail,
  type AdminBillingRow,
  type Cents,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAdmin } from './admin-app';

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const day = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');
const brl = (c: number | null | undefined) =>
  c === null || c === undefined ? '—' : formatBRL(c as Cents);

const STATE_TONE = {
  none: 'neutral',
  ok: 'success',
  due_soon: 'warning',
  grace: 'warning',
  blocked: 'danger',
} as const;

type Filter = 'all' | 'overdue' | 'open' | 'paused';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'overdue', label: 'Em atraso' },
  { value: 'open', label: 'Com fatura em aberto' },
  { value: 'paused', label: 'Cobrança pausada' },
  { value: 'all', label: 'Todos' },
];

/** Cobrança e inadimplência de todos os clientes (F6-04.d). */
export function BillingAdminPage() {
  const { api } = useAdmin();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('overdue');
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const list = useQuery({
    queryKey: ['admin', 'billing', filter, deferred],
    queryFn: () =>
      api.get<{
        items: AdminBillingRow[];
        overdue: { count: number; amountCents: number };
      }>(
        `/admin/billing?limit=200&filter=${filter}${deferred ? `&q=${encodeURIComponent(deferred)}` : ''}`,
      ),
  });
  const data = list.data;
  return (
    <>
      <PageHeader
        title="Cobrança"
        description="Faturas, atrasos e acordos de cada cliente. Os valores vêm da tabela de planos."
      />
      {data && (
        <p className="mb-4 text-lg" data-testid="overdue-total">
          <strong>{data.overdue.count}</strong> fatura(s) vencida(s), somando{' '}
          <strong>{brl(data.overdue.amountCents)}</strong>.
        </p>
      )}
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr]">
        <input
          type="search"
          aria-label="Buscar clientes"
          placeholder="Nome do cliente"
          className="min-h-11 rounded-ui border border-border bg-surface px-3"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label="Mostrar"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          options={FILTERS}
        />
      </div>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {data && data.items.length === 0 ? (
        <EmptyState title="Nenhum cliente nesta lista" />
      ) : (
        data && (
          <DataTable
            caption="Cobrança por cliente"
            rows={data.items.map((t) => ({ ...t, id: t.tenantId }))}
            onRowClick={(t) => navigate(`/admin/clientes/${t.tenantId}`)}
            columns={[
              { header: 'Cliente', cell: (t) => <span className="font-semibold">{t.name}</span> },
              { header: 'Plano', cell: (t) => t.planName },
              {
                header: 'Situação',
                cell: (t) => (
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={STATE_TONE[t.state]}>{BILLING_STATE_LABELS[t.state]}</Badge>
                    {t.paused && <Badge tone="warning">Pausada</Badge>}
                  </span>
                ),
              },
              { header: 'Pago até', cell: (t) => day(t.paidUntil) },
              {
                header: 'Fatura em aberto',
                align: 'right',
                cell: (t) => brl(t.openInvoiceAmountCents),
              },
              { header: 'Vence em', cell: (t) => day(t.openInvoiceDueAt) },
              {
                header: 'Atraso',
                align: 'right',
                cell: (t) => (t.daysLate > 0 ? `${t.daysLate} dia(s)` : '—'),
              },
            ]}
          />
        )
      )}
    </>
  );
}

type Action = null | 'pause' | { waive: string };

/** Cobrança de um cliente, com pausar, retomar e perdoar fatura. Fica na página do cliente. */
export function TenantBillingPanel({ tenantId }: { tenantId: string }) {
  const { api, can } = useAdmin();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['admin', 'billing-detail', tenantId],
    queryFn: () => api.get<AdminBillingDetail>(`/admin/tenants/${tenantId}/billing`),
  });
  const d = detail.data;
  const manage = can('platform.tenants.manage');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  if (detail.error) return <Alert>{(detail.error as Error).message}</Alert>;
  if (!d) return null;

  const resume = async () => {
    setError(null);
    try {
      await api.post(`/admin/tenants/${tenantId}/billing/resume`, {});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATE_TONE[d.state]}>{BILLING_STATE_LABELS[d.state]}</Badge>
        {d.paused && <Badge tone="warning">Cobrança pausada</Badge>}
        {d.card && (
          <Badge tone="neutral">
            Cartão {d.card.brand ?? ''} final {d.card.last4 ?? '----'}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-muted">
        Período pago até {day(d.paidUntil)}.
        {d.pendingPlan ? ` Troca agendada para ${d.pendingPlan.name}.` : ''}
      </p>
      {d.paused && (
        <Alert tone="warning" title="Pausada">
          {d.pausedReason} (desde {day(d.pausedAt)}). Sem faturas novas e sem bloqueio por atraso.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {manage && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.paused ? (
            <Button variant="secondary" onClick={() => void resume()}>
              Retomar cobrança
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setAction('pause')}>
              Pausar cobrança
            </Button>
          )}
        </div>
      )}
      {d.invoices.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Este cliente ainda não tem faturas.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {d.invoices.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                {INVOICE_KIND_LABELS[i.kind]} · {i.planName} · vence {day(i.dueAt)}
                {i.method ? ` · ${INVOICE_METHOD_LABELS[i.method]}` : ''}
                {i.cardError ? ` · cartão: ${i.cardError}` : ''}
                {i.waivedReason ? ` · perdoada: ${i.waivedReason}` : ''}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {brl(i.amountCents)}
                <Badge
                  tone={
                    i.status === 'paid' ? 'success' : i.status === 'open' ? 'warning' : 'neutral'
                  }
                >
                  {INVOICE_STATUS_LABELS[i.status]}
                </Badge>
                {manage && i.status === 'open' && (
                  <Button variant="ghost" onClick={() => setAction({ waive: i.id })}>
                    Perdoar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm">
        <Link to="/admin/cobranca" className="text-primary underline">
          Ver a cobrança de todos os clientes
        </Link>
      </p>
      {action === 'pause' && (
        <ReasonModal
          title="Pausar a cobrança"
          explanation="Sem faturas novas, sem cartão cobrado e sem bloqueio por atraso. Se a conta estava bloqueada por falta de pagamento, ela volta a funcionar."
          confirm="Pausar"
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/tenants/${tenantId}/billing/pause`, { reason });
            setAction(null);
            await refresh();
          }}
        />
      )}
      {action && typeof action === 'object' && (
        <ReasonModal
          title="Perdoar a fatura"
          explanation="A fatura é cancelada e, se for a mensalidade, o período vale como pago. Fica registrado na auditoria com o motivo."
          confirm="Perdoar fatura"
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/tenants/${tenantId}/billing/invoices/${action.waive}/waive`, {
              reason,
            });
            setAction(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ReasonModal({
  title,
  explanation,
  confirm,
  onClose,
  onConfirm,
}: {
  title: string;
  explanation: string;
  confirm: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onConfirm(reason);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="text-muted">{explanation}</p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <Button type="submit">{confirm}</Button>
      </form>
    </Modal>
  );
}
