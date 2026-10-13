import { formatTaxId, UFS, type PriceTable } from '@bipae/domain';
import {
  Alert,
  Button,
  Card,
  Drawer,
  PageHeader,
  SelectField,
  TaxIdField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';
import { formatRate, useFiscalOptions } from './fiscal-lookup';

interface Company {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  uf: string | null;
  taxRegime: string | null;
}
interface StoreRow {
  id: string;
  name: string;
  companyId: string;
  priceTableId: string | null;
}

/**
 * Multi-company: a client (account) may have several companies (CNPJs), each with its own
 * stores. Fiscal settings are per company (UF, CNPJ) from Phase 3 on.
 */
export function CompaniesPage() {
  const { api } = useApp();
  const canManage = useCan('admin.stores');
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<Company[]>('/companies'),
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<StoreRow[]>('/stores') });
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const [storeFor, setStoreFor] = useState<Company | null>(null);
  const [editingStore, setEditingStore] = useState<{ company: Company; store: StoreRow } | null>(
    null,
  );
  const tables = useQuery({
    queryKey: ['price-tables'],
    queryFn: () => api.get<PriceTable[]>('/price-tables'),
  });
  const tableName = (id: string | null) => tables.data?.find((t) => t.id === id)?.name;
  const fiscal = useFiscalOptions().data;
  const regimeLabel = (id: string | null) => fiscal?.regimes.find((r) => r.id === id)?.label;
  const reload = () =>
    queryClient
      .invalidateQueries({ queryKey: ['companies'] })
      .then(() => queryClient.invalidateQueries({ queryKey: ['stores'] }));

  return (
    <>
      <PageHeader
        title="Empresas e lojas"
        description="Cada empresa é um CNPJ. Cada loja pertence a uma empresa e tem seus próprios caixas."
        actions={
          canManage && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Nova empresa
            </Button>
          )
        }
      />
      {(companies.error || stores.error) && (
        <Alert>{((companies.error ?? stores.error) as Error).message}</Alert>
      )}
      <div className="flex flex-col gap-4">
        {companies.data?.map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-3">
                <Building2 className="mt-1 size-6 text-primary" aria-hidden />
                <div>
                  <p className="text-lg font-semibold">{c.tradeName ?? c.legalName}</p>
                  <p className="text-sm text-muted">
                    {c.tradeName && `${c.legalName} · `}
                    {c.taxId ? formatTaxId(c.taxId) : 'CNPJ não informado'}
                    {c.uf && ` · ${c.uf}`}
                    {regimeLabel(c.taxRegime) && ` · ${regimeLabel(c.taxRegime)}`}
                  </p>
                  {(!c.uf || !c.taxRegime) && (
                    <p className="text-sm text-muted">
                      Falta configurar:{' '}
                      {[!c.uf && 'UF', !c.taxRegime && 'regime tributário'].filter(Boolean).join(' e ')}.
                      O Bipaê vai precisar disso para calcular os impostos e emitir notas.
                    </p>
                  )}
                </div>
              </div>
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(c)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Plus className="size-4" aria-hidden />}
                    onClick={() => setStoreFor(c)}
                  >
                    Nova loja
                  </Button>
                </div>
              )}
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              {stores.data
                ?.filter((s) => s.companyId === c.id)
                .map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => setEditingStore({ company: c, store: s })}
                      aria-label={canManage ? `Editar a loja ${s.name}` : undefined}
                      className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-sm font-medium enabled:hover:bg-border"
                    >
                      <Store className="size-4" aria-hidden /> {s.name}
                      {tableName(s.priceTableId) && (
                        <span className="text-muted">· {tableName(s.priceTableId)}</span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
      {editing && (
        <CompanyForm
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {storeFor && (
        <StoreForm company={storeFor} onClose={() => setStoreFor(null)} onSaved={reload} />
      )}
      {editingStore && (
        <StoreForm
          company={editingStore.company}
          store={editingStore.store}
          tables={tables.data ?? []}
          onClose={() => setEditingStore(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

function CompanyForm({
  company,
  onClose,
  onSaved,
}: {
  company: Company | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { api } = useApp();
  const [v, setV] = useState({
    legalName: company?.legalName ?? '',
    tradeName: company?.tradeName ?? '',
    taxId: company?.taxId ?? '',
    uf: company?.uf ?? '',
    taxRegime: company?.taxRegime ?? '',
  });
  const fiscal = useFiscalOptions().data;
  const regime = fiscal?.regimes.find((r) => r.id === v.taxRegime);
  const ufRate = fiscal?.ufRates.find((r) => r.uf === v.uf);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      legalName: v.legalName,
      tradeName: v.tradeName || null,
      taxId: v.taxId || null,
      uf: v.uf || null,
      taxRegime: v.taxRegime || null,
    };
    try {
      if (company) await api.patch(`/companies/${company.id}`, body);
      else await api.post('/companies', body);
      await onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? 'Editar empresa' : 'Nova empresa'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Razão social"
          value={v.legalName}
          onChange={(e) => setV({ ...v, legalName: e.target.value })}
          autoFocus
        />
        <TextField
          label="Nome fantasia"
          value={v.tradeName}
          onChange={(e) => setV({ ...v, tradeName: e.target.value })}
        />
        <TaxIdField label="CNPJ" value={v.taxId} onChange={(taxId) => setV({ ...v, taxId })} />
        <SelectField
          label="UF"
          value={v.uf}
          onChange={(e) => setV({ ...v, uf: e.target.value })}
          options={[{ value: '', label: 'Selecione' }, ...UFS.map((u) => ({ value: u, label: u }))]}
          hint={
            !ufRate
              ? 'O estado onde a empresa está inscrita.'
              : ufRate.rate
                ? `ICMS geral de ${ufRate.uf}: ${formatRate(ufRate.rate)} (${ufRate.law}).`
                : `A alíquota geral de ICMS de ${ufRate.uf} ainda não foi confirmada em fonte oficial: o cálculo vai pedir a alíquota ao seu contador.`
          }
        />
        <SelectField
          label="Regime tributário"
          value={v.taxRegime}
          onChange={(e) => setV({ ...v, taxRegime: e.target.value })}
          options={[
            { value: '', label: 'Selecione' },
            ...(fiscal?.regimes ?? []).map((r) => ({ value: r.id, label: r.label })),
          ]}
          hint={
            regime
              ? `${regime.hint} Na nota: CRT ${regime.crt}, ICMS com ${regime.icmsCode === 'csosn' ? 'CSOSN' : 'CST'}.`
              : 'Não é o tipo da empresa (MEI, LTDA...), é como ela paga imposto. Na dúvida, pergunte ao contador.'
          }
        />
        <Button type="submit">Salvar empresa</Button>
      </form>
    </Drawer>
  );
}

function StoreForm({
  company,
  store,
  tables = [],
  onClose,
  onSaved,
}: {
  company: Company;
  store?: StoreRow;
  tables?: PriceTable[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { api } = useApp();
  const [name, setName] = useState(store?.name ?? '');
  const [priceTableId, setPriceTableId] = useState(store?.priceTableId ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        store
          ? `Editar loja ${store.name}`
          : `Nova loja em ${company.tradeName ?? company.legalName}`
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            if (store)
              await api.patch(`/stores/${store.id}`, { name, priceTableId: priceTableId || null });
            else await api.post('/stores', { companyId: company.id, name });
            await onSaved();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome da loja"
          placeholder="Ex.: Loja Centro"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        {store && (
          <SelectField
            label="Tabela de preço da loja"
            hint="Os caixas desta loja usam estes preços. Clientes com tabela própria usam a deles."
            value={priceTableId}
            onChange={(e) => setPriceTableId(e.target.value)}
            options={[
              { value: '', label: 'Preço do cadastro do produto' },
              ...tables.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        )}
        <Button type="submit">{store ? 'Salvar loja' : 'Criar loja'}</Button>
      </form>
    </Drawer>
  );
}
