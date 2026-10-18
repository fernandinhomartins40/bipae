import {
  formatBRL,
  type Cents,
  type Page,
  type Party,
  type Product,
  type ServiceOrderInput,
  type ServiceOrderView,
  type ServiceView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';
import { parseQuantity } from './purchase-orders';

const money = (cents: number) => formatBRL(cents as Cents);
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const qtyText = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const STATUS: Record<
  ServiceOrderView['status'],
  { label: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }
> = {
  open: { label: 'Aberta', tone: 'warning' },
  in_progress: { label: 'Em andamento', tone: 'warning' },
  ready: { label: 'Pronta para retirar', tone: 'success' },
  delivered: { label: 'Entregue', tone: 'neutral' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

/**
 * Ordens de serviço (F5-13.c): o cliente deixa o equipamento (ou pede o serviço), a loja anota o
 * defeito, os serviços e as peças, acompanha a situação e entrega. Na entrega, as peças saem do
 * estoque e o total vira conta a receber.
 */
export function ServiceOrdersPage() {
  const { api } = useApp();
  const canWrite = useCan('pos.sell');
  const list = useQuery({
    queryKey: ['service-orders'],
    queryFn: () => api.get<ServiceOrderView[]>('/service-orders'),
  });
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const rows = list.data ?? [];
  const current = open && open !== 'new' ? (rows.find((r) => r.id === open) ?? null) : null;
  return (
    <>
      <PageHeader
        title="Ordens de serviço"
        description="Anote o que o cliente trouxe, o defeito, os serviços e as peças. Na entrega, as peças saem do estoque e o valor vai para as contas a receber."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Nova OS
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma ordem de serviço ainda">
          Quando um cliente trouxer algo para consertar ou pedir um serviço, abra uma OS aqui.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Ordens de serviço"
            rows={rows}
            onRowClick={(r) => setOpen(r.id)}
            columns={[
              { header: 'Nº', cell: (r) => String(r.number) },
              { header: 'Cliente', cell: (r) => r.customerName },
              { header: 'Equipamento', cell: (r) => r.equipment ?? '—' },
              { header: 'Aberta em', cell: (r) => day(r.createdAt) },
              { header: 'Total', align: 'right', cell: (r) => money(r.totalCents) },
              {
                header: 'Situação',
                cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
              },
            ]}
          />
        )
      )}
      {open && (
        <OrderDrawer
          key={current?.id ?? 'new'}
          order={current}
          onClose={() => setOpen(null)}
          onSaved={(id) => setOpen(id)}
        />
      )}
    </>
  );
}

interface Line {
  kind: 'service' | 'product';
  refId: string;
  description: string;
  quantity: string;
  unitPriceCents: number;
}

function OrderDrawer({
  order,
  onClose,
  onSaved,
}: {
  order: ServiceOrderView | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { api } = useApp();
  const canWrite = useCan('pos.sell');
  const queryClient = useQueryClient();
  const closed = order?.status === 'delivered' || order?.status === 'cancelled';
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState(order?.storeId ?? '');
  const store = storeId || stores.data?.[0]?.id || '';
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    order ? { id: order.customerId, name: order.customerName } : null,
  );
  const [customerSearch, setCustomerSearch] = useState('');
  const cq = useDeferredValue(customerSearch.trim());
  const customers = useQuery({
    queryKey: ['customer', 'os-search', cq],
    queryFn: () => api.get<Page<Party>>(`/customers?q=${encodeURIComponent(cq)}&limit=8`),
    enabled: !customer && cq.length >= 2,
  });
  const [equipment, setEquipment] = useState(order?.equipment ?? '');
  const [problem, setProblem] = useState(order?.problem ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    (order?.items ?? []).map((i) => ({
      kind: i.kind,
      refId: (i.kind === 'service' ? i.serviceId : i.productId) ?? '',
      description: i.description,
      quantity: qtyText(i.quantityMilli),
      unitPriceCents: i.unitPriceCents,
    })),
  );
  const services = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceView[]>('/services'),
  });
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'os-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: q.length >= 2,
  });
  const [serviceChoice, setServiceChoice] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['service-orders'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const total = lines.reduce(
    (t, l) => t + Math.round((l.unitPriceCents * (parseQuantity(l.quantity) ?? 0)) / 1000),
    0,
  );
  const body = (): ServiceOrderInput => ({
    storeId: store,
    customerId: customer!.id,
    equipment,
    problem,
    notes,
    items: lines.map((l) => {
      const quantityMilli = parseQuantity(l.quantity);
      if (!quantityMilli) throw new Error(`Quantidade inválida em ${l.description}.`);
      return {
        kind: l.kind,
        ...(l.kind === 'service' ? { serviceId: l.refId } : { productId: l.refId }),
        description: l.description,
        quantityMilli,
        unitPriceCents: l.unitPriceCents,
      };
    }),
  });
  const save = () =>
    run(async () => {
      const saved = order
        ? await api.put<ServiceOrderView>(`/service-orders/${order.id}`, body())
        : await api.post<ServiceOrderView>('/service-orders', body());
      onSaved(saved.id);
    });
  const setStatus = (status: 'open' | 'in_progress' | 'ready' | 'cancelled') =>
    run(async () => {
      await api.post(`/service-orders/${order!.id}/status`, { status });
    });
  const deliver = () =>
    run(async () => {
      await api.post(`/service-orders/${order!.id}/deliver`, dueDate ? { dueDate } : {});
    });
  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((l) => l.map((x, i) => (i === index ? { ...x, ...patch } : x)));

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={order ? `OS nº ${order.number} · ${order.customerName}` : 'Nova ordem de serviço'}
    >
      <div className="flex flex-col gap-4">
        {order && (
          <p>
            <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>
            <span className="ml-2 text-sm text-muted">Aberta em {day(order.createdAt)}</span>
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        {!order && (stores.data?.length ?? 0) > 1 && (
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
            {!closed && (
              <Button variant="ghost" onClick={() => setCustomer(null)}>
                Trocar
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <TextField
              label="Cliente"
              placeholder="Nome ou CPF"
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
                        setCustomer({ id: p.id, name: p.name });
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
          label="Equipamento ou objeto"
          placeholder="Ex.: Moto Honda CG 160, placa ABC1D23"
          value={equipment}
          disabled={closed}
          onChange={(e) => setEquipment(e.target.value)}
        />
        <TextField
          label="Defeito ou pedido do cliente"
          value={problem}
          disabled={closed}
          onChange={(e) => setProblem(e.target.value)}
        />
        <TextField
          label="Observações"
          value={notes}
          disabled={closed}
          onChange={(e) => setNotes(e.target.value)}
        />

        <fieldset className="flex flex-col gap-3 rounded-ui border border-border p-3">
          <legend className="px-1 font-semibold">Serviços e peças</legend>
          {!closed && (
            <>
              <div className="flex items-end gap-2">
                <SelectField
                  label="Adicionar serviço"
                  value={serviceChoice}
                  onChange={(e) => setServiceChoice(e.target.value)}
                  options={[
                    { value: '', label: 'Escolha um serviço' },
                    ...(services.data ?? [])
                      .filter((s) => s.active)
                      .map((s) => ({ value: s.id, label: `${s.name} · ${money(s.priceCents)}` })),
                  ]}
                />
                <Button
                  variant="secondary"
                  disabled={!serviceChoice}
                  onClick={() => {
                    const s = services.data?.find((x) => x.id === serviceChoice);
                    if (!s) return;
                    setLines((l) => [
                      ...l,
                      {
                        kind: 'service',
                        refId: s.id,
                        description: s.name,
                        quantity: '1',
                        unitPriceCents: s.priceCents,
                      },
                    ]);
                    setServiceChoice('');
                  }}
                >
                  Adicionar
                </Button>
              </div>
              {(services.data?.length ?? 1) === 0 && (
                <p className="text-sm text-muted">
                  Cadastre os serviços em Serviços para usar aqui.
                </p>
              )}
              <TextField
                label="Adicionar peça"
                placeholder="Nome ou código do produto"
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
                          setLines((l) => [
                            ...l,
                            {
                              kind: 'product',
                              refId: p.id,
                              description: p.name,
                              quantity: '1',
                              unitPriceCents: p.priceCents,
                            },
                          ]);
                          setSearch('');
                        }}
                      >
                        {p.name} · {money(p.priceCents)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {lines.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Itens da OS">
              {lines.map((line, index) => (
                <li
                  key={`${line.refId}-${index}`}
                  className="flex flex-col gap-2 rounded-ui border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {line.description}
                      <span className="ml-2 text-sm font-normal text-muted">
                        {line.kind === 'service' ? 'serviço' : 'peça'}
                      </span>
                    </span>
                    {!closed && (
                      <Button
                        variant="ghost"
                        aria-label={`Tirar ${line.description} da OS`}
                        icon={<X className="size-4" aria-hidden />}
                        onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                      />
                    )}
                  </div>
                  {!closed && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <TextField
                        label={`Quantidade de ${line.description}`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: e.target.value })}
                      />
                      <MoneyField
                        label={`Preço de ${line.description}`}
                        value={line.unitPriceCents}
                        onChange={(c) => setLine(index, { unitPriceCents: c ?? 0 })}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm">
            Total: <span className="font-semibold">{money(total)}</span>
          </p>
        </fieldset>

        {canWrite && !closed && (
          <div className="flex flex-col gap-2">
            <Button loading={busy} disabled={!store || !customer} onClick={() => void save()}>
              {order ? 'Salvar a OS' : 'Abrir a OS'}
            </Button>
            {order && (
              <>
                <SelectField
                  label="Situação"
                  value={order.status}
                  onChange={(e) =>
                    void setStatus(e.target.value as 'open' | 'in_progress' | 'ready')
                  }
                  options={[
                    { value: 'open', label: 'Aberta' },
                    { value: 'in_progress', label: 'Em andamento' },
                    { value: 'ready', label: 'Pronta para retirar' },
                  ]}
                />
                <TextField
                  label="Vencimento da conta a receber"
                  type="date"
                  hint="Em branco, vence hoje."
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                <Button variant="secondary" loading={busy} onClick={() => void deliver()}>
                  Entregar ao cliente
                </Button>
                <Button variant="ghost" loading={busy} onClick={() => void setStatus('cancelled')}>
                  Cancelar a OS
                </Button>
              </>
            )}
          </div>
        )}
        {order?.status === 'delivered' && (
          <Alert tone="success" title="Entregue">
            As peças saíram do estoque e o total de {money(order.totalCents)} foi para as contas a
            receber. A NFS-e dos serviços chega com a próxima etapa.
          </Alert>
        )}
      </div>
    </Drawer>
  );
}
