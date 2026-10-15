import { cents, formatBRL, type DreMonth, type DreReport } from '@bipae/domain';
import { Alert, EmptyState, PageHeader, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(new Date())
    .slice(0, 7);
const monthsBefore = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};
const label = (ym: string) => `${ym.slice(5)}/${ym.slice(0, 4)}`;

const LINES: { label: string; pick: (m: DreMonth) => number; strong?: boolean; minus?: boolean }[] =
  [
    { label: 'Receita bruta de vendas', pick: (m) => m.grossRevenueCents },
    { label: '(−) Devoluções', pick: (m) => m.returnsCents, minus: true },
    { label: '(−) Impostos sobre a venda', pick: (m) => m.taxesCents, minus: true },
    { label: '= Receita líquida', pick: (m) => m.netRevenueCents, strong: true },
    { label: '(−) Custo da mercadoria vendida', pick: (m) => m.cogsCents, minus: true },
    { label: '= Lucro bruto', pick: (m) => m.grossProfitCents, strong: true },
    { label: '(−) Despesas', pick: (m) => m.expensesCents, minus: true },
    { label: '= Resultado', pick: (m) => m.resultCents, strong: true },
  ];

/** DRE gerencial (F4-06): o resultado do negócio mês a mês. */
export function DrePage() {
  const { api } = useApp();
  const [to, setTo] = useState(thisMonth());
  const [from, setFrom] = useState(monthsBefore(thisMonth(), 2));
  const report = useQuery({
    queryKey: ['finance', 'dre', from, to],
    queryFn: () => api.get<DreReport>(`/finance/entries/dre?from=${from}&to=${to}`),
    enabled: /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to,
  });
  const months = report.data?.months ?? [];
  const categories = [...new Set(months.flatMap((m) => m.expenses.map((e) => e.category)))];
  return (
    <>
      <PageHeader
        title="DRE gerencial"
        description="Quanto o negócio vendeu, gastou e ganhou em cada mês."
      />
      <div className="mb-4 flex flex-wrap gap-4">
        <TextField
          label="De (mês)"
          type="month"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          label="Até (mês)"
          type="month"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {report.error && <Alert>{(report.error as Error).message}</Alert>}
      {report.data && months.length === 0 ? (
        <EmptyState title="Sem movimento no período">
          Vendas e contas a pagar aparecem aqui.
        </EmptyState>
      ) : (
        months.length > 0 && (
          <div className="overflow-x-auto rounded-ui border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">DRE gerencial</caption>
              <thead>
                <tr className="text-left">
                  <th className="px-3 py-2"> </th>
                  {months.map((m) => (
                    <th key={m.month} className="px-3 py-2 text-right">
                      {label(m.month)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINES.map((line) => (
                  <tr
                    key={line.label}
                    className={`border-t border-border ${line.strong ? 'font-bold' : ''}`}
                  >
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {line.strong ? <strong>{line.label}</strong> : line.label}
                    </th>
                    {months.map((m) => (
                      <td key={m.month} className="px-3 py-2 text-right tabular-nums">
                        {line.minus && line.pick(m) > 0 ? '−' : ''}
                        {brl(line.pick(m))}
                      </td>
                    ))}
                  </tr>
                ))}
                {categories.map((category) => (
                  <tr key={category} className="border-t border-border text-muted">
                    <th scope="row" className="px-3 py-1 pl-8 text-left font-normal">
                      {category}
                    </th>
                    {months.map((m) => (
                      <td key={m.month} className="px-3 py-1 text-right tabular-nums">
                        {brl(m.expenses.find((e) => e.category === category)?.cents ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {report.data?.notes.map((note) => (
        <p key={note} className="mt-2 text-sm text-muted">
          {note}
        </p>
      ))}
      <p className="mt-2 text-sm text-muted">
        Despesas são as contas a pagar do mês, por categoria; compras de mercadoria ficam no custo.
      </p>
    </>
  );
}
