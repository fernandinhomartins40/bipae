import {
  cents,
  formatBRL,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type FinancialEntryView,
  type FinancialSummary,
  type Page,
  type Party,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

type Kind = 'payable' | 'receivable';
const KIND_LABEL: Record<Kind, string> = { payable: 'A pagar', receivable: 'A receber' };

/** Contas a pagar e a receber (F4-04). */
export function FinancePage() {
  const { api } = useApp();
  const canWrite = useCan('finance.write');
  const [kind, setKind] = useState<Kind>('payable');
  const [status, setStatus] = useState<'open' | 'paid' | 'cancelled' | ''>('open');
  const [editing, setEditing] = useState<FinancialEntryView | 'new' | null>(null);
  const summary = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => api.get<FinancialSummary>('/finance/entries/summary'),
  });
  const list = useQuery({
    queryKey: ['finance', 'list', kind, status],
    queryFn: () =>
      api.get<FinancialEntryView[]>(
        `/finance/entries?kind=${kind}${status ? `&status=${status}` : ''}`,
      ),
  });
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Contas a pagar e receber"
        description="O que vence, o que já foi pago e o que está atrasado."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Nova conta
            </Button>
          )
        }
      />
      {s && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {(['payable', 'receivable'] as const).map((k) => (
            <Card key={k}>
              <h2 className="font-bold">{KIND_LABEL[k]}</h2>
              <p className="text-2xl font-bold tabular-nums" data-testid={`open-${k}`}>
                {brl(s[k].openCents)}
              </p>
              <p className="text-sm text-muted">
                Vence em 7 dias: {brl(s[k].dueNext7Cents)}
                {s[k].overdueCents > 0 && (
                  <span className="ml-2 font-semibold text-danger">
                    Vencido: {brl(s[k].overdueCents)}
                  </span>
                )}
              </p>
            </Card>
          ))}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-4">
        <SelectField
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          options={[
            { value: 'payable', label: 'Contas a pagar' },
            { value: 'receivable', label: 'Contas a receber' },
          ]}
        />
        <SelectField
          label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          options={[
            { value: 'open', label: 'Em aberto' },
            { value: 'paid', label: 'Pagas' },
            { value: 'cancelled', label: 'Canceladas' },
            { value: '', label: 'Todas' },
          ]}
        />
      </div>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && list.data.length === 0 ? (
        <EmptyState title="Nada por aqui">
          Lance as contas para acompanhar os vencimentos.
        </EmptyState>
      ) : (
        list.data && (
          <DataTable
            caption={kind === 'payable' ? 'Contas a pagar' : 'Contas a receber'}
            rows={list.data}
            onRowClick={setEditing}
            columns={[
              { header: 'Vencimento', cell: (e) => day(e.dueDate) },
              {
                header: 'Descrição',
                cell: (e) => (
                  <span>
                    <span className="font-semibold">{e.description}</span>
                    {e.installments > 1 && ` (${e.installment}/${e.installments})`}
                    {e.partyName && <span className="block text-sm text-muted">{e.partyName}</span>}
                  </span>
                ),
              },
              { header: 'Valor', align: 'right', cell: (e) => brl(e.amountCents) },
              {
                header: 'Situação',
                cell: (e) =>
                  e.status === 'paid' ? (
                    <Badge tone="success">Paga em {e.paidAt ? day(e.paidAt) : ''}</Badge>
                  ) : e.status === 'cancelled' ? (
                    <Badge tone="neutral">Cancelada</Badge>
                  ) : e.overdue ? (
                    <Badge tone="danger">Vencida</Badge>
                  ) : (
                    <Badge tone="warning">Em aberto</Badge>
                  ),
              },
            ]}
          />
        )
      )}
      {editing === 'new' && <NewEntry kind={kind} onClose={() => setEditing(null)} />}
      {editing && editing !== 'new' && (
        <EntryDrawer entry={editing} canWrite={canWrite} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['finance'] });
}

function NewEntry({ kind: initial, onClose }: { kind: Kind; onClose: () => void }) {
  const { api } = useApp();
  const refresh = useRefresh();
  const [kind, setKind] = useState<Kind>(initial);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [partyId, setPartyId] = useState('');
  const [document, setDocument] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState(today());
  const [installments, setInstallments] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parties = useQuery({
    queryKey: [kind === 'payable' ? 'supplier' : 'customer', 'all'],
    queryFn: () =>
      api.get<Page<Party>>(`/${kind === 'payable' ? 'suppliers' : 'customers'}?limit=100`),
  });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/finance/entries', {
        kind,
        description,
        category: category || null,
        ...(partyId && (kind === 'payable' ? { supplierId: partyId } : { customerId: partyId })),
        document: document || null,
        amountCents: amount ?? 0,
        dueDate,
        installments: Number(installments) || 1,
      });
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Nova conta">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <SelectField
          label="Tipo"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setPartyId('');
          }}
          options={[
            { value: 'payable', label: 'A pagar' },
            { value: 'receivable', label: 'A receber' },
          ]}
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          autoFocus
        />
        <SelectField
          label={kind === 'payable' ? 'Fornecedor (opcional)' : 'Cliente (opcional)'}
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
          options={[
            { value: '', label: 'Nenhum' },
            ...(parties.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Categoria"
            placeholder="Ex.: Aluguel, Energia, Mercadoria"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <TextField
            label="Documento"
            placeholder="Nota, boleto..."
            value={document}
            onChange={(e) => setDocument(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyField label="Valor total" value={amount} onChange={setAmount} required />
          <TextField
            label="Primeiro vencimento"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <TextField
            label="Parcelas"
            inputMode="numeric"
            value={installments}
            onChange={(e) => setInstallments(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <p className="text-sm text-muted">Parcelas mensais, no mesmo dia do primeiro vencimento.</p>
        <Button loading={busy} onClick={() => void save()}>
          Lançar conta
        </Button>
      </div>
    </Drawer>
  );
}

function EntryDrawer({
  entry,
  canWrite,
  onClose,
}: {
  entry: FinancialEntryView;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { api } = useApp();
  const refresh = useRefresh();
  const [paidAt, setPaidAt] = useState(today());
  const [paid, setPaid] = useState<number | null>(entry.amountCents);
  const [method, setMethod] = useState('pix');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = entry.status === 'open';
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${entry.description}${entry.installments > 1 ? ` (${entry.installment}/${entry.installments})` : ''}`}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <p>
          {entry.kind === 'payable' ? 'A pagar' : 'A receber'} · {brl(entry.amountCents)} · vence em{' '}
          {day(entry.dueDate)}
          {entry.partyName && ` · ${entry.partyName}`}
          {entry.document && ` · ${entry.document}`}
        </p>
        {entry.status === 'paid' && (
          <p className="text-success">
            {entry.kind === 'payable' ? 'Paga' : 'Recebida'} em {entry.paidAt && day(entry.paidAt)}:{' '}
            {brl(entry.paidCents ?? 0)}
          </p>
        )}
        {entry.status === 'cancelled' && (
          <p className="text-muted">Cancelada: {entry.cancelReason}</p>
        )}
        {open && canWrite && (
          <section
            aria-label="Dar baixa"
            className="flex flex-col gap-3 rounded-ui bg-surface-2 p-4"
          >
            <h3 className="font-semibold">
              {entry.kind === 'payable' ? 'Registrar pagamento' : 'Registrar recebimento'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Data"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              <MoneyField label="Valor pago" value={paid} onChange={setPaid} required />
              <SelectField
                label="Forma"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                options={[
                  ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] })),
                  { value: 'boleto', label: 'Boleto' },
                  { value: 'transferencia', label: 'Transferência' },
                ]}
              />
            </div>
            <p className="text-sm text-muted">
              Com juros ou desconto, informe o valor que de fato saiu ou entrou.
            </p>
            <Button
              loading={busy}
              onClick={() =>
                void run(() =>
                  api.post(`/finance/entries/${entry.id}/pay`, {
                    paidAt,
                    paidCents: paid ?? 0,
                    paymentMethod: method,
                  }),
                )
              }
            >
              {entry.kind === 'payable' ? 'Confirmar pagamento' : 'Confirmar recebimento'}
            </Button>
          </section>
        )}
        {open && canWrite && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <TextField
              label="Motivo do cancelamento"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="ghost"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() =>
                void run(() =>
                  api.post(`/finance/entries/${entry.id}/cancel`, { reason: reason.trim() }),
                )
              }
            >
              Cancelar conta
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
