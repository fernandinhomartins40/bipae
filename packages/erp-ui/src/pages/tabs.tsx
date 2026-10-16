import { cents, formatBRL, type TabView } from '@bipae/domain';
import { Alert, DataTable, EmptyState, PageHeader, SelectField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));

/** Há quanto tempo, em minutos ou horas. */
function since(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Comandas abertas (F5-07): o que está em cada mesa agora, em todas as lojas, como o caixa
 * lançou. A tela se atualiza sozinha.
 */
export function TabsPage() {
  const { api } = useApp();
  const [storeId, setStoreId] = useState('');
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const tabs = useQuery({
    queryKey: ['tabs', storeId],
    queryFn: () => api.get<TabView[]>(`/tabs${storeId ? `?storeId=${storeId}` : ''}`),
    refetchInterval: 15_000,
  });
  const list = tabs.data ?? [];
  const total = list.reduce((sum, t) => sum + t.totalCents, 0);
  return (
    <>
      <PageHeader
        title="Comandas abertas"
        description="As mesas e comandas abertas nos caixas, com o que já foi lançado. Atualiza sozinha a cada 15 segundos."
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
      {tabs.error && <Alert>{(tabs.error as Error).message}</Alert>}
      {tabs.data && list.length === 0 && (
        <EmptyState title="Nenhuma comanda aberta">
          As comandas abertas no caixa aparecem aqui depois da sincronização.
        </EmptyState>
      )}
      {list.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted" data-testid="tabs-total">
            {list.length} {list.length === 1 ? 'comanda aberta' : 'comandas abertas'} · {brl(total)}{' '}
            em consumo
          </p>
          <DataTable
            caption="Comandas abertas"
            rows={list}
            columns={[
              { header: 'Comanda', cell: (t) => <span className="font-semibold">{t.label}</span> },
              {
                header: 'Loja',
                cell: (t) => stores.data?.find((s) => s.id === t.storeId)?.name ?? '—',
              },
              { header: 'Aberta há', cell: (t) => since(t.openedAt) },
              {
                header: 'Itens',
                cell: (t) =>
                  t.items
                    .map(
                      (i) =>
                        `${(i.quantityMilli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.name}`,
                    )
                    .join(', ') || '—',
              },
              { header: 'Valor', align: 'right', cell: (t) => brl(t.totalCents) },
            ]}
          />
        </>
      )}
    </>
  );
}
