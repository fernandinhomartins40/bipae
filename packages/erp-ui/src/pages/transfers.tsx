import type { Page, Product, StockTransferView } from '@bipae/domain';
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
const when = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const STATUS: Record<
  StockTransferView['status'],
  { label: string; tone: 'warning' | 'success' | 'neutral' }
> = {
  in_transit: { label: 'Em trânsito', tone: 'warning' },
  received: { label: 'Recebida', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

/** Transferência entre lojas (F4-12): sai da origem ao enviar, entra no destino ao receber. */
export function TransfersPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const list = useQuery({
    queryKey: ['stock-transfers'],
    queryFn: () => api.get<StockTransferView[]>('/stock/transfers'),
  });
  const [open, setOpen] = useState<StockTransferView | 'new' | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Transferências entre lojas"
        description="Mande mercadoria de uma loja para outra. O estoque sai da origem ao enviar e entra no destino quando a loja confirma o recebimento."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Nova transferência
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma transferência ainda">
          Quando uma loja mandar mercadoria para outra, ela aparece aqui.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Transferências"
            rows={rows}
            onRowClick={(r) => setOpen(r)}
            columns={[
              { header: 'Data', cell: (r) => when(r.createdAt) },
              { header: 'De', cell: (r) => r.fromStoreName },
              { header: 'Para', cell: (r) => r.toStoreName },
              { header: 'Produtos', align: 'right', cell: (r) => r.items.length },
              {
                header: 'Situação',
                cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
              },
            ]}
          />
        )
      )}
      {open && (
        <TransferDrawer transfer={open === 'new' ? null : open} onClose={() => setOpen(null)} />
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

function TransferDrawer({
  transfer,
  onClose,
}: {
  transfer: StockTransferView | null;
  onClose: () => void;
}) {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['products', 'transfer-search', q],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(q)}&limit=8`),
    enabled: !transfer && q.length >= 2,
  });
  // Recebimento: o que chegou de cada produto (vazio = chegou o que foi enviado).
  const [received, setReceived] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = fromId || stores.data?.[0]?.id || '';
  const to = toId || stores.data?.find((s) => s.id !== from)?.id || '';

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      const items = lines.map((l) => {
        const quantityMilli = parseQuantity(l.quantity);
        if (!quantityMilli) throw new Error(`Quantidade inválida em ${l.name}.`);
        return { productId: l.productId, quantityMilli };
      });
      await api.post('/stock/transfers', {
        fromStoreId: from,
        toStoreId: to,
        ...(note.trim() && { note: note.trim() }),
        items,
      });
    });

  const receive = () =>
    run(async () => {
      const items = (transfer?.items ?? []).map((i) => {
        const text = received[i.productId];
        if (text === undefined || text.trim() === '') {
          return { productId: i.productId, receivedMilli: i.quantityMilli };
        }
        const milli = text.trim() === '0' ? 0 : parseQuantity(text);
        if (milli === null) throw new Error(`Quantidade inválida em ${i.productName}.`);
        return { productId: i.productId, receivedMilli: milli };
      });
      await api.post(`/stock/transfers/${transfer!.id}/receive`, { items });
    });

  const cancel = () =>
    run(() => api.post(`/stock/transfers/${transfer!.id}/cancel`, { reason: reason.trim() }));

  if (transfer) {
    const inTransit = transfer.status === 'in_transit' && canWrite;
    return (
      <Drawer
        open
        onOpenChange={(o) => !o && onClose()}
        title={`${transfer.fromStoreName} → ${transfer.toStoreName}`}
      >
        <div className="flex flex-col gap-4">
          <p>
            <Badge tone={STATUS[transfer.status].tone}>{STATUS[transfer.status].label}</Badge>
            <span className="ml-2 text-sm text-muted">
              Enviada em {when(transfer.createdAt)}
              {transfer.receivedAt && ` · recebida em ${when(transfer.receivedAt)}`}
            </span>
          </p>
          {transfer.note && <p className="text-sm">Observação: {transfer.note}</p>}
          {transfer.cancelReason && (
            <p className="text-sm text-muted">Motivo do cancelamento: {transfer.cancelReason}</p>
          )}
          {transfer.needsInvoice && (
            <Alert tone="warning">
              As lojas são de empresas (CNPJs) diferentes: a mercadoria precisa de NF-e de
              transferência. A emissão pelo Bipaê chega em breve; por enquanto, emita a nota no
              emissor de sempre.
            </Alert>
          )}
          {error && <Alert>{error}</Alert>}
          <ul className="flex flex-col gap-2" aria-label="Produtos da transferência">
            {transfer.items.map((i) => (
              <li
                key={i.productId}
                className="flex items-center justify-between gap-3 rounded-ui border border-border p-3"
              >
                <span>
                  <span className="font-semibold">{i.productName}</span>
                  <span className="block text-sm text-muted">
                    Enviado: {qty(i.quantityMilli)} {i.unit}
                    {i.receivedMilli !== null && ` · chegou: ${qty(i.receivedMilli)} ${i.unit}`}
                  </span>
                </span>
                {inTransit && (
                  <TextField
                    label={`Chegou de ${i.productName} (${i.unit})`}
                    className="w-28"
                    inputMode="decimal"
                    placeholder={qty(i.quantityMilli)}
                    value={received[i.productId] ?? ''}
                    onChange={(e) => setReceived((r) => ({ ...r, [i.productId]: e.target.value }))}
                  />
                )}
              </li>
            ))}
          </ul>
          {inTransit && (
            <>
              <p className="text-sm text-muted">
                Deixe em branco o que chegou certo. A diferença fica registrada na auditoria.
              </p>
              <Button loading={busy} onClick={() => void receive()}>
                Confirmar recebimento
              </Button>
              <TextField
                label="Motivo do cancelamento"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="secondary"
                loading={busy}
                disabled={reason.trim().length < 3}
                onClick={() => void cancel()}
              >
                Cancelar transferência
              </Button>
            </>
          )}
        </div>
      </Drawer>
    );
  }

  const storeOptions = (stores.data ?? []).map((s) => ({ value: s.id, label: s.name }));
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Nova transferência">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {stores.data && stores.data.length < 2 && (
          <Alert tone="warning">Cadastre uma segunda loja para transferir mercadoria.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Sai da loja"
            value={from}
            onChange={(e) => setFromId(e.target.value)}
            options={storeOptions}
          />
          <SelectField
            label="Vai para a loja"
            value={to}
            onChange={(e) => setToId(e.target.value)}
            options={storeOptions.filter((s) => s.value !== from)}
          />
        </div>
        <TextField label="Observação" value={note} onChange={(e) => setNote(e.target.value)} />
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
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? (
          <p className="text-muted">Nenhum produto na transferência ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Produtos da transferência">
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
                  aria-label={`Tirar ${line.name} da transferência`}
                  icon={<X className="size-4" aria-hidden />}
                  onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          loading={busy}
          disabled={!from || !to || lines.length === 0}
          onClick={() => void send()}
        >
          Enviar mercadoria
        </Button>
      </div>
    </Drawer>
  );
}
