import { cents, formatBRL, type SalesReport, type SalesReportGroup } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  StatCard,
  StatGrid,
  TextField,
} from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { ChartColumn, CircleDollarSign, Download, Receipt, Ticket } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const pct = (bp: number | null) =>
  bp === null
    ? '—'
    : `${(bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Soma dias a uma data AAAA-MM-DD (meio-dia em UTC, para o horário de verão não atrapalhar). */
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const GROUPS: { value: SalesReportGroup; label: string }[] = [
  { value: 'product', label: 'Produto' },
  { value: 'operator', label: 'Operador' },
  { value: 'seller', label: 'Vendedor' },
  { value: 'store', label: 'Loja' },
  { value: 'payment', label: 'Forma de pagamento' },
  { value: 'day', label: 'Dia' },
];

type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'custom';

/** Período de cada atalho, a partir de hoje (no fuso de Brasília). */
function presetRange(preset: Exclude<Preset, 'custom'>, now: string): [string, string] {
  const firstOfMonth = `${now.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return [now, now];
    case 'week':
      return [addDays(now, -6), now];
    case 'month':
      return [firstOfMonth, now];
    case 'lastMonth': {
      const lastDay = addDays(firstOfMonth, -1);
      return [`${lastDay.slice(0, 8)}01`, lastDay];
    }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Últimos 7 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
];

/** Relatórios de vendas (F4-10), exportáveis em CSV, XLSX e PDF. */
export function ReportsPage() {
  const { api } = useApp();
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 8)}01`);
  const [to, setTo] = useState(now);
  const [group, setGroup] = useState<SalesReportGroup>('product');
  const [error, setError] = useState<string | null>(null);
  const query = `from=${from}&to=${to}&group=${group}`;
  const report = useQuery({
    queryKey: ['reports', 'sales', query],
    queryFn: () => api.get<SalesReport>(`/reports/sales?${query}`),
    enabled: Boolean(from && to && from <= to),
  });
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setError(null);
    try {
      const blob = await api.download(`/reports/sales/export?${query}&format=${format}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bipae-vendas-${group}-${from}-a-${to}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const preset: Preset =
    PRESETS.find((p) => {
      const [f, t] = presetRange(p.value as Exclude<Preset, 'custom'>, now);
      return f === from && t === to;
    })?.value ?? 'custom';
  const data = report.data;
  const rows = (data?.rows ?? []).map((r) => ({ ...r, id: r.key }));
  type Row = (typeof rows)[number];
  const isProduct = group === 'product';
  const abc = (r: Row) => (
    <Badge tone={r.abc === 'A' ? 'success' : r.abc === 'B' ? 'warning' : 'neutral'}>
      Curva {r.abc}
    </Badge>
  );
  return (
    <>
      <PageHeader
        title="Relatórios de vendas"
        description="Por produto, operador, loja, forma de pagamento ou dia."
        icon={<ChartColumn />}
        tone="purple"
        actions={(['csv', 'xlsx', 'pdf'] as const).map((f) => (
          <Button
            key={f}
            variant="secondary"
            icon={<Download className="size-4" aria-hidden />}
            onClick={() => void download(f)}
          >
            {f.toUpperCase()}
          </Button>
        ))}
      />
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <FilterChips
            label="Período"
            value={preset}
            onChange={(p) => {
              if (p === 'custom') return;
              const [f, t] = presetRange(p, now);
              setFrom(f);
              setTo(t);
            }}
            options={PRESETS}
          />
          <div className="flex flex-wrap gap-3">
            <TextField
              label="De"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <FilterChips label="Agrupar por" value={group} onChange={setGroup} options={GROUPS} />
      </div>
      {(error || report.error) && <Alert>{error ?? (report.error as Error).message}</Alert>}
      {data && (
        <StatGrid label="Resumo do período" columns={3}>
          <StatCard
            label="Vendas"
            tone="blue"
            icon={<Receipt />}
            value={data.salesCount.toLocaleString('pt-BR')}
          />
          <StatCard
            label="Receita"
            tone="green"
            icon={<CircleDollarSign />}
            value={brl(data.revenueCents)}
            valueTestId="report-revenue"
          />
          <StatCard
            label="Ticket médio"
            tone="purple"
            icon={<Ticket />}
            value={brl(data.avgTicketCents)}
          />
        </StatGrid>
      )}
      {data && rows.length === 0 ? (
        <EmptyState title="Nenhuma venda no período" icon={<ChartColumn />} tone="purple">
          Escolha outro período ou faça uma venda no caixa: ela aparece aqui assim que sincronizar.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Relatório de vendas"
            rows={rows}
            card={(r) => (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold">{r.label}</span>
                  <span className="text-sm text-muted">
                    {r.salesCount} venda{r.salesCount === 1 ? '' : 's'}
                    {isProduct &&
                      ` · ${((r.quantityMilli ?? 0) / 1000).toLocaleString('pt-BR', {
                        maximumFractionDigits: 3,
                      })} un.`}
                    {group !== 'payment' && ` · margem ${pct(r.marginBp)}`}
                  </span>
                  {isProduct && <span>{abc(r)}</span>}
                </span>
                <span className="shrink-0 text-lg font-extrabold tabular-nums">
                  {brl(r.revenueCents)}
                </span>
              </>
            )}
            columns={[
              {
                header: GROUPS.find((g) => g.value === group)!.label,
                cell: (r) => <span className="font-bold">{r.label}</span>,
              },
              ...(isProduct
                ? [
                    {
                      header: 'Qtd.',
                      align: 'right' as const,
                      cell: (r: Row) =>
                        ((r.quantityMilli ?? 0) / 1000).toLocaleString('pt-BR', {
                          maximumFractionDigits: 3,
                        }),
                    },
                    {
                      header: 'ABC',
                      cell: (r: Row) => (
                        <Badge
                          tone={r.abc === 'A' ? 'success' : r.abc === 'B' ? 'warning' : 'neutral'}
                        >
                          {r.abc}
                        </Badge>
                      ),
                    },
                  ]
                : []),
              { header: 'Vendas', align: 'right', cell: (r) => r.salesCount },
              {
                header: 'Receita',
                align: 'right',
                cell: (r) => <span className="font-extrabold">{brl(r.revenueCents)}</span>,
              },
              ...(group !== 'payment'
                ? [
                    {
                      header: 'Margem',
                      align: 'right' as const,
                      cell: (r: Row) => (r.marginCents === null ? '—' : brl(r.marginCents)),
                    },
                    {
                      header: 'Margem %',
                      align: 'right' as const,
                      cell: (r: Row) => pct(r.marginBp),
                    },
                  ]
                : []),
              { header: 'Ticket médio', align: 'right', cell: (r) => brl(r.avgTicketCents) },
            ]}
          />
        )
      )}
      <p className="mt-3 text-sm text-muted">
        Margem pelo custo atual do cadastro; sem custo cadastrado, a margem fica em branco. Curva
        ABC: A são os produtos que fazem os primeiros 80% da receita, B os próximos 15% e C o resto.
      </p>
    </>
  );
}
