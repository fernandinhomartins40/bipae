import {
  CRM_SEGMENT_LABELS,
  CRM_SEGMENTS,
  formatBRL,
  type Cents,
  type CrmCustomerRow,
  type CrmSegment,
  type CustomerSummary,
} from '@bipae/domain';
import { Alert, Badge, Button, DataTable, EmptyState, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const money = (cents: number) => formatBRL(cents as Cents);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const qty = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const SEGMENT_TONE: Record<CrmSegment, 'success' | 'warning' | 'neutral' | 'danger'> = {
  novo: 'success',
  frequente: 'success',
  ativo: 'neutral',
  sumido: 'warning',
};

/** Ficha do cliente (F6-08.a): o que ele comprou com o CPF/CNPJ na nota. */
export function CustomerSummaryPanel({ customerId }: { customerId: string }) {
  const { api } = useApp();
  const summary = useQuery({
    queryKey: ['crm', 'summary', customerId],
    queryFn: () => api.get<CustomerSummary>(`/crm/customers/${customerId}/summary`),
  });
  const s = summary.data;
  return (
    <section className="rounded-ui border border-border p-4" aria-labelledby="historico-cliente">
      <h3 id="historico-cliente" className="mb-2 font-semibold">
        Histórico de compras
      </h3>
      {summary.error && <Alert>{(summary.error as Error).message}</Alert>}
      {s && !s.hasTaxId && (
        <p className="text-sm text-muted">
          Cadastre o CPF ou CNPJ para juntar as compras em que o cliente deu o documento na nota.
        </p>
      )}
      {s && s.hasTaxId && s.purchases === 0 && (
        <p className="text-sm text-muted">Nenhuma compra com este CPF/CNPJ ainda.</p>
      )}
      {s && s.purchases > 0 && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {s.segment && (
              <Badge tone={SEGMENT_TONE[s.segment]}>{CRM_SEGMENT_LABELS[s.segment].label}</Badge>
            )}
          </p>
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-muted">Compras</dt>
              <dd className="font-semibold">{s.purchases}</dd>
            </div>
            <div>
              <dt className="text-muted">Total (menos devoluções)</dt>
              <dd className="font-semibold">{money(s.totalCents)}</dd>
            </div>
            <div>
              <dt className="text-muted">Ticket médio</dt>
              <dd className="font-semibold">
                {s.averageTicketCents === null ? '—' : money(s.averageTicketCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Última compra</dt>
              <dd className="font-semibold">{day(s.lastPurchaseAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">Cliente desde</dt>
              <dd className="font-semibold">{day(s.firstPurchaseAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">Volta, em média, a cada</dt>
              <dd className="font-semibold">
                {s.averageIntervalDays === null ? '—' : `${s.averageIntervalDays} dia(s)`}
              </dd>
            </div>
          </dl>
          {s.topProducts.length > 0 && (
            <div>
              <p className="mb-1 text-muted">O que mais compra</p>
              <ul aria-label="O que mais compra" className="flex flex-col gap-1">
                {s.topProducts.map((p) => (
                  <li key={p.productId} className="flex justify-between gap-2">
                    <span>{p.name}</span>
                    <span className="text-muted">
                      {qty(p.quantityMilli)} · {money(p.totalCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Relacionamento (F6-08.a): quem compra com CPF/CNPJ, separado em novos, frequentes, ativos e
 * sumidos. A lista para ofertas sai só com quem aceitou receber (LGPD).
 */
export function CrmPage() {
  const { api } = useApp();
  const canExport = useCan('crm.export');
  const [segment, setSegment] = useState<CrmSegment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['crm', 'customers', segment],
    queryFn: () =>
      api.get<{ counts: Record<CrmSegment, number>; items: CrmCustomerRow[] }>(
        `/crm/customers${segment ? `?segment=${segment}` : ''}`,
      ),
  });

  const download = async () => {
    setError(null);
    try {
      const blob = await api.download(`/crm/export.csv${segment ? `?segment=${segment}` : ''}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clientes-ofertas.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const counts = list.data?.counts;
  const rows = (list.data?.items ?? []).map((r) => ({ ...r, id: r.customerId }));
  return (
    <>
      <PageHeader
        title="Relacionamento"
        description="Quem compra com CPF ou CNPJ na nota, separado por comportamento. Use para chamar de volta quem sumiu e cuidar de quem é frequente."
        actions={
          canExport && (
            <Button
              variant="secondary"
              icon={<Download className="size-4" aria-hidden />}
              onClick={() => void download()}
            >
              Lista para ofertas (CSV)
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Segmentos">
        <Button variant={segment === null ? 'primary' : 'ghost'} onClick={() => setSegment(null)}>
          Todos
        </Button>
        {CRM_SEGMENTS.map((s) => (
          <Button
            key={s}
            variant={segment === s ? 'primary' : 'ghost'}
            onClick={() => setSegment(s)}
          >
            {`${CRM_SEGMENT_LABELS[s].label}${counts ? ` (${counts[s]})` : ''}`}
          </Button>
        ))}
      </div>
      {segment && <p className="mb-3 text-sm text-muted">{CRM_SEGMENT_LABELS[segment].rule}</p>}
      {canExport && (
        <p className="mb-3 text-sm text-muted">
          A lista para ofertas traz só quem aceitou receber ofertas e tem e-mail ou telefone. Cada
          exportação fica registrada na auditoria (LGPD).
        </p>
      )}
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Ninguém por aqui ainda">
          Os clientes aparecem quando compram com o CPF ou CNPJ na nota e estão cadastrados em
          Clientes.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Clientes"
            rows={rows}
            columns={[
              { header: 'Cliente', cell: (r) => r.name },
              {
                header: 'Segmento',
                cell: (r) => (
                  <Badge tone={SEGMENT_TONE[r.segment]}>
                    {CRM_SEGMENT_LABELS[r.segment].label}
                  </Badge>
                ),
              },
              { header: 'Compras', align: 'right', cell: (r) => String(r.purchases) },
              { header: 'Total', align: 'right', cell: (r) => money(r.totalCents) },
              { header: 'Última compra', cell: (r) => day(r.lastPurchaseAt) },
              {
                header: 'Ofertas',
                cell: (r) => (r.marketingConsent ? 'Aceita' : 'Não aceitou'),
              },
            ]}
          />
        )
      )}
    </>
  );
}
