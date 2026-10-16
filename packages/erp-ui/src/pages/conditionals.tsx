import {
  CONDITIONAL_MAX_DAYS,
  formatBRL,
  type Cents,
  type ConditionalView,
  type Page,
  type Party,
  type Product,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';
import { parseQuantity } from './purchase-orders';

const qty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const money = (cents: number) => formatBRL(cents as Cents);

function status(c: ConditionalView): {
  label: string;
  tone: 'warning' | 'success' | 'neutral' | 'danger';
} {
  if (c.status === 'closed') return { label: 'Fechado', tone: 'success' };
  if (c.status === 'cancelled') return { label: 'Cancelado', tone: 'neutral' };
  return c.overdue
    ? { label: 'Prazo vencido', tone: 'danger' }
    : { label: 'Com o cliente', tone: 'warning' };
}

/** O aviso honesto sobre a nota: o Ajuste SINIEF 02/18 pede NF-e na saída e na volta. */
function FiscalNotice() {
  return (
    <Alert tone="warning" title="Nota de remessa">
      Pelo Ajuste SINIEF 02/18, a peça que sai para o cliente provar vai com NF-e de remessa para
      demonstração (CFOP 5.912), e a volta, com NF-e de retorno (CFOP 1.913). A emissão dessas notas
      pelo Bipaê chega com a NF-e da retaguarda. Por enquanto, emita no emissor de sempre. O que o
      cliente ficar é vendido no caixa.
    </Alert>
  );
}

/**
 * Venda condicional (F5-12.b): o cliente leva as peças para provar, com prazo de volta. Na
 * volta, tudo entra de novo no estoque, e o que ele ficou vai ao caixa como uma comanda.
 */
export function ConditionalsPage() {
  const { api } = useApp();
  const canWrite = useCan('pos.sell');
  const list = useQuery({
    queryKey: ['conditionals'],
    queryFn: () => api.get<ConditionalView[]>('/conditionals'),
  });
  const [open, setOpen] = useState<ConditionalView | 'new' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Condicional"
        description="O cliente leva as peças para provar em casa e volta no prazo. O que ele ficar vai para o caixa; o resto volta ao estoque."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Novo condicional
            </Button>
          )
        }
      />
      {done && (
        <Alert tone="success" title="Condicional fechado">
          {done}
        </Alert>
      )}
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhum condicional ainda">
          Quando um cliente levar peças para provar, registre aqui: o estoque sai na hora e volta na
          devolução.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Condicionais"
            rows={rows}
            onRowClick={(r) => setOpen(r)}
            columns={[
              { header: 'Nº', cell: (r) => String(r.number) },
              { header: 'Cliente', cell: (r) => r.customerName },
              { header: 'Loja', cell: (r) => r.storeName },
              { header: 'Volta até', cell: (r) => day(r.dueOn) },
              { header: 'Peças', align: 'right', cell: (r) => String(r.items.length) },
              { header: 'Valor', align: 'right', cell: (r) => money(r.totalCents) },
              {
                header: 'Situação',
                cell: (r) => <Badge tone={status(r).tone}>{status(r).label}</Badge>,
              },
            ]}
          />
        )
      )}
      {open && (
        <ConditionalDrawer
          conditional={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onClosed={(message) => {
            setOpen(null);
            setDone(message);
          }}
        />
      )}
    </>
  );
}

interface Line {
  productId: string;
  name: string;
  unit: string;
  quantity: string;
}

function ConditionalDrawer({
  conditional,
  onClose,
  onClosed,
}: {
  conditional: ConditionalView | null;
  onClose: () => void;
  onClosed: (message: string) => void;
}) {
  const { api } = useApp();
  const canWrite = useCan('pos.sell');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<Record<string, string>>({});

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['conditionals'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (conditional) {
    const c = conditional;
    const isOpen = c.status === 'open' && canWrite;
    const close = () =>
      run(async () => {
        const items = c.items.map((i) => {
          const text = (kept[i.productId] ?? '').trim();
          const keptMilli = text === '' || text === '0' ? 0 : parseQuantity(text);
          if (keptMilli === null) throw new Error(`Quantidade inválida em ${i.productName}.`);
          return { productId: i.productId, keptMilli };
        });
        const result = await api.post<ConditionalView>(`/conditionals/${c.id}/close`, { items });
        onClosed(
          result.tabOrderId
            ? `O que ${c.customerName} ficou foi para o caixa como a comanda "Condicional ${c.number}". O resto voltou ao estoque.`
            : `Tudo voltou ao estoque.`,
        );
      });
    const cancel = () =>
      run(async () => {
        await api.post(`/conditionals/${c.id}/cancel`, {});
        onClosed(`Condicional nº ${c.number} cancelado: as peças voltaram ao estoque.`);
      });
    return (
      <Drawer
        open
        onOpenChange={(o) => !o && onClose()}
        title={`Condicional nº ${c.number} · ${c.customerName}`}
      >
        <div className="flex flex-col gap-4">
          <p>
            <Badge tone={status(c).tone}>{status(c).label}</Badge>
            <span className="ml-2 text-sm text-muted">
              Saiu em {day(c.createdAt)} · volta até {day(c.dueOn)} · {c.storeName}
            </span>
          </p>
          {c.note && <p className="text-sm">Observação: {c.note}</p>}
          {error && <Alert>{error}</Alert>}
          <ul className="flex flex-col gap-2" aria-label="Peças do condicional">
            {c.items.map((i) => (
              <li
                key={i.productId}
                className="flex items-center justify-between gap-3 rounded-ui border border-border p-3"
              >
                <span>
                  <span className="font-semibold">{i.productName}</span>
                  <span className="block text-sm text-muted">
                    Levou: {qty(i.quantityMilli)} {i.unit} · {money(i.unitPriceCents)} cada
                    {i.keptMilli !== null && ` · ficou: ${qty(i.keptMilli)} ${i.unit}`}
                  </span>
                </span>
                {isOpen && (
                  <TextField
                    label={`Ficou com ${i.productName} (${i.unit})`}
                    className="w-28"
                    inputMode="decimal"
                    placeholder="0"
                    value={kept[i.productId] ?? ''}
                    onChange={(e) => setKept((k) => ({ ...k, [i.productId]: e.target.value }))}
                  />
                )}
              </li>
            ))}
          </ul>
          {isOpen && (
            <>
              <p className="text-sm text-muted">
                Informe o que o cliente ficou. Deixe em branco o que ele devolveu. Tudo volta ao
                estoque, e o que ficou vai ao caixa como comanda para ser vendido.
              </p>
              <Button loading={busy} onClick={() => void close()}>
                Registrar a volta
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => void cancel()}>
                Cancelar (devolveu tudo)
              </Button>
              <FiscalNotice />
            </>
          )}
        </div>
      </Drawer>
    );
  }
  return <NewConditional onClose={onClose} run={run} busy={busy} error={error} />;
}

function NewConditional({
  onClose,
  run,
  busy,
  error,
}: {
  onClose: () => void;
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const { api } = useApp();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState('');
  const [customer, setCustomer] = useState<Party | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const cq = useDeferredValue(customerSearch.trim());
  const customers = useQuery({
    queryKey: ['customer', 'conditional-search', cq],
    queryFn: () => api.get<Page<Party>>(`/customers?q=${encodeURIComponent(cq)}&limit=8`),
    enabled: !customer && cq.length >= 2,
  });
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'conditional-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  const store = storeId || stores.data?.[0]?.id || '';

  const send = () =>
    run(async () => {
      const items = lines.map((l) => {
        const quantityMilli = parseQuantity(l.quantity);
        if (!quantityMilli) throw new Error(`Quantidade inválida em ${l.name}.`);
        return { productId: l.productId, quantityMilli };
      });
      await api.post('/conditionals', {
        storeId: store,
        customerId: customer!.id,
        ...(dueOn && { dueOn }),
        ...(note.trim() && { note: note.trim() }),
        items,
      });
      onClose();
    });

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Novo condicional">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {(stores.data?.length ?? 0) > 1 && (
          <SelectField
            label="Loja"
            value={store}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-ui border border-border p-3">
            <span>
              Cliente: <span className="font-semibold">{customer.name}</span>
            </span>
            <Button variant="ghost" onClick={() => setCustomer(null)}>
              Trocar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <TextField
              label="Cliente"
              placeholder="Nome ou CPF de quem leva"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            {cq.length >= 2 && customers.data && (
              <ul className="rounded-ui border border-border" aria-label="Clientes encontrados">
                {customers.data.items.length === 0 && (
                  <li className="p-3 text-muted">
                    Nenhum cliente encontrado. Cadastre em Clientes antes.
                  </li>
                )}
                {customers.data.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full p-3 text-left hover:bg-surface-2"
                      onClick={() => {
                        setCustomer(p);
                        setCustomerSearch('');
                      }}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <TextField
          label="Volta até"
          type="date"
          hint={`Em branco, o prazo é de ${CONDITIONAL_MAX_DAYS} dias, o máximo do Ajuste SINIEF 02/18.`}
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
        <TextField label="Observação" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex flex-col gap-2">
          <TextField
            label="Adicionar peça"
            placeholder="Digite o nome ou o código"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {q.length >= 2 && found.data && (
            <ul className="rounded-ui border border-border" aria-label="Peças encontradas">
              {found.data.items.length === 0 && (
                <li className="p-3 text-muted">Nenhum produto encontrado.</li>
              )}
              {found.data.items.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full p-3 text-left hover:bg-surface-2"
                    onClick={() => {
                      if (!lines.some((l) => l.productId === p.id)) {
                        setLines((l) => [
                          ...l,
                          { productId: p.id, name: p.name, unit: p.unit, quantity: '1' },
                        ]);
                      }
                      setSearch('');
                    }}
                  >
                    {p.name} · {money(p.priceCents)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Peças do condicional">
            {lines.map((line, index) => (
              <li
                key={line.productId}
                className="flex items-end justify-between gap-3 rounded-ui border border-border p-3"
              >
                <TextField
                  label={`Quantidade de ${line.name} (${line.unit})`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((l) =>
                      l.map((x, i) => (i === index ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`Tirar ${line.name} do condicional`}
                  icon={<X className="size-4" aria-hidden />}
                  onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          loading={busy}
          disabled={!store || !customer || lines.length === 0}
          onClick={() => void send()}
        >
          Registrar a saída
        </Button>
        <FiscalNotice />
      </div>
    </Drawer>
  );
}
