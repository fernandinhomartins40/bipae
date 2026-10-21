import { cents, formatBRL, type SalesReport, type SalesReportGroup } from '@bipae/domain';
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
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const pct = (bp: number | null) =>
  bp === null
    ? '—'
    : `${(bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const GROUPS: { value: SalesReportGroup; label: string }[] = [
  { value: 'product', label: 'Produto (com curva ABC)' },
  { value: 'operator', label: 'Operador' },
  { value: 'seller', label: 'Vendedor' },
  { value: 'store', label: 'Loja' },
  { value: 'payment', label: 'Forma de pagamento' },
  { value: 'day', label: 'Dia' },
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
  const data = report.data;
  const rows = (data?.rows ?? []).map((r) => ({ ...r, id: r.key }));
  const isProduct = group === 'product';
  return (
    <>
      <PageHeader
        title="Relatórios de vendas"
        description="Por produto, operador, loja, forma de pagamento ou dia."
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <TextField label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField
          label="Agrupar por"
          value={group}
          onChange={(e) => setGroup(e.target.value as SalesReportGroup)}
          options={GROUPS}
        />
        <div className="flex gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <Button
              key={f}
              variant="secondary"
              icon={<Download className="size-4" aria-hidden />}
              onClick={() => void download(f)}
            >
              {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      {(error || report.error) && <Alert>{error ?? (report.error as Error).message}</Alert>}
      {data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-sm text-muted">Vendas</p>
            <p className="text-2xl font-bold tabular-nums">{data.salesCount}</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Receita</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="report-revenue">
              {brl(data.revenueCents)}
            </p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Ticket médio</p>
            <p className="text-2xl font-bold tabular-nums">{brl(data.avgTicketCents)}</p>
          </Card>
        </div>
      )}
      {data && rows.length === 0 ? (
        <EmptyState title="Nenhuma venda no período" />
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Relatório de vendas"
            rows={rows}
            columns={[
              {
                header: GROUPS.find((g) => g.value === group)!.label.replace(
                  ' (com curva ABC)',
                  '',
                ),
                cell: (r) => r.label,
              },
              ...(isProduct
                ? [
                    {
                      header: 'Qtd.',
                      align: 'right' as const,
                      cell: (r: (typeof rows)[number]) =>
                        ((r.quantityMilli ?? 0) / 1000).toLocaleString('pt-BR', {
                          maximumFractionDigits: 3,
                        }),
                    },
                    {
                      header: 'ABC',
                      cell: (r: (typeof rows)[number]) => (
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
              { header: 'Receita', align: 'right', cell: (r) => brl(r.revenueCents) },
              ...(group !== 'payment'
                ? [
                    {
                      header: 'Margem',
                      align: 'right' as const,
                      cell: (r: (typeof rows)[number]) =>
                        r.marginCents === null ? '—' : brl(r.marginCents),
                    },
                    {
                      header: 'Margem %',
                      align: 'right' as const,
                      cell: (r: (typeof rows)[number]) => pct(r.marginBp),
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
