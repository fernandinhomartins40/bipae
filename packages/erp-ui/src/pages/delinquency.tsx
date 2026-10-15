import { cents, formatBRL, formatTaxId, type DelinquentCustomer } from '@bipae/domain';
import { Alert, Badge, DataTable, EmptyState, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Inadimplência do crediário (F4-09): quem está com parcela vencida e há quanto tempo. */
export function DelinquencyPage() {
  const { api } = useApp();
  const list = useQuery({
    queryKey: ['finance', 'delinquency'],
    queryFn: () => api.get<DelinquentCustomer[]>('/finance/entries/delinquency'),
  });
  const rows = (list.data ?? []).map((r) => ({ ...r, id: r.taxId }));
  const total = rows.reduce((sum, r) => sum + r.overdueCents, 0);
  return (
    <>
      <PageHeader
        title="Inadimplência do crediário"
        description="Clientes com parcela vencida. O recebimento é feito na ficha do cliente."
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Ninguém em atraso">
          Todas as parcelas do crediário estão em dia.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <>
            <p className="mb-3 text-lg">
              Em atraso: <strong data-testid="delinquency-total">{brl(total)}</strong> de{' '}
              {rows.length} cliente(s)
            </p>
            <DataTable
              caption="Clientes com parcela vencida"
              rows={rows}
              columns={[
                {
                  header: 'Cliente',
                  cell: (r) => (
                    <span>
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-sm text-muted">
                        {formatTaxId(r.taxId)}
                        {r.phone && ` · ${r.phone}`}
                      </span>
                    </span>
                  ),
                },
                { header: 'Em atraso', align: 'right', cell: (r) => brl(r.overdueCents) },
                { header: 'Parcelas', align: 'right', cell: (r) => r.installments },
                { header: 'Venceu em', cell: (r) => `${day(r.oldestDue)} (${r.daysLate} dias)` },
                {
                  header: 'Crediário',
                  cell: (r) =>
                    r.blocked ? (
                      <Badge tone="danger">Bloqueado no caixa</Badge>
                    ) : (
                      <Badge tone="warning">Em tolerância</Badge>
                    ),
                },
              ]}
            />
          </>
        )
      )}
      <p className="mt-3 text-sm text-muted">
        Cada venda no crediário vence em 30 dias. Com parcela vencida há mais de 5 dias, o caixa não
        vende mais no crediário para o cliente até ele pagar.
      </p>
    </>
  );
}
