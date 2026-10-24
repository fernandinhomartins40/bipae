import {
  cents,
  formatBRL,
  formatTaxId,
  parseBRL,
  type CustomerCredit,
  type Page,
  type Party,
  type PriceTable,
} from '@bipae/domain';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  SelectField,
  EmptyState,
  FormSection,
  PageHeader,
  SearchBox,
  TaxIdField,
  TextField,
  type TileTone,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, SearchX, Truck, UserRound } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent, type ReactNode } from 'react';
import { useApp, useCan } from '../context';
import { CustomerSummaryPanel, LoyaltyPanel } from './crm';
import { useForm } from '../forms';

type Kind = 'customer' | 'supplier';

const TEXT: Record<
  Kind,
  {
    title: string;
    one: string;
    many: string;
    path: string;
    description: string;
    empty: string;
    icon: ReactNode;
    tone: TileTone;
  }
> = {
  customer: {
    title: 'Clientes',
    one: 'cliente',
    many: 'clientes',
    path: '/customers',
    description: 'Quem compra com você: contato, crediário, tabela de preço e histórico.',
    empty: 'Cadastre clientes para vender no crediário, dar CPF na nota mais rápido e fidelizar.',
    icon: <UserRound />,
    tone: 'purple',
  },
  supplier: {
    title: 'Fornecedores',
    one: 'fornecedor',
    many: 'fornecedores',
    path: '/suppliers',
    description: 'De quem você compra. Também entram sozinhos quando você importa o XML da nota.',
    empty:
      'Fornecedores também são criados automaticamente quando você importa o XML de uma nota de compra.',
    icon: <Truck />,
    tone: 'orange',
  },
};

function formatPhone(phone: string | null) {
  if (!phone) return '';
  return phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
}

export function PartiesPage({ kind }: { kind: Kind }) {
  const { api } = useApp();
  const text = TEXT[kind];
  const canWrite = useCan('parties.write');
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const [editing, setEditing] = useState<Party | 'new' | null>(null);
  const list = useQuery({
    queryKey: [kind, deferred],
    queryFn: () => api.get<Page<Party>>(`${text.path}?limit=100&q=${encodeURIComponent(deferred)}`),
  });

  const newButton = (label: string) => (
    <Button
      size="lg"
      icon={<Plus className="size-5" aria-hidden />}
      onClick={() => setEditing('new')}
    >
      {label}
    </Button>
  );
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        icon={text.icon}
        tone={text.tone}
        actions={canWrite && newButton(`Novo ${text.one}`)}
      />
      <SearchBox
        label={`Buscar ${text.title.toLowerCase()}`}
        placeholder="Nome, CPF/CNPJ ou telefone"
        value={query}
        onChange={setQuery}
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && list.data.items.length === 0 ? (
        deferred ? (
          <EmptyState
            title="Nada encontrado"
            icon={<SearchX />}
            tone="yellow"
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                Limpar a busca
              </Button>
            }
          >
            Confira o que foi digitado: dá para buscar pelo nome, CPF/CNPJ ou telefone.
          </EmptyState>
        ) : (
          <EmptyState
            title={`Nenhum ${text.one} ainda`}
            icon={text.icon}
            tone={text.tone}
            action={canWrite && newButton(`Cadastrar o primeiro ${text.one}`)}
          >
            {text.empty}
          </EmptyState>
        )
      ) : (
        list.data && (
          <DataTable
            caption={`Lista de ${text.title.toLowerCase()}`}
            rows={list.data.items}
            onRowClick={canWrite ? setEditing : undefined}
            card={(p) => (
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-bold">{p.name}</span>
                <span className="text-sm text-muted">
                  {[p.taxId && formatTaxId(p.taxId), formatPhone(p.phone)]
                    .filter(Boolean)
                    .join(' · ') || 'Sem documento nem telefone'}
                </span>
                {p.email && <span className="truncate text-sm text-muted">{p.email}</span>}
              </span>
            )}
            columns={[
              {
                header: 'Nome',
                cell: (p) => (
                  <span>
                    <span className="font-bold">{p.name}</span>
                    {p.email && <span className="block text-sm text-muted">{p.email}</span>}
                  </span>
                ),
              },
              { header: 'CPF/CNPJ', cell: (p) => (p.taxId ? formatTaxId(p.taxId) : '—') },
              { header: 'Telefone', cell: (p) => formatPhone(p.phone) || '—' },
            ]}
          />
        )
      )}
      {list.data && list.data.items.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {total} {total === 1 ? text.one : text.many}
          {total > list.data.items.length && ` (mostrando os ${list.data.items.length} primeiros)`}
        </p>
      )}
      {editing && (
        <PartyForm
          kind={kind}
          party={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function PartyForm({
  kind,
  party,
  onClose,
}: {
  kind: Kind;
  party: Party | null;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const text = TEXT[kind];
  const form = useForm({
    name: party?.name ?? '',
    taxId: party?.taxId ?? '',
    email: party?.email ?? '',
    phone: party?.phone ?? '',
    notes: party?.notes ?? '',
    marketingConsent: party?.marketingConsent ?? false,
    priceTableId: party?.priceTableId ?? '',
    creditLimit:
      party?.creditLimitCents != null
        ? formatBRL(cents(party.creditLimitCents)).replace('R$ ', '')
        : '',
  });
  const canCredit = useCan('parties.credit');
  const tables = useQuery({
    queryKey: ['price-tables'],
    queryFn: () => api.get<PriceTable[]>('/price-tables'),
    enabled: kind === 'customer',
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async ({ creditLimit, ...v }) => {
      // Limite do crediário: só quem tem a permissão manda o campo (sem ele, fica o atual).
      let creditLimitCents: number | null | undefined;
      if (kind === 'customer' && canCredit) {
        creditLimitCents = creditLimit.trim() ? parseBRL(creditLimit) : null;
        if (creditLimitCents === null && creditLimit.trim()) {
          throw new Error('Limite do crediário inválido. Use reais, por exemplo 500,00.');
        }
      }
      const body = {
        ...v,
        ...(creditLimitCents !== undefined && { creditLimitCents }),
        taxId: v.taxId || null,
        address: party?.address ?? null,
        priceTableId: kind === 'customer' ? v.priceTableId || null : undefined,
        ...(kind === 'supplier' && { marketingConsent: undefined }),
      };
      if (party) await api.put(`${text.path}/${party.id}`, body);
      else await api.post(text.path, body);
      await queryClient.invalidateQueries({ queryKey: [kind] });
      onClose();
    });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={party ? `Editar ${text.one}` : `Novo ${text.one}`}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <FormSection title="Dados e contato">
          <TextField
            label="Nome"
            value={form.values.name}
            onChange={(e) => form.set('name', e.target.value)}
            error={form.errors.name}
            autoFocus
          />
          <TaxIdField
            value={form.values.taxId}
            onChange={(v) => form.set('taxId', v)}
            error={form.errors.taxId}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Telefone / WhatsApp"
              inputMode="tel"
              value={form.values.phone}
              onChange={(e) => form.set('phone', e.target.value)}
              error={form.errors.phone}
            />
            <TextField
              label="E-mail"
              type="email"
              value={form.values.email}
              onChange={(e) => form.set('email', e.target.value)}
              error={form.errors.email}
            />
          </div>
          <TextField
            label="Observações"
            value={form.values.notes}
            onChange={(e) => form.set('notes', e.target.value)}
            error={form.errors.notes}
          />
        </FormSection>
        {kind === 'customer' && (
          <FormSection
            title="No caixa"
            description="Preço especial, crediário e permissão para ofertas."
          >
            <SelectField
              label="Tabela de preço"
              hint="Preços especiais para este cliente no caixa (ex.: atacado)."
              value={form.values.priceTableId}
              onChange={(e) => form.set('priceTableId', e.target.value)}
              options={[
                { value: '', label: 'Preço normal (tabela da loja)' },
                ...(tables.data ?? []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <TextField
              label="Limite do crediário (R$)"
              hint={
                canCredit
                  ? 'Deixe em branco para não vender no crediário. Precisa do CPF ou CNPJ.'
                  : 'Só quem pode liberar crediário muda o limite.'
              }
              inputMode="decimal"
              value={form.values.creditLimit}
              onChange={(e) => form.set('creditLimit', e.target.value)}
              disabled={!canCredit}
            />
            <Checkbox
              label="Aceita receber ofertas por WhatsApp ou e-mail"
              hint="Marque só se o cliente autorizou. Fica registrado (LGPD)."
              checked={form.values.marketingConsent}
              onChange={(v) => form.set('marketingConsent', v)}
            />
          </FormSection>
        )}
        {kind === 'customer' && party && <CustomerSummaryPanel customerId={party.id} />}
        {kind === 'customer' && party && <LoyaltyPanel customerId={party.id} />}
        {kind === 'customer' && party?.taxId && <CreditPanel customerId={party.id} />}
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Salvar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

const ENTRY_LABEL: Record<CustomerCredit['entries'][number]['kind'], string> = {
  sale: 'Compra no crediário',
  cancel: 'Venda cancelada',
  return: 'Devolução',
  payment: 'Pagamento recebido',
};

/** Crediário do cliente (F2-02): saldo, disponível, extrato e recebimento. */
function CreditPanel({ customerId }: { customerId: string }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canReceive = useCan('parties.credit');
  const credit = useQuery({
    queryKey: ['customer-credit', customerId],
    queryFn: () => api.get<CustomerCredit>(`/customers/${customerId}/credit`),
  });
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const data = credit.data;
  if (!data || (data.limitCents === null && data.entries.length === 0)) return null;

  const receive = async () => {
    const value = parseBRL(amount);
    if (!value) return setMessage({ ok: false, text: 'Informe o valor recebido.' });
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/customers/${customerId}/credit/payments`, { amountCents: value });
      setAmount('');
      setMessage({ ok: true, text: `Recebido ${formatBRL(cents(value))}.` });
      await queryClient.invalidateQueries({ queryKey: ['customer-credit', customerId] });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Crediário" className="flex flex-col gap-3 rounded-ui bg-surface-2 p-4">
      <h3 className="font-semibold">Crediário</h3>
      <p>
        Saldo devedor: <strong>{formatBRL(cents(data.balanceCents))}</strong>
        {data.availableCents !== null && (
          <> · disponível: {formatBRL(cents(data.availableCents))}</>
        )}
      </p>
      {data.entries.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {data.entries.slice(0, 10).map((entry) => (
            <li key={entry.id} className="flex justify-between gap-2">
              <span>
                {new Date(entry.createdAt).toLocaleDateString('pt-BR')} · {ENTRY_LABEL[entry.kind]}
              </span>
              <span className="tabular-nums">{formatBRL(cents(entry.amountCents))}</span>
            </li>
          ))}
        </ul>
      )}
      {canReceive && data.balanceCents > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Receber (R$)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button variant="secondary" loading={busy} onClick={() => void receive()}>
            Registrar pagamento
          </Button>
        </div>
      )}
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
    </section>
  );
}
