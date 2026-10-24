import { cents, formatBRL, type CashFlowRow } from '@bipae/domain';
import {
  Alert,
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  StatCard,
  StatGrid,
  TextField,
} from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CalendarSearch, Scale, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const period = (p: string) => {
  const [y, m, d] = p.split('-');
  return d ? `${d}/${m}/${y}` : `${m}/${y}`;
};
const projected = (r: CashFlowRow) =>
  r.projectedInCents || r.projectedOutCents
    ? `+${brl(r.projectedInCents)} / −${brl(r.projectedOutCents)}`
    : '—';

/** Valor que não quebra no meio ("R$" numa linha e o número na outra). */
function Money({ cents: value }: { cents: number }) {
  return <span className="whitespace-nowrap">{brl(value)}</span>;
}

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
  const net = sum((r) => r.netCents);
  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description="Entradas, saídas e o previsto no período."
        icon={<TrendingUp />}
        tone="green"
      />
      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="flex flex-wrap gap-4">
          <TextField
            label="De"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <FilterChips
          label="Agrupar por"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'day', label: 'Dia' },
            { value: 'month', label: 'Mês' },
          ]}
        />
      </div>
      {from > to && <Alert tone="warning">A data final precisa ser depois da inicial.</Alert>}
      {flow.error && <Alert>{(flow.error as Error).message}</Alert>}
      {rows.length > 0 && (
        <StatGrid label="Resumo do período" columns={3}>
          <StatCard
            label="Entrou"
            tone="green"
            icon={<ArrowDownLeft />}
            value={brl(sum((r) => r.salesCents + r.receivedCents))}
            hint="Vendas e contas recebidas."
          />
          <StatCard
            label="Saiu"
            tone="orange"
            icon={<ArrowUpRight />}
            value={brl(sum((r) => r.paidCents))}
            hint="Contas pagas."
          />
          <StatCard
            label="Resultado do período"
            tone={net < 0 ? 'red' : 'blue'}
            icon={<Scale />}
            value={brl(net)}
            valueTestId="cash-flow-net"
            hint={
              net < 0
                ? 'Saiu mais do que entrou.'
                : net > 0
                  ? 'Entrou mais do que saiu.'
                  : 'Entrou o mesmo que saiu.'
            }
          />
        </StatGrid>
      )}
      {flow.data && rows.length === 0 ? (
        <EmptyState title="Sem movimento no período" icon={<CalendarSearch />} tone="blue">
          Vendas recebidas e contas pagas ou a vencer aparecem aqui. Experimente um período maior.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Fluxo de caixa"
            rows={rows}
            card={(r) => (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold">{period(r.period)}</span>
                  <span className="text-sm text-muted">
                    Vendas <Money cents={r.salesCents} /> · recebido{' '}
                    <Money cents={r.receivedCents} /> · pago <Money cents={r.paidCents} />
                  </span>
                  <span className="text-sm text-muted">Previsto: {projected(r)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-lg font-extrabold tabular-nums">{brl(r.netCents)}</span>
                  <span className="text-sm text-muted tabular-nums">
                    Saldo {brl(r.balanceCents)}
                  </span>
                </span>
              </>
            )}
            columns={[
              {
                header: group === 'day' ? 'Dia' : 'Mês',
                cell: (r) => <span className="font-semibold">{period(r.period)}</span>,
              },
              { header: 'Vendas', align: 'right', cell: (r) => brl(r.salesCents) },
              { header: 'Recebido', align: 'right', cell: (r) => brl(r.receivedCents) },
              { header: 'Pago', align: 'right', cell: (r) => brl(r.paidCents) },
              {
                header: 'Resultado',
                align: 'right',
                cell: (r) => <span className="font-extrabold">{brl(r.netCents)}</span>,
              },
              { header: 'Saldo', align: 'right', cell: (r) => brl(r.balanceCents) },
              { header: 'Previsto', align: 'right', cell: projected },
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
