import type { InventoryView } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FilterChips,
  PageHeader,
  SelectField,
  StatCard,
  StatGrid,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  PackageMinus,
  ScanBarcode,
  TriangleAlert,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp, useCan } from '../context';
import { parseQuantity } from './purchase-orders';

const qty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const when = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

interface InventorySummary {
  id: string;
  name: string;
  storeName: string;
  status: InventoryView['status'];
  createdAt: string;
  closedAt: string | null;
}

/**
 * Inventário pelo celular (F4-11): bipa o produto (cada bipe soma a quantidade) ou digita o
 * total contado, vê a diferença com o sistema e fecha. Ao fechar, o estoque de cada produto
 * contado passa a ser o que foi contado.
 */
export function InventoryPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['inventories'],
    queryFn: () => api.get<InventorySummary[]>('/inventories'),
  });
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  // Resumo do topo: só dados que a API já devolve (saldos e lotes perto da validade).
  const stock = useQuery({
    queryKey: ['stock'],
    queryFn: () => api.get<{ productId: string; quantityMilli: number }[]>('/stock'),
  });
  const lots = useQuery({
    queryKey: ['stock-lots', 'expiring', '30'],
    queryFn: () => api.get<{ daysLeft: number | null }[]>('/stock/lots?days=30'),
  });
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const store = storeId || stores.data?.[0]?.id || '';

  const start = async () => {
    setError(null);
    try {
      const inv = await api.post<InventoryView>('/inventories', {
        storeId: store,
        name: name.trim() || `Inventário de ${new Date().toLocaleDateString('pt-BR')}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['inventories'] });
      setName('');
      setOpenId(inv.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (openId) return <InventoryCount id={openId} onBack={() => setOpenId(null)} />;

  const all = list.data ?? [];
  const openCount = all.filter((r) => r.status === 'open').length;
  const rows = all.filter((r) => filter === 'all' || r.status === filter);
  // Saldo de cada produto somando as lojas; só conta o que ficou abaixo de zero.
  const totals = new Map<string, number>();
  for (const s of stock.data ?? []) {
    totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.quantityMilli);
  }
  const negative = [...totals.values()].filter((q) => q < 0).length;
  const lotList = lots.data ?? [];
  const expired = lotList.filter((l) => l.daysLeft !== null && l.daysLeft < 0).length;
  const expiring = lotList.filter((l) => l.daysLeft !== null && l.daysLeft >= 0).length;
  return (
    <>
      <PageHeader
        title="Inventário"
        description="Conte o estoque pelo celular: bipe cada produto ou digite o total da prateleira."
        icon={<ClipboardCheck />}
        tone="blue"
      />
      {list.data && stock.data && lots.data && (
        <StatGrid label="Resumo do estoque">
          <StatCard
            label="Contagens abertas"
            tone="blue"
            icon={<ClipboardList />}
            value={openCount}
            hint={openCount ? 'Feche quando terminar de contar.' : 'Nenhuma em andamento.'}
          />
          <StatCard
            label="Estoque negativo"
            tone={negative ? 'red' : 'green'}
            icon={<PackageMinus />}
            value={negative}
            hint={negative ? 'Produto(s) abaixo de zero: vale contar.' : 'Nenhum produto.'}
          />
          <StatCard
            label="Vencendo em 30 dias"
            tone={expiring ? 'yellow' : 'green'}
            icon={<CalendarClock />}
            value={expiring}
            hint={
              expiring
                ? 'Lote(s) perto da validade. Veja em Lote e validade.'
                : 'Nada perto de vencer.'
            }
          />
          <StatCard
            label="Vencidos"
            tone={expired ? 'red' : 'green'}
            icon={<TriangleAlert />}
            value={expired}
            hint={expired ? 'Lote(s) para descartar ou trocar.' : 'Nenhum lote vencido.'}
          />
        </StatGrid>
      )}
      {(error || list.error) && <Alert>{error ?? (list.error as Error).message}</Alert>}
      {canWrite && (
        <section
          aria-labelledby="nova-contagem"
          className="mb-6 flex flex-col gap-4 rounded-2xl border border-transparent bg-tile-blue p-5 [[data-contrast=high]_&]:border-border"
        >
          <h2 id="nova-contagem" className="text-lg font-bold">
            Começar uma contagem
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Loja"
              value={store}
              onChange={(e) => setStoreId(e.target.value)}
              options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
            <TextField
              label="Nome da contagem"
              placeholder="Ex.: Corredor 3, Outubro"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            size="lg"
            icon={<ScanBarcode className="size-5" aria-hidden />}
            onClick={() => void start()}
            disabled={!store}
            className="sm:self-start"
          >
            Começar contagem
          </Button>
        </section>
      )}
      {all.length > 0 && (
        <div className="mb-4">
          <FilterChips
            label="Mostrar"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todas', count: all.length },
              { value: 'open', label: 'Abertas', count: openCount },
              { value: 'closed', label: 'Fechadas', count: all.length - openCount },
            ]}
          />
        </div>
      )}
      {list.data && all.length === 0 ? (
        <EmptyState title="Nenhuma contagem ainda" icon={<ScanBarcode />} tone="blue">
          Comece uma contagem e bipe os produtos com o celular: cada bipe soma um. Bipou? Bipaê!
        </EmptyState>
      ) : list.data && rows.length === 0 ? (
        <EmptyState title="Nada com esse filtro" icon={<ClipboardList />} tone="blue">
          Escolha outro filtro acima para ver as outras contagens.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Contagens">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-left shadow-sm hover:bg-surface-2"
                onClick={() => setOpenId(r.id)}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tile-blue-strong text-tile-icon"
                  >
                    <ClipboardList className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="font-bold">{r.name}</span>
                    <span className="block text-sm text-muted">
                      {r.storeName} · {when(r.createdAt)}
                    </span>
                  </span>
                </span>
                {r.status === 'open' ? (
                  <Badge tone="warning">Aberta</Badge>
                ) : (
                  <Badge tone="success">Fechada {r.closedAt && `em ${when(r.closedAt)}`}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InventoryCount({ id, onBack }: { id: string; onBack: () => void }) {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const queryClient = useQueryClient();
  const inv = useQuery({
    queryKey: ['inventories', id],
    queryFn: () => api.get<InventoryView>(`/inventories/${id}`),
  });
  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const open = inv.data?.status === 'open' && canWrite;

  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventories', id] }),
      queryClient.invalidateQueries({ queryKey: ['inventories'], exact: true }),
    ]);

  const submit = async (body: { code?: string; productId?: string }, text: string) => {
    // Total digitado pode ser zero (a prateleira está vazia); o bipe soma pelo menos um.
    const milli = mode === 'set' && text.trim() === '0' ? 0 : parseQuantity(text);
    if (milli === null) {
      setLast({ ok: false, text: 'Quantidade inválida.' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ productName: string; countedMilli: number }>(
        `/inventories/${id}/counts`,
        { ...body, mode, quantityMilli: milli },
      );
      setLast({ ok: true, text: `${r.productName}: ${qty(r.countedMilli)} contado(s)` });
      setCode('');
      setQuantity('1');
      setMode('add');
      await reload();
    } catch (e) {
      setLast({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      codeRef.current?.focus();
    }
  };

  const close = async () => {
    if (!window.confirm('Fechar a contagem? O estoque dos produtos contados vai ser ajustado.'))
      return;
    setBusy(true);
    try {
      await api.post(`/inventories/${id}/close`);
      setLast({ ok: true, text: 'Contagem fechada e estoque ajustado.' });
      await reload();
    } catch (e) {
      setLast({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const items = inv.data?.items ?? [];
  const diffs = items.filter((i) => i.countedMilli !== i.systemMilli).length;
  return (
    <>
      <PageHeader
        title={inv.data?.name ?? 'Inventário'}
        description={
          inv.data ? `${inv.data.storeName} · ${items.length} produto(s) contado(s)` : ''
        }
      />
      <Button variant="ghost" className="mb-3" onClick={onBack}>
        ← Voltar às contagens
      </Button>
      {inv.error && <Alert>{(inv.error as Error).message}</Alert>}
      {last && (
        <p
          role="status"
          data-testid="inventory-last"
          className={last.ok ? 'mb-3 font-semibold text-success' : 'mb-3 font-semibold text-danger'}
        >
          {last.text}
        </p>
      )}
      {open && (
        <Card className="mb-4">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void submit({ code: code.trim() }, quantity);
            }}
          >
            <TextField
              ref={codeRef}
              label="Código de barras ou código interno"
              inputMode="numeric"
              autoFocus
              autoComplete="off"
              className="text-xl"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={mode === 'add' ? 'Quantidade a somar' : 'Total contado'}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <SelectField
                label="Como contar"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'add' | 'set')}
                options={[
                  { value: 'add', label: 'Somar ao bipar' },
                  { value: 'set', label: 'Digitar o total' },
                ]}
              />
            </div>
            <Button type="submit" loading={busy} disabled={!code.trim()}>
              Contar
            </Button>
          </form>
        </Card>
      )}
      {items.length === 0 ? (
        <EmptyState title="Nada contado ainda">Bipe o primeiro produto para começar.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Produtos contados">
          {items.map((i) => {
            const diff = i.countedMilli - i.systemMilli;
            return (
              <li
                key={i.productId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm"
              >
                <span>
                  <span className="font-semibold">{i.productName}</span>
                  <span className="block text-sm text-muted">
                    Sistema: {qty(i.systemMilli)} {i.unit}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-lg font-semibold">
                    {qty(i.countedMilli)} {i.unit}
                  </span>
                  {diff === 0 ? (
                    <Badge tone="success">Confere</Badge>
                  ) : (
                    <Badge tone={diff < 0 ? 'danger' : 'warning'}>
                      {diff > 0 ? '+' : '−'}
                      {qty(Math.abs(diff))}
                    </Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && items.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm text-muted">
            {diffs} produto(s) com diferença. Ao fechar, o estoque passa a ser o contado, pela
            diferença com o saldo do momento: feche logo depois de contar, de preferência com a loja
            parada. O que não foi contado não muda.
          </p>
          <Button variant="secondary" loading={busy} onClick={() => void close()}>
            Fechar inventário
          </Button>
        </div>
      )}
    </>
  );
}
