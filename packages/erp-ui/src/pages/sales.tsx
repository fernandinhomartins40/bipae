import {
  formatBRL,
  formatTaxId,
  PAYMENT_LABELS,
  type Cents,
  type PaymentMethod,
} from '@bipae/domain';
import { Alert, Badge, DataTable, EmptyState, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';
import { SaleDetailDrawer } from './sale-detail';

interface SaleRow {
  id: string;
  kind: 'sale' | 'return';
  status: 'completed' | 'cancelled';
  terminalSeq: number;
  terminalName: string;
  totalCents: number;
  discountCents: number;
  customerTaxId: string | null;
  occurredAt: string;
  methods: PaymentMethod[];
}

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function SalesPage() {
  const { api } = useApp();
  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api.get<{ items: SaleRow[]; total: number }>('/sales?limit=200'),
    refetchInterval: 15_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const completed =
    sales.data?.items.filter((s) => s.kind === 'sale' && s.status === 'completed') ?? [];
  const revenue = completed.reduce((a, s) => a + s.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Vendas de todos os caixas, assim que chegam. Vendas feitas sem internet aparecem quando o caixa sincroniza."
      />
      {sales.error && <Alert>{(sales.error as Error).message}</Alert>}
      {sales.data && sales.data.items.length > 0 && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Vendas" value={String(completed.length)} />
          <Stat label="Faturamento" value={formatBRL(revenue as Cents)} />
          <Stat
            label="Ticket médio"
            value={formatBRL(
              (completed.length ? Math.round(revenue / completed.length) : 0) as Cents,
            )}
          />
        </div>
      )}
      {sales.data && sales.data.items.length === 0 ? (
        <EmptyState title="Nenhuma venda ainda">
          Abra o caixa e faça a primeira venda. Bipou? Bipaê!
        </EmptyState>
      ) : (
        sales.data && (
          <DataTable
            caption="Vendas"
            rows={sales.data.items}
            onRowClick={(sale) => setOpen(sale.id)}
            columns={[
              { header: 'Quando', cell: (s) => dateTime.format(new Date(s.occurredAt)) },
              { header: 'Caixa', cell: (s) => `${s.terminalName} · nº ${s.terminalSeq}` },
              {
                header: 'Tipo',
                cell: (s) =>
                  s.kind === 'return' ? (
                    <Badge tone="warning">Devolução</Badge>
                  ) : s.status === 'cancelled' ? (
                    <Badge tone="danger">Cancelada</Badge>
                  ) : (
                    <Badge tone="success">Venda</Badge>
                  ),
              },
              {
                header: 'Pagamento',
                cell: (s) => s.methods.map((m) => PAYMENT_LABELS[m]).join(', ') || '—',
              },
              {
                header: 'Cliente',
                cell: (s) => (s.customerTaxId ? formatTaxId(s.customerTaxId) : '—'),
              },
              { header: 'Total', align: 'right', cell: (s) => formatBRL(s.totalCents as Cents) },
            ]}
          />
        )
      )}
      {open && <SaleDetailDrawer saleId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-ui border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
