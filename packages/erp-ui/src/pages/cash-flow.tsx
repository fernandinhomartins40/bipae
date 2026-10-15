import { cents, formatBRL, type CashFlowRow } from '@bipae/domain';
import { Alert, Card, DataTable, EmptyState, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const period = (p: string) => {
  const [y, m, d] = p.split('-');
  return d ? `${d}/${m}/${y}` : `${m}/${y}`;
};

/** Fluxo de caixa (F4-05): o que entrou e saiu, e o que está previsto. */
export function CashFlowPage() {
  const { api } = useApp();
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 8)}01`);
  const [to, setTo] = useState(now);
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const flow = useQuery({
    queryKey: ['finance', 'cash-flow', from, to, group],
    queryFn: () =>
      api.get<CashFlowRow[]>(`/finance/entries/cash-flow?from=${from}&to=${to}&group=${group}`),
    enabled: Boolean(from && to && from <= to),
  });
  const rows = (flow.data ?? []).map((r) => ({ ...r, id: r.period }));
  const sum = (pick: (r: CashFlowRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  return (
    <>
      <PageHeader title="Fluxo de caixa" description="Entradas, saídas e o previsto no período." />
      <div className="mb-4 flex flex-wrap gap-4">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField
          label="Agrupar por"
          value={group}
          onChange={(e) => setGroup(e.target.value as 'day' | 'month')}
          options={[
            { value: 'day', label: 'Dia' },
            { value: 'month', label: 'Mês' },
          ]}
        />
      </div>
      {flow.error && <Alert>{(flow.error as Error).message}</Alert>}
      {rows.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm text-muted">Entrou</p>
            <p className="text-2xl font-bold tabular-nums">
              {brl(sum((r) => r.salesCents + r.receivedCents))}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Saiu</p>
            <p className="text-2xl font-bold tabular-nums">{brl(sum((r) => r.paidCents))}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Resultado do período</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="cash-flow-net">
              {brl(sum((r) => r.netCents))}
            </p>
          </Card>
        </div>
      )}
      {flow.data && rows.length === 0 ? (
        <EmptyState title="Sem movimento no período">
          Vendas recebidas e contas pagas ou a vencer aparecem aqui.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Fluxo de caixa"
            rows={rows}
            columns={[
              { header: group === 'day' ? 'Dia' : 'Mês', cell: (r) => period(r.period) },
              { header: 'Vendas', align: 'right', cell: (r) => brl(r.salesCents) },
              { header: 'Recebido', align: 'right', cell: (r) => brl(r.receivedCents) },
              { header: 'Pago', align: 'right', cell: (r) => brl(r.paidCents) },
              { header: 'Resultado', align: 'right', cell: (r) => brl(r.netCents) },
              { header: 'Saldo', align: 'right', cell: (r) => brl(r.balanceCents) },
              {
                header: 'Previsto',
                align: 'right',
                cell: (r) =>
                  r.projectedInCents || r.projectedOutCents
                    ? `+${brl(r.projectedInCents)} / −${brl(r.projectedOutCents)}`
                    : '—',
              },
            ]}
          />
        )
      )}
      <p className="mt-4 text-sm text-muted">
        Vendas no crediário entram quando o cliente paga. O saldo soma só o que já entrou ou saiu.
      </p>
    </>
  );
}
