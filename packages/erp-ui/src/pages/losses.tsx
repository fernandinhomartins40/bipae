import { cents, formatBRL, type LossDashboardView } from '@bipae/domain';
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monthStart = () => `${today().slice(0, 8)}01`;
const quantity = (milli: number) =>
  (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const day = (iso: string) => iso.split('-').reverse().join('/');

function Total({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold tabular-nums">{value}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </Card>
  );
}

/**
 * Painel de prevenção de perdas (F5-05): o que sai do caixa e do estoque sem virar venda, por
 * operador e por produto, com alertas de quem foge do padrão.
 */
export function LossesPage() {
  const { api } = useApp();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [storeId, setStoreId] = useState('');
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const result = useQuery({
    queryKey: ['losses', from, to, storeId],
    queryFn: () =>
      api.get<LossDashboardView>(
        `/reports/losses?from=${from}&to=${to}${storeId ? `&storeId=${storeId}` : ''}`,
      ),
    enabled: valid,
  });
  const d = result.data;
  return (
    <>
      <PageHeader
        title="Prevenção de perdas"
        description="O que saiu do caixa e do estoque sem virar venda: cancelamentos, devoluções, descontos acima do limite, sangrias, faltas no fechamento, perdas de estoque e lotes vencidos."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
      {!valid && <Alert>Escolha um período válido.</Alert>}
      {result.error && <Alert>{(result.error as Error).message}</Alert>}
      {d && (
        <div className="flex flex-col gap-6">
          {d.alerts.length > 0 ? (
            <Alert tone="warning" title="Para olhar de perto">
              <ul className="list-disc pl-5" aria-label="Alertas">
                {d.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success" title="Nada fora do padrão no período">
              Nenhum operador ficou muito acima da média e não há perdas nem vencidos para olhar.
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Total
              label="Vendas canceladas"
              value={brl(d.totals.cancelledCents)}
              hint={`${d.totals.cancelledCount} de ${d.totals.salesCount} vendas`}
            />
            <Total
              label="Devoluções"
              value={brl(d.totals.returnsCents)}
              hint={`${d.totals.returnsCount} devoluções`}
            />
            <Total
              label="Descontos acima do limite"
              value={brl(d.totals.authorizedDiscountCents)}
              hint={`${d.totals.authorizedDiscountCount} vendas`}
            />
            <Total
              label="Sangrias"
              value={brl(d.totals.withdrawalsCents)}
              hint={`${d.totals.withdrawalsCount} retiradas`}
            />
            <Total
              label="Diferença nos fechamentos"
              value={brl(d.totals.cashDifferenceCents)}
              hint="Negativo: faltou dinheiro"
            />
            <Total label="Perdas de estoque (a custo)" value={brl(d.totals.stockLossCostCents)} />
            <Total label="Lotes vencidos (a custo)" value={brl(d.totals.expiredCostCents)} />
          </div>

          <section aria-label="Por operador">
            <h2 className="mb-2 text-lg font-bold">Por operador</h2>
            {d.operators.length === 0 ? (
              <EmptyState title="Nenhum movimento de caixa no período" />
            ) : (
              <DataTable
                caption="Por operador"
                rows={d.operators.map((o) => ({ ...o, id: o.operatorId }))}
                columns={[
                  {
                    header: 'Operador',
                    cell: (o) => (
                      <span className="flex flex-col">
                        <span className="font-semibold">{o.name}</span>
                        {o.alerts.map((a) => (
                          <span key={a} className="text-sm text-danger">
                            {a}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                  { header: 'Vendas', align: 'right', cell: (o) => o.salesCount },
                  {
                    header: 'Canceladas',
                    align: 'right',
                    cell: (o) =>
                      `${o.cancelledCount} (${(o.cancelRateBp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`,
                  },
                  { header: 'Devoluções', align: 'right', cell: (o) => brl(o.returnsCents) },
                  {
                    header: 'Descontos acima do limite',
                    align: 'right',
                    cell: (o) => brl(o.authorizedDiscountCents),
                  },
                  { header: 'Sangrias', align: 'right', cell: (o) => brl(o.withdrawalsCents) },
                  {
                    header: 'Fechamentos',
                    align: 'right',
                    cell: (o) =>
                      o.cashDifferenceCents < 0 ? (
                        <Badge tone="danger">{brl(o.cashDifferenceCents)}</Badge>
                      ) : (
                        brl(o.cashDifferenceCents)
                      ),
                  },
                ]}
              />
            )}
          </section>

          <section aria-label="Perdas de estoque">
            <h2 className="mb-2 text-lg font-bold">Perdas de estoque</h2>
            {d.products.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma perda de estoque no período.</p>
            ) : (
              <DataTable
                caption="Perdas de estoque"
                rows={d.products.map((p) => ({ ...p, id: p.productId }))}
                columns={[
                  { header: 'Produto', cell: (p) => p.name },
                  { header: 'Quantidade', align: 'right', cell: (p) => quantity(p.lostMilli) },
                  {
                    header: 'A custo',
                    align: 'right',
                    cell: (p) => (p.lostCostCents === null ? 'Sem custo' : brl(p.lostCostCents)),
                  },
                ]}
              />
            )}
          </section>

          <section aria-label="Lotes vencidos">
            <h2 className="mb-2 text-lg font-bold">Lotes vencidos no estoque</h2>
            {d.expiredLots.length === 0 ? (
              <p className="text-sm text-muted">Nenhum lote vencido no estoque.</p>
            ) : (
              <DataTable
                caption="Lotes vencidos"
                rows={d.expiredLots.map((l) => ({ ...l, id: `${l.productId}-${l.lotCode}` }))}
                columns={[
                  { header: 'Produto', cell: (l) => l.name },
                  { header: 'Lote', cell: (l) => l.lotCode },
                  { header: 'Venceu em', cell: (l) => day(l.expiresOn) },
                  { header: 'Quantidade', align: 'right', cell: (l) => quantity(l.quantityMilli) },
                  {
                    header: 'A custo',
                    align: 'right',
                    cell: (l) => (l.costCents === null ? 'Sem custo' : brl(l.costCents)),
                  },
                ]}
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}
