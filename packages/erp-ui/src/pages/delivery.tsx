import {
  cents,
  formatBRL,
  parseBRL,
  type DeliveryView,
  type DeliveryZoneView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', timeStyle: 'short' }).format(
    new Date(iso),
  );
const phone = (digits: string) =>
  digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : digits.length === 10
      ? `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
      : digits;

const STATUS: Record<
  DeliveryView['status'],
  { label: string; tone: 'neutral' | 'warning' | 'success' }
> = {
  pending: { label: 'A sair', tone: 'warning' },
  out: { label: 'Saiu para entrega', tone: 'neutral' },
  delivered: { label: 'Entregue', tone: 'success' },
};

/**
 * Delivery (F5-10): os bairros que cada loja atende, com a taxa (que vai ao caixa), e as entregas
 * do dia, de "a sair" até "entregue".
 */
export function DeliveryPage() {
  const { api } = useApp();
  const canPrice = useCan('catalog.price.write');
  const queryClient = useQueryClient();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState('');
  const store = storeId || stores.data?.[0]?.id || '';
  const zones = useQuery({
    queryKey: ['delivery-zones', store],
    queryFn: () => api.get<DeliveryZoneView[]>(`/delivery-zones?storeId=${store}`),
    enabled: Boolean(store),
  });
  const deliveries = useQuery({
    queryKey: ['deliveries', store],
    queryFn: () => api.get<DeliveryView[]>(`/deliveries?storeId=${store}`),
    enabled: Boolean(store),
    refetchInterval: 15_000,
  });
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ['delivery-zones'] });
    await queryClient.invalidateQueries({ queryKey: ['deliveries'] });
  };
  const addZone = () =>
    run(async () => {
      const feeCents = parseBRL(fee);
      if (feeCents === null) throw new Error('Taxa inválida.');
      await api.post('/delivery-zones', { storeId: store, name, feeCents });
      setName('');
      setFee('');
    });
  const editFee = (z: DeliveryZoneView) =>
    run(async () => {
      const text = window.prompt(
        `Nova taxa para ${z.name} (R$)`,
        brl(z.feeCents).replace('R$ ', ''),
      );
      if (text === null) return;
      const feeCents = parseBRL(text);
      if (feeCents === null) throw new Error('Taxa inválida.');
      await api.put(`/delivery-zones/${z.id}`, {
        storeId: z.storeId,
        name: z.name,
        feeCents,
        active: z.active,
      });
    });
  const toggle = (z: DeliveryZoneView) =>
    run(() =>
      api.put(`/delivery-zones/${z.id}`, {
        storeId: z.storeId,
        name: z.name,
        feeCents: z.feeCents,
        active: !z.active,
      }),
    );

  return (
    <>
      <PageHeader
        title="Delivery"
        description="Os bairros que a loja atende e a taxa de cada um, que o caixa soma na venda para entrega. Abaixo, as entregas do dia."
      />
      {(stores.data?.length ?? 0) > 1 && (
        <div className="mb-4 max-w-sm">
          <SelectField
            label="Loja"
            value={store}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      )}
      {error && <Alert>{error}</Alert>}

      <section aria-label="Entregas do dia" className="mb-6">
        <h2 className="mb-2 text-lg font-bold">Entregas do dia</h2>
        {deliveries.data && deliveries.data.length === 0 && (
          <EmptyState title="Nenhuma entrega hoje">
            A venda para entrega feita no caixa aparece aqui depois da sincronização.
          </EmptyState>
        )}
        {(deliveries.data?.length ?? 0) > 0 && (
          <DataTable
            caption="Entregas do dia"
            rows={deliveries.data!.map((d) => ({ ...d, id: d.saleId }))}
            columns={[
              { header: 'Hora', cell: (d) => time(d.occurredAt) },
              {
                header: 'Para',
                cell: (d) => (
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {d.delivery.name} · {phone(d.delivery.phone)}
                    </span>
                    <span className="text-sm text-muted">
                      {d.delivery.address.street}, {d.delivery.address.number}
                      {d.delivery.address.complement
                        ? ` - ${d.delivery.address.complement}`
                        : ''}, {d.delivery.address.district}
                    </span>
                  </span>
                ),
              },
              { header: 'Valor', align: 'right', cell: (d) => brl(d.totalCents) },
              {
                header: 'Situação',
                cell: (d) => <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>,
              },
              {
                header: '',
                align: 'right',
                cell: (d) =>
                  d.status === 'pending' ? (
                    <Button
                      variant="secondary"
                      onClick={() => void run(() => api.post(`/deliveries/${d.saleId}/out`))}
                    >
                      Saiu para entrega
                    </Button>
                  ) : d.status === 'out' ? (
                    <Button
                      onClick={() => void run(() => api.post(`/deliveries/${d.saleId}/delivered`))}
                    >
                      Entregue
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </section>

      <section aria-label="Bairros atendidos">
        <h2 className="mb-2 text-lg font-bold">Bairros atendidos</h2>
        {canPrice && (
          <Card className="mb-3 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <TextField label="Bairro" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              label="Taxa (R$)"
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <Button
              disabled={!store || name.trim().length < 2 || !fee}
              onClick={() => void addZone()}
            >
              Adicionar bairro
            </Button>
          </Card>
        )}
        {zones.data && zones.data.length === 0 && (
          <p className="text-sm text-muted">Nenhum bairro cadastrado ainda.</p>
        )}
        {(zones.data?.length ?? 0) > 0 && (
          <DataTable
            caption="Bairros atendidos"
            rows={zones.data!}
            columns={[
              { header: 'Bairro', cell: (z) => z.name },
              { header: 'Taxa', align: 'right', cell: (z) => brl(z.feeCents) },
              {
                header: 'Situação',
                cell: (z) =>
                  z.active ? <Badge tone="success">Atende</Badge> : <Badge>Não atende</Badge>,
              },
              {
                header: '',
                align: 'right',
                cell: (z) =>
                  canPrice ? (
                    <span className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => void editFee(z)}>
                        Mudar taxa
                      </Button>
                      <Button variant="ghost" onClick={() => void toggle(z)}>
                        {z.active ? 'Parar de atender' : 'Voltar a atender'}
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
