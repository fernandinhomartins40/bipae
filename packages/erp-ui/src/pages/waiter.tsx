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
import { CameraScanButton } from '@bipae/pdv-ui';
import { Link } from 'react-router';
import { useApp, useCan } from '../context';
import { useOrderDevice } from '../use-order-device';

const brl = (value: number) => formatBRL(cents(value));

/** O que o pedido precisa de um produto (vem do aparelho ou da API). */
type OrderProduct = Pick<Product, 'id' | 'name' | 'priceCents'>;

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
  const { api, platform } = useApp();
  const canReceive = useCan('pos.sell');
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
  const od = useOrderDevice();
  const [label, setLabel] = useState('');
  const [search, setSearch] = useState('');
  // Com o aparelho pronto, a busca é local e funciona sem internet (F8-04).
  const found = useQuery({
    queryKey: ['waiter-products', search, Boolean(od.device), od.catalogAt],
    queryFn: async (): Promise<OrderProduct[]> =>
      od.device && od.catalogAt
        ? od.device.search(search)
        : (
            await api.get<Page<Product>>(`/products?q=${encodeURIComponent(search)}&limit=10`)
          ).items.filter((p) => p.active),
    enabled: search.trim().length >= 2,
    // A busca no aparelho não depende de rede: não pode pausar quando a internet cai.
    networkMode: od.device && od.catalogAt ? 'always' : 'online',
  });
  const [cart, setCart] = useState<{ product: OrderProduct; quantity: number }[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (product: OrderProduct) => {
    setCart((c) => {
      const at = c.find((i) => i.product.id === product.id);
      return at
        ? c.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...c, { product, quantity: 1 }];
    });
    setSearch('');
  };
  /** Código lido pela câmera (F8-05): acha no aparelho ou na API e põe no pedido. */
  const addByCode = async (code: string) => {
    const hits =
      od.device && od.catalogAt
        ? await od.device.search(code, 1)
        : (await api.get<Page<Product>>(`/products?q=${encodeURIComponent(code)}&limit=1`)).items;
    const product = hits[0];
    if (product) add(product);
    else setMessage({ ok: false, text: `Código ${code} não encontrado. Busque pelo nome.` });
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
    if (od.device) {
      setBusy(true);
      try {
        const { pending } = await od.enqueue({
          storeId: store,
          label,
          items: cart.map((i) => ({
            productId: i.product.id,
            quantityMilli: i.quantity * 1000,
            name: i.product.name,
          })),
        });
        setCart([]);
        if (!pending) {
          setMessage({ ok: true, text: `${label}: pedido enviado. O caixa recebe em instantes.` });
        } else if (pending.status === 'failed') {
          setMessage({ ok: false, text: `${label}: o pedido não entrou. ${pending.error ?? ''}` });
        } else {
          setMessage({
            ok: true,
            text: `Sem internet: o pedido de ${label} ficou guardado no celular e sai sozinho quando a internet voltar.`,
          });
        }
        await queryClient.invalidateQueries({ queryKey: ['tab-orders'] });
      } catch (e) {
        setMessage({ ok: false, text: (e as Error).message });
      } finally {
        setBusy(false);
      }
      return;
    }
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
      {canReceive && (
        <p className="text-sm">
          Também recebe pagamento?{' '}
          <Link to="/caixa" className="font-semibold text-primary underline">
            Receber neste aparelho
          </Link>{' '}
          abre o caixa aqui mesmo.
        </p>
      )}
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
      {od.catalogAt && (
        <p className="text-sm text-muted" data-testid="device-ready">
          Pronto para vender sem internet: produtos atualizados às{' '}
          {new Date(od.catalogAt).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}.
        </p>
      )}
      <Card className="flex flex-col gap-3">
        <TextField
          label="Buscar produto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Digite o nome"
        />
        <CameraScanButton platform={platform} onCode={(code) => void addByCode(code)} />
        {found.data && search.trim().length >= 2 && (
          <ul className="flex flex-col divide-y divide-border" aria-label="Produtos encontrados">
            {found.data.map((p) => (
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
      {od.queue.length > 0 && (
        <section aria-label="Guardados no celular" className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Guardados no celular</h2>
          {od.queue.map((o) => (
            <Card key={o.id} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{o.label}</span>
                <Badge tone={o.status === 'failed' ? 'danger' : 'warning'}>
                  {o.status === 'failed' ? 'Não entrou' : 'Esperando internet'}
                </Badge>
              </span>
              <span className="text-sm text-muted">
                {o.items
                  .map((i) => `${(i.quantityMilli / 1000).toLocaleString('pt-BR')} ${i.name}`)
                  .join(', ')}
              </span>
              {o.error && <span className="text-sm text-danger">{o.error}</span>}
              {o.status === 'failed' && (
                <Button variant="ghost" onClick={() => void od.discard(o.id)}>
                  Descartar
                </Button>
              )}
            </Card>
          ))}
        </section>
      )}
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
