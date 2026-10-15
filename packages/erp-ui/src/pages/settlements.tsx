import {
  cents,
  formatBRL,
  PAYMENT_LABELS,
  percentToBasisPoints,
  type SettlementDay,
  type SettlementRuleView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const bpText = (bp: number) => (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Recebíveis de cartão e Pix (F4-08): quanto cai, quando, e se já caiu no banco. */
export function SettlementsPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canWrite = useCan('finance.write');
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 8)}01`);
  const [to, setTo] = useState(now);
  const rules = useQuery({
    queryKey: ['finance', 'settlement-rules'],
    queryFn: () => api.get<SettlementRuleView[]>('/finance/settlement-rules'),
  });
  const list = useQuery({
    queryKey: ['finance', 'settlements', from, to],
    queryFn: () => api.get<SettlementDay[]>(`/finance/settlements?from=${from}&to=${to}`),
    enabled: Boolean(from && to && from <= to),
  });
  // Só o que a pessoa editou; o resto mostra o valor salvo.
  const [edits, setEdits] = useState<Record<string, { fee?: string; days?: string }>>({});
  const fee = (r: SettlementRuleView) => edits[r.method]?.fee ?? bpText(r.feeBp);
  const daysOf = (r: SettlementRuleView) => edits[r.method]?.days ?? String(r.days);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setMessage(null);
    try {
      const body = (rules.data ?? []).map((r) => {
        const feeBp = percentToBasisPoints(fee(r));
        const days = Number(daysOf(r));
        if (feeBp === null || !Number.isInteger(days))
          throw new Error(`Taxa ou prazo inválido em ${PAYMENT_LABELS[r.method]}.`);
        return { method: r.method, feeBp, days };
      });
      await api.put('/finance/settlement-rules', { rules: body });
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      setMessage({ ok: true, text: 'Taxas e prazos salvos.' });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  };
  const rows = (list.data ?? []).map((r) => ({ ...r, id: `${r.date}-${r.method}` }));
  const missing = rules.data?.some((r) => !r.configured);
  return (
    <>
      <PageHeader
        title="Recebíveis de cartão e Pix"
        description="Quanto as vendas no cartão e no Pix devem cair no banco, e quando."
      />
      <Card>
        <h2 className="mb-1 font-bold">Taxas e prazos</h2>
        {missing && (
          <p className="mb-2 text-sm text-muted">
            Falta configurar: sem as taxas da maquininha, o Bipaê considera taxa zero e os prazos
            usuais.
          </p>
        )}
        {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(rules.data ?? []).map((r) => (
            <div key={r.method} className="flex flex-col gap-2 rounded-ui border border-border p-3">
              <p className="font-semibold">{PAYMENT_LABELS[r.method]}</p>
              <TextField
                label={`Taxa de ${PAYMENT_LABELS[r.method]} (%)`}
                inputMode="decimal"
                value={fee(r)}
                disabled={!canWrite}
                onChange={(e) =>
                  setEdits((x) => ({ ...x, [r.method]: { ...x[r.method], fee: e.target.value } }))
                }
              />
              <TextField
                label={`Prazo de ${PAYMENT_LABELS[r.method]} (dias)`}
                inputMode="numeric"
                value={daysOf(r)}
                disabled={!canWrite}
                onChange={(e) =>
                  setEdits((x) => ({
                    ...x,
                    [r.method]: { ...x[r.method], days: e.target.value.replace(/\D/g, '') },
                  }))
                }
              />
            </div>
          ))}
        </div>
        {canWrite && (
          <Button className="mt-3" onClick={() => void save()}>
            Salvar taxas e prazos
          </Button>
        )}
      </Card>
      <div className="my-4 flex flex-wrap gap-4">
        <TextField
          label="Vendas de"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField label="até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma venda no cartão ou no Pix no período" />
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Recebimentos previstos"
            rows={rows}
            columns={[
              { header: 'Cai em', cell: (r) => day(r.date) },
              { header: 'Forma', cell: (r) => PAYMENT_LABELS[r.method] },
              { header: 'Vendas', align: 'right', cell: (r) => r.salesCount },
              { header: 'Bruto', align: 'right', cell: (r) => brl(r.grossCents) },
              { header: 'Taxa', align: 'right', cell: (r) => brl(r.feeCents) },
              { header: 'Líquido', align: 'right', cell: (r) => brl(r.netCents) },
              {
                header: 'No banco',
                cell: (r) =>
                  r.received ? (
                    <Badge tone="success">Recebido</Badge>
                  ) : r.date < now ? (
                    <Badge tone="danger">Não encontrado</Badge>
                  ) : (
                    <Badge tone="warning">A receber</Badge>
                  ),
              },
            ]}
          />
        )
      )}
      <p className="mt-3 text-sm text-muted">
        A conferência procura no extrato importado (Conciliação bancária) uma entrada com o valor
        líquido, na data ou no dia seguinte.
      </p>
    </>
  );
}
