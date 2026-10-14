import {
  cents,
  formatBRL,
  type Page,
  type Party,
  type Product,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
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
import { Plus, Printer, X } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

const STATUS: Record<
  PurchaseOrderStatus,
  { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }
> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  sent: { label: 'Enviado', tone: 'warning' },
  received: { label: 'Recebido', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
};

/** "1,5" → 1500 milésimos, sem conta de ponto flutuante; null se inválido. */
export function parseQuantity(text: string): number | null {
  const match = /^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return milli > 0 ? milli : null;
}
const quantityText = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** Mesma regra da API: custo × quantidade ÷ 1000, meio para cima. */
const lineTotal = (costCents: number, milli: number) =>
  Math.floor((costCents * milli + 500) / 1000);

interface Line {
  productId: string;
  name: string;
  unit: string;
  quantity: string;
  unitCostCents: number;
}

/** Compras → Pedidos de compra (F4-01). */
export function PurchaseOrdersPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const [filter, setFilter] = useState<PurchaseOrderStatus | ''>('');
  const [editing, setEditing] = useState<PurchaseOrderView | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['purchase-orders', filter],
    queryFn: () =>
      api.get<PurchaseOrderView[]>(`/purchase-orders${filter ? `?status=${filter}` : ''}`),
  });
  return (
    <>
      <PageHeader
        title="Pedidos de compra"
        description="O que você pediu aos fornecedores, do rascunho à entrega."
        actions={
          canWrite && (
            <Button
              icon={<Plus className="size-5" aria-hidden />}
              onClick={() => setEditing('new')}
            >
              Novo pedido
            </Button>
          )
        }
      />
      <div className="mb-4 max-w-xs">
        <SelectField
          label="Situação"
          value={filter}
          onChange={(e) => setFilter(e.target.value as PurchaseOrderStatus | '')}
          options={[
            { value: '', label: 'Todos' },
            ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
          ]}
        />
      </div>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && list.data.length === 0 ? (
        <EmptyState title="Nenhum pedido ainda">
          Monte o pedido com os produtos e as quantidades, envie ao fornecedor e acompanhe aqui.
        </EmptyState>
      ) : (
        list.data && (
          <DataTable
            caption="Pedidos de compra"
            rows={list.data}
            onRowClick={setEditing}
            columns={[
              { header: 'Nº', cell: (o) => <span className="font-semibold">{o.number}</span> },
              { header: 'Fornecedor', cell: (o) => o.supplierName },
              { header: 'Loja', cell: (o) => o.storeName },
              { header: 'Entrega', cell: (o) => (o.expectedAt ? dateOnly(o.expectedAt) : '—') },
              { header: 'Total', cell: (o) => brl(o.totalCents) },
              {
                header: 'Situação',
                cell: (o) => <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>,
              },
            ]}
          />
        )
      )}
      {editing && (
        <OrderDrawer
          order={editing === 'new' ? null : editing}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function OrderDrawer({
  order,
  canWrite,
  onClose,
}: {
  order: PurchaseOrderView | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const editable = canWrite && (!order || order.status === 'draft');
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const suppliers = useQuery({
    queryKey: ['supplier', 'all'],
    queryFn: () => api.get<Page<Party>>('/suppliers?limit=100'),
  });
  const [storeId, setStoreId] = useState(order?.storeId ?? '');
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? '');
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    order?.items.map((i) => ({
      productId: i.productId,
      name: i.productName,
      unit: i.unit,
      quantity: quantityText(i.quantityMilli),
      unitCostCents: i.unitCostCents,
    })) ?? [],
  );
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'purchase-order-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: editable && q.length >= 2,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const store = storeId || stores.data?.[0]?.id || '';
  const total = lines.reduce((sum, l) => {
    const milli = parseQuantity(l.quantity);
    return sum + (milli ? lineTotal(l.unitCostCents, milli) : 0);
  }, 0);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const body = () => {
    const items = lines.map((l) => {
      const quantityMilli = parseQuantity(l.quantity);
      if (!quantityMilli) throw new Error(`Quantidade inválida em ${l.name}.`);
      return { productId: l.productId, quantityMilli, unitCostCents: l.unitCostCents };
    });
    return {
      storeId: store,
      supplierId,
      expectedAt: expectedAt || null,
      notes: notes.trim() || null,
      items,
    };
  };
  const save = (send: boolean) =>
    run(async () => {
      const saved = order
        ? await api.put<PurchaseOrderView>(`/purchase-orders/${order.id}`, body())
        : await api.post<PurchaseOrderView>('/purchase-orders', body());
      if (send) await api.post(`/purchase-orders/${saved.id}/send`);
    });

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={order ? `Pedido de compra nº ${order.number}` : 'Novo pedido de compra'}
    >
      <div className="flex flex-col gap-4">
        {order && (
          <p>
            <Badge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Badge>
            {order.cancelReason && (
              <span className="ml-2 text-sm text-muted">Motivo: {order.cancelReason}</span>
            )}
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <SelectField
          label="Fornecedor"
          value={supplierId}
          disabled={!editable}
          onChange={(e) => setSupplierId(e.target.value)}
          options={[
            { value: '', label: 'Escolha o fornecedor' },
            ...(suppliers.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Loja que recebe"
            value={store}
            disabled={!editable}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField
            label="Entrega prevista"
            type="date"
            value={expectedAt}
            disabled={!editable}
            onChange={(e) => setExpectedAt(e.target.value)}
          />
        </div>

        {editable && (
          <div className="flex flex-col gap-2">
            <TextField
              label="Adicionar produto"
              placeholder="Digite o nome ou o código"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {q.length >= 2 && found.data && (
              <ul className="rounded-ui border border-border" aria-label="Produtos encontrados">
                {found.data.items.length === 0 && (
                  <li className="p-3 text-muted">Nenhum produto encontrado.</li>
                )}
                {found.data.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full justify-between gap-2 p-3 text-left hover:bg-surface-2"
                      onClick={() => {
                        if (!lines.some((l) => l.productId === p.id)) {
                          setLines((list) => [
                            ...list,
                            {
                              productId: p.id,
                              name: p.name,
                              unit: p.unit,
                              quantity: '1',
                              unitCostCents: p.costCents ?? 0,
                            },
                          ]);
                        }
                        setSearch('');
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-muted">
                        {p.costCents !== null ? `custo ${brl(p.costCents)}` : 'sem custo'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {lines.length === 0 ? (
          <p className="text-muted">Nenhum produto no pedido ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Produtos do pedido">
            {lines.map((line, index) => {
              const milli = parseQuantity(line.quantity);
              const update = (patch: Partial<Line>) =>
                setLines((list) => list.map((l, i) => (i === index ? { ...l, ...patch } : l)));
              return (
                <li key={line.productId} className="rounded-ui border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{line.name}</p>
                    {editable && (
                      <Button
                        variant="ghost"
                        aria-label={`Tirar ${line.name} do pedido`}
                        icon={<X className="size-4" aria-hidden />}
                        onClick={() => setLines((list) => list.filter((_, i) => i !== index))}
                      />
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label={`Quantidade de ${line.name} (${line.unit})`}
                      inputMode="decimal"
                      value={line.quantity}
                      disabled={!editable}
                      error={milli ? null : 'Quantidade inválida'}
                      onChange={(e) => update({ quantity: e.target.value })}
                    />
                    {editable ? (
                      <MoneyField
                        label={`Custo de ${line.name}`}
                        value={line.unitCostCents}
                        onChange={(v) => update({ unitCostCents: v ?? 0 })}
                      />
                    ) : (
                      <TextField label="Custo" value={brl(line.unitCostCents)} disabled />
                    )}
                    <p className="self-end pb-3 text-right font-semibold tabular-nums">
                      {milli ? brl(lineTotal(line.unitCostCents, milli)) : '—'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-right text-lg font-bold" data-testid="order-total">
          Total: {brl(total)}
        </p>
        <TextField
          label="Observações para o fornecedor"
          value={notes}
          disabled={!editable}
          onChange={(e) => setNotes(e.target.value)}
        />

        {order?.status === 'sent' && canWrite && (
          <ReceivePanel
            order={order}
            onDone={() =>
              void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }).then(onClose)
            }
          />
        )}
        {order?.status === 'received' && (
          <ul className="flex flex-col gap-1 text-sm" aria-label="O que chegou">
            {order.items.map((i) => (
              <li
                key={i.line}
                className={i.receivedMilli !== i.quantityMilli ? 'font-semibold text-danger' : ''}
              >
                {i.productName}: chegou {quantityText(i.receivedMilli ?? 0)} de{' '}
                {quantityText(i.quantityMilli)} {i.unit}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {editable && (
            <>
              <Button loading={busy} onClick={() => void save(false)}>
                Salvar rascunho
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => void save(true)}>
                Salvar e enviar
              </Button>
            </>
          )}
          {order && (
            <Button
              variant="secondary"
              icon={<Printer className="size-4" aria-hidden />}
              onClick={() => window.print()}
            >
              Imprimir
            </Button>
          )}
          {order && canWrite && (order.status === 'draft' || order.status === 'sent') && (
            <div className="flex w-full flex-wrap items-end gap-2 border-t border-border pt-3">
              <TextField
                label="Motivo do cancelamento"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <Button
                variant="ghost"
                loading={busy}
                disabled={cancelReason.trim().length < 3}
                onClick={() =>
                  void run(() =>
                    api.post(`/purchase-orders/${order.id}/cancel`, {
                      reason: cancelReason.trim(),
                    }),
                  )
                }
              >
                Cancelar pedido
              </Button>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * Entrada de mercadoria conferida (F4-02): bipe cada volume (soma 1 unidade) ou digite a
 * quantidade. Ao confirmar, entra no estoque e o custo vira o custo médio.
 */
function ReceivePanel({ order, onDone }: { order: PurchaseOrderView; onDone: () => void }) {
  const { api } = useApp();
  const [counts, setCounts] = useState<Record<number, string>>(
    Object.fromEntries(order.items.map((i) => [i.line, '0'])),
  );
  const [scan, setScan] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const bipar = () => {
    const code = scan.trim();
    setScan('');
    if (!code) return;
    const item = order.items.find((i) => i.barcodes.includes(code));
    if (!item) return setMessage({ ok: false, text: `O código ${code} não está neste pedido.` });
    const current = parseQuantity(counts[item.line] ?? '0') ?? 0;
    setCounts((c) => ({ ...c, [item.line]: quantityText(current + 1000) }));
    setMessage({ ok: true, text: `${item.productName}: ${quantityText(current + 1000)}` });
  };

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const items = order.items.map((i) => {
        const text = counts[i.line] ?? '0';
        const milli = text.trim() === '0' ? 0 : parseQuantity(text);
        if (milli === null) throw new Error(`Quantidade inválida em ${i.productName}.`);
        return { line: i.line, receivedMilli: milli };
      });
      await api.post(`/purchase-orders/${order.id}/receive`, {
        items,
        ...(note.trim() && { note: note.trim() }),
      });
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Entrada da mercadoria"
      className="flex flex-col gap-3 rounded-ui bg-surface-2 p-4"
    >
      <h3 className="font-semibold">Entrada da mercadoria</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          bipar();
        }}
      >
        <TextField
          label="Bipe o produto que chegou"
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          autoFocus
        />
      </form>
      {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
      <ul className="flex flex-col gap-2">
        {order.items.map((i) => {
          const got = parseQuantity(counts[i.line] ?? '0') ?? 0;
          const diff = got !== i.quantityMilli;
          return (
            <li key={i.line} className="grid grid-cols-[1fr_8rem] items-end gap-2">
              <span className={diff ? 'text-danger' : 'text-success'}>
                {i.productName} · pedido {quantityText(i.quantityMilli)} {i.unit}
              </span>
              <TextField
                label={`Chegou de ${i.productName}`}
                inputMode="decimal"
                value={counts[i.line] ?? '0'}
                onChange={(e) => setCounts((c) => ({ ...c, [i.line]: e.target.value }))}
              />
            </li>
          );
        })}
      </ul>
      <TextField
        label="Observação da entrada"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button loading={busy} onClick={() => void confirm()}>
        Confirmar entrada no estoque
      </Button>
    </section>
  );
}
