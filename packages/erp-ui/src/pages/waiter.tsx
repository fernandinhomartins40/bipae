import {
  cents,
  formatBRL,
  type Page,
  type Product,
  type SellerView,
  type TabOrderView,
  type TabView,
} from '@bipae/domain';
import { Alert, Badge, Button, Card, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));

const STATUS: Record<
  TabOrderView['status'],
  { label: string; tone: 'neutral' | 'success' | 'danger' }
> = {
  pending: { label: 'Esperando o caixa', tone: 'neutral' },
  received: { label: 'Na comanda', tone: 'success' },
  rejected: { label: 'Não entrou', tone: 'danger' },
};

/**
 * Pedidos e comandas pelo celular (F5-08 e F8-03): o garçom escolhe a mesa, o vendedor da loja
 * escreve o nome do cliente; busca os produtos e manda o pedido. O caixa junta à comanda na
 * sincronização seguinte e o cliente paga lá. Quem está ligado a um vendedor leva a comissão
 * dos itens. O celular precisa de internet para mandar; o caixa, não.
 */
export function WaiterPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState('');
  const store = storeId || stores.data?.[0]?.id || '';
  const tabs = useQuery({
    queryKey: ['tabs', store],
    queryFn: () => api.get<TabView[]>(`/tabs?storeId=${store}`),
    enabled: Boolean(store),
    refetchInterval: 15_000,
  });
  const orders = useQuery({
    queryKey: ['tab-orders', store],
    queryFn: () => api.get<TabOrderView[]>(`/tabs/orders?storeId=${store}`),
    enabled: Boolean(store),
    refetchInterval: 5000,
  });
  const me = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: () => api.get<{ seller: SellerView | null }>('/sellers/me'),
    staleTime: 5 * 60_000,
  });
  const [label, setLabel] = useState('');
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['waiter-products', search],
    queryFn: () => api.get<Page<Product>>(`/products?q=${encodeURIComponent(search)}&limit=10`),
    enabled: search.trim().length >= 2,
  });
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (product: Product) => {
    setCart((c) => {
      const at = c.find((i) => i.product.id === product.id);
      return at
        ? c.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...c, { product, quantity: 1 }];
    });
    setSearch('');
  };
  const change = (id: string, delta: number) =>
    setCart((c) =>
      c
        .map((i) => (i.product.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );
  const total = cart.reduce((sum, i) => sum + i.product.priceCents * i.quantity, 0);

  const send = async () => {
    setMessage(null);
    if (!navigator.onLine) {
      setMessage({
        ok: false,
        text: 'Sem internet: o pedido não saiu. Tente de novo ou leve ao caixa.',
      });
      return;
    }
    setBusy(true);
    try {
      await api.post('/tabs/orders', {
        storeId: store,
        label,
        items: cart.map((i) => ({ productId: i.product.id, quantityMilli: i.quantity * 1000 })),
      });
      setMessage({ ok: true, text: `${label}: pedido enviado. O caixa recebe em instantes.` });
      setCart([]);
      await queryClient.invalidateQueries({ queryKey: ['tab-orders'] });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <PageHeader
        title="Pedidos e comandas"
        description="Escolha a mesa ou escreva o nome do cliente, os itens e mande ao caixa. O cliente paga lá."
      />
      {me.data?.seller && (
        <p className="text-sm" data-testid="waiter-seller">
          Você lança como <strong>{me.data.seller.name}</strong> ({me.data.seller.code}): os itens
          contam na sua comissão.
        </p>
      )}
      {(stores.data?.length ?? 0) > 1 && (
        <SelectField
          label="Loja"
          value={store}
          onChange={(e) => setStoreId(e.target.value)}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
      <Card className="flex flex-col gap-3">
        <TextField
          label="Mesa, comanda ou nome do cliente"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Mesa 5 ou Maria"
        />
        {(tabs.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Comandas abertas">
            {tabs.data!.map((t) => (
              <Button
                key={t.id}
                variant={label === t.label ? 'primary' : 'secondary'}
                onClick={() => setLabel(t.label)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <TextField
          label="Buscar produto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Digite o nome"
        />
        {found.data && search.trim().length >= 2 && (
          <ul className="flex flex-col divide-y divide-border" aria-label="Produtos encontrados">
            {found.data.items
              .filter((p) => p.active)
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 py-2 text-left"
                    onClick={() => add(p)}
                  >
                    <span>{p.name}</span>
                    <span className="tabular-nums">{brl(p.priceCents)}</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        {cart.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Pedido">
            {cart.map((i) => (
              <li key={i.product.id} className="flex items-center justify-between gap-2">
                <span className="flex-1">{i.product.name}</span>
                <Button
                  variant="ghost"
                  aria-label={`Menos ${i.product.name}`}
                  onClick={() => change(i.product.id, -1)}
                >
                  −
                </Button>
                <span className="w-6 text-center font-semibold tabular-nums">{i.quantity}</span>
                <Button
                  variant="ghost"
                  aria-label={`Mais ${i.product.name}`}
                  onClick={() => change(i.product.id, 1)}
                >
                  +
                </Button>
              </li>
            ))}
          </ul>
        )}
        {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
        <Button
          size="lg"
          loading={busy}
          disabled={!store || !label.trim() || cart.length === 0}
          onClick={() => void send()}
        >
          Mandar pedido{cart.length > 0 ? ` · ${brl(total)}` : ''}
        </Button>
      </Card>
      {(orders.data?.length ?? 0) > 0 && (
        <section aria-label="Pedidos de hoje" className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Pedidos de hoje</h2>
          {orders.data!.map((o) => (
            <Card key={o.id} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{o.label}</span>
                <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
              </span>
              <span className="text-sm text-muted">
                {o.items
                  .map((i) => `${(i.quantityMilli / 1000).toLocaleString('pt-BR')} ${i.name}`)
                  .join(', ')}
              </span>
              {o.reason && <span className="text-sm text-danger">{o.reason}</span>}
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
