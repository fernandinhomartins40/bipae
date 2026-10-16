import type { KitchenTicketView } from '@bipae/domain';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, SelectField, cx } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

/** Depois disso o pedido aparece em destaque (está demorando). */
const LATE_MINUTES = 15;

const minutesSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
const quantity = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/**
 * Tela da cozinha (F5-09): os itens "preparados na cozinha" lançados nas comandas, na ordem em
 * que chegaram. A cozinha marca "Pronto"; quem leva à mesa marca "Entregue". Atualiza a cada 5
 * segundos; pode ficar aberta num tablet ou numa TV da cozinha.
 */
export function KitchenPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const tickets = useQuery({
    queryKey: ['kitchen', storeId],
    queryFn: () =>
      api.get<KitchenTicketView[]>(`/kitchen/tickets${storeId ? `?storeId=${storeId}` : ''}`),
    refetchInterval: 5000,
  });
  const advance = async (id: string, to: 'ready' | 'delivered') => {
    setError(null);
    try {
      await api.post(`/kitchen/tickets/${id}/${to}`);
    } catch (e) {
      setError((e as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ['kitchen'] });
  };
  const open = (tickets.data ?? []).filter((t) => t.status !== 'delivered');
  // Agrupado por comanda, na ordem do pedido mais antigo de cada uma.
  const byTab = new Map<string, KitchenTicketView[]>();
  for (const t of open) byTab.set(t.tabId, [...(byTab.get(t.tabId) ?? []), t]);
  const delivered = (tickets.data ?? []).filter((t) => t.status === 'delivered');

  return (
    <>
      <PageHeader
        title="Cozinha"
        description="Os pratos lançados nas comandas, na ordem em que chegaram. Marque Pronto quando sair da cozinha e Entregue quando chegar à mesa."
      />
      <div className="mb-4 max-w-sm">
        <SelectField
          label="Loja"
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          options={[
            { value: '', label: 'Todas as lojas' },
            ...(stores.data ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
      {(error || tickets.error) && <Alert>{error ?? (tickets.error as Error).message}</Alert>}
      {tickets.data && open.length === 0 && (
        <EmptyState title="Nenhum pedido na cozinha">
          Os produtos marcados como &quot;Preparado na cozinha&quot; aparecem aqui quando são
          lançados numa comanda.
        </EmptyState>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...byTab.values()].map((items) => (
          <Card key={items[0]!.tabId} className="flex flex-col gap-2">
            <section aria-label={`Comanda ${items[0]!.tabLabel}`} className="flex flex-col gap-2">
              <h2 className="text-xl font-bold">{items[0]!.tabLabel}</h2>
              <ul className="flex flex-col gap-2">
                {items.map((t) => {
                  const waited = minutesSince(t.createdAt);
                  return (
                    <li
                      key={t.id}
                      className={cx(
                        'flex flex-wrap items-center justify-between gap-2 rounded-ui border p-2',
                        t.status === 'ready'
                          ? 'border-success'
                          : waited >= LATE_MINUTES
                            ? 'border-danger'
                            : 'border-border',
                      )}
                    >
                      <span className="flex flex-col">
                        <span className="text-lg font-semibold">
                          {quantity(t.quantityMilli)} × {t.name}
                        </span>
                        <span
                          className={cx(
                            'text-sm',
                            waited >= LATE_MINUTES && t.status === 'pending'
                              ? 'font-semibold text-danger'
                              : 'text-muted',
                          )}
                        >
                          {t.status === 'ready' ? 'Pronto' : `Esperando há ${waited} min`}
                        </span>
                      </span>
                      {t.status === 'pending' ? (
                        <Button onClick={() => void advance(t.id, 'ready')}>Pronto</Button>
                      ) : (
                        <Button variant="secondary" onClick={() => void advance(t.id, 'delivered')}>
                          Entregue
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </Card>
        ))}
      </div>
      {delivered.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          <Badge>{delivered.length}</Badge> entregue(s) na última meia hora.
        </p>
      )}
    </>
  );
}
