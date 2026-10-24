import {
  formatBRL,
  formatTaxId,
  PAYMENT_LABELS,
  type Cents,
  type PaymentMethod,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  buttonClass,
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  StatCard,
  StatGrid,
} from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Banknote, Receipt, ScanBarcode, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApp, useCan } from '../context';
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

type Show = 'all' | 'sales' | 'returns' | 'cancelled';

const SHOW: Record<Show, (s: SaleRow) => boolean> = {
  all: () => true,
  sales: (s) => s.kind === 'sale' && s.status === 'completed',
  returns: (s) => s.kind === 'return',
  cancelled: (s) => s.kind === 'sale' && s.status === 'cancelled',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function SaleKind({ sale: s }: { sale: SaleRow }) {
  if (s.kind === 'return') return <Badge tone="warning">Devolução</Badge>;
  if (s.status === 'cancelled') return <Badge tone="danger">Cancelada</Badge>;
  return <Badge tone="success">Venda</Badge>;
}

const methodsText = (s: SaleRow) => s.methods.map((m) => PAYMENT_LABELS[m]).join(', ') || '—';

export function SalesPage() {
  const { api } = useApp();
  const canSell = useCan('pos.sell');
  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api.get<{ items: SaleRow[]; total: number }>('/sales?limit=200'),
    refetchInterval: 15_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('all');
  const items = sales.data?.items ?? [];
  const completed = items.filter(SHOW.sales);
  const revenue = completed.reduce((a, s) => a + s.totalCents, 0);
  const count = (key: Show) => items.filter(SHOW[key]).length;
  const rows = items.filter(SHOW[show]);

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Vendas de todos os caixas, assim que chegam. Vendas feitas sem internet aparecem quando o caixa sincroniza."
        icon={<BarChart3 />}
        tone="green"
      />
      {sales.error && <Alert>{(sales.error as Error).message}</Alert>}
      {items.length > 0 && (
        <>
          <StatGrid label="Resumo das vendas" columns={3}>
            <StatCard
              label="Vendas"
              tone="green"
              icon={<ShoppingBag />}
              value={String(completed.length)}
              hint="Das vendas listadas abaixo."
            />
            <StatCard
              label="Faturamento"
              tone="blue"
              icon={<Banknote />}
              value={formatBRL(revenue as Cents)}
              hint="Sem as canceladas e as devoluções."
            />
            <StatCard
              label="Ticket médio"
              tone="purple"
              icon={<Receipt />}
              value={formatBRL(
                (completed.length ? Math.round(revenue / completed.length) : 0) as Cents,
              )}
              hint="Quanto cada venda deixou, em média."
            />
          </StatGrid>
          <div className="mb-5">
            <FilterChips
              label="Mostrar"
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'Todas', count: items.length },
                { value: 'sales', label: 'Vendas', count: count('sales') },
                { value: 'returns', label: 'Devoluções', count: count('returns') },
                { value: 'cancelled', label: 'Canceladas', count: count('cancelled') },
              ]}
            />
          </div>
        </>
      )}
      {sales.data && items.length === 0 ? (
        <EmptyState
          title="Nenhuma venda ainda"
          icon={<ScanBarcode />}
          tone="green"
          action={
            canSell && (
              <Link to="/caixa" className={buttonClass('primary')}>
                Ir para o caixa
              </Link>
            )
          }
        >
          Abra o caixa e faça a primeira venda. Bipou? Bipaê!
        </EmptyState>
      ) : rows.length === 0 && items.length > 0 ? (
        <EmptyState title="Nada com esse filtro" tone="yellow">
          Escolha outro filtro acima para ver as demais.
        </EmptyState>
      ) : (
        sales.data && (
          <DataTable
            caption="Vendas"
            rows={rows}
            onRowClick={(sale) => setOpen(sale.id)}
            card={(s) => (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-bold">
                    {s.terminalName} · nº {s.terminalSeq}
                  </span>
                  <span className="text-sm text-muted">
                    {dateTime.format(new Date(s.occurredAt))} · {methodsText(s)}
                  </span>
                  {s.customerTaxId && (
                    <span className="text-sm text-muted">{formatTaxId(s.customerTaxId)}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-lg font-extrabold tabular-nums">
                    {formatBRL(s.totalCents as Cents)}
                  </span>
                  <SaleKind sale={s} />
                </span>
              </>
            )}
            columns={[
              { header: 'Quando', cell: (s) => dateTime.format(new Date(s.occurredAt)) },
              {
                header: 'Caixa',
                cell: (s) => (
                  <span className="font-semibold">{`${s.terminalName} · nº ${s.terminalSeq}`}</span>
                ),
              },
              { header: 'Tipo', cell: (s) => <SaleKind sale={s} /> },
              { header: 'Pagamento', cell: methodsText },
              {
                header: 'Cliente',
                cell: (s) => (s.customerTaxId ? formatTaxId(s.customerTaxId) : '—'),
              },
              {
                header: 'Total',
                align: 'right',
                cell: (s) => (
                  <span className="text-lg font-extrabold">{formatBRL(s.totalCents as Cents)}</span>
                ),
              },
            ]}
          />
        )
      )}
      {open && <SaleDetailDrawer saleId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
