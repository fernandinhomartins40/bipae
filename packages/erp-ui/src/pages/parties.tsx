import { formatTaxId, type Page, type Party } from '@bipae/domain';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  TaxIdField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { useForm } from '../forms';

type Kind = 'customer' | 'supplier';

const TEXT = {
  customer: {
    title: 'Clientes',
    one: 'cliente',
    path: '/customers',
    empty: 'Cadastre clientes para vender no crediário, dar CPF na nota mais rápido e fidelizar.',
  },
  supplier: {
    title: 'Fornecedores',
    one: 'fornecedor',
    path: '/suppliers',
    empty:
      'Fornecedores também são criados automaticamente quando você importa o XML de uma nota de compra.',
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

  return (
    <>
      <PageHeader
        title={text.title}
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Novo {text.one}
            </Button>
          )
        }
      />
      <input
        type="search"
        aria-label={`Buscar ${text.title.toLowerCase()}`}
        placeholder="Nome, CPF/CNPJ ou telefone"
        className="mb-4 min-h-11 w-full max-w-xl rounded-ui border border-border bg-surface px-3"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title={deferred ? 'Nada encontrado' : `Nenhum ${text.one} ainda`}>
          {!deferred && text.empty}
        </EmptyState>
      ) : (
        list.data && (
          <DataTable
            caption={`Lista de ${text.title.toLowerCase()}`}
            rows={list.data.items}
            onRowClick={canWrite ? setEditing : undefined}
            columns={[
              { header: 'Nome', cell: (p) => <span className="font-semibold">{p.name}</span> },
              { header: 'CPF/CNPJ', cell: (p) => (p.taxId ? formatTaxId(p.taxId) : '—') },
              { header: 'Telefone', cell: (p) => formatPhone(p.phone) || '—' },
            ]}
          />
        )
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
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      const body = {
        ...v,
        taxId: v.taxId || null,
        address: party?.address ?? null,
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
        {kind === 'customer' && (
          <Checkbox
            label="Aceita receber ofertas por WhatsApp ou e-mail"
            hint="Marque só se o cliente autorizou. Fica registrado (LGPD)."
            checked={form.values.marketingConsent}
            onChange={(v) => form.set('marketingConsent', v)}
          />
        )}
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
