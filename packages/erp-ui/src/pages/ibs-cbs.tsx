import { cents, formatBRL, type IbsCbsBalanceView, type IbsCbsSettlementView } from '@bipae/domain';
import { Alert, Card, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(new Date())
    .slice(0, 7);

function BalanceCard({ title, b }: { title: string; b: IbsCbsBalanceView }) {
  return (
    <Card className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="flex justify-between">
        <span>Débito das vendas</span>
        <span>{brl(b.debitCents)}</span>
      </p>
      <p className="flex justify-between">
        <span>Crédito das compras</span>
        <span>− {brl(b.creditCents)}</span>
      </p>
      <p className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
        {b.creditLeftCents > 0 ? (
          <>
            <span>Sobra de crédito</span>
            <span data-testid={`${title}-saldo`}>{brl(b.creditLeftCents)}</span>
          </>
        ) : (
          <>
            <span>A recolher</span>
            <span data-testid={`${title}-saldo`}>{brl(b.payableCents)}</span>
          </>
        )}
      </p>
    </Card>
  );
}

/** Apuração gerencial do IBS e da CBS (F4-13), por empresa e mês. */
export function IbsCbsPage() {
  const { api } = useApp();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () =>
      api.get<{ id: string; legalName: string; tradeName: string | null }[]>('/companies'),
  });
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const company = companyId || companies.data?.[0]?.id || '';
  const result = useQuery({
    queryKey: ['ibs-cbs', company, month],
    queryFn: () =>
      api.get<IbsCbsSettlementView>(
        `/fiscal/ibs-cbs/settlement?companyId=${company}&month=${month}`,
      ),
    enabled: Boolean(company && /^\d{4}-\d{2}$/.test(month)),
    // O regime da empresa pode ter mudado agora há pouco: a conta sempre vem fresca.
    staleTime: 0,
  });
  const r = result.data;
  return (
    <>
      <PageHeader
        title="Apuração de IBS e CBS"
        description="Débitos das vendas contra os créditos das compras, no mês, por empresa. É uma conta gerencial para acompanhar e conversar com o contador; não substitui a apuração oficial."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Empresa"
          value={company}
          onChange={(e) => setCompanyId(e.target.value)}
          options={(companies.data ?? []).map((c) => ({
            value: c.id,
            label: c.tradeName ?? c.legalName,
          }))}
        />
        <TextField
          label="Mês"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      {result.error && <Alert>{(result.error as Error).message}</Alert>}
      {r && r.mode !== 'regular' && (
        <Alert
          tone="warning"
          title={r.mode === 'simples' ? 'Simples Nacional' : 'Falta configurar'}
        >
          {r.message}
        </Alert>
      )}
      {r && r.mode === 'regular' && r.ibs && r.cbs && (
        <div className="flex flex-col gap-4">
          {r.period && (
            <Alert tone="success" title="Fase de teste">
              {r.period.message} ({r.period.source})
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <BalanceCard title="IBS" b={r.ibs} />
            <BalanceCard title="CBS" b={r.cbs} />
          </div>
          <p className="text-sm text-muted">
            O IBS e a CBS são apurados separadamente: crédito de um não paga o outro. Devoluções do
            mês já estão descontadas do débito (IBS {brl(r.totals.returnsIbsCents)}, CBS{' '}
            {brl(r.totals.returnsCbsCents)}).
          </p>
        </div>
      )}
      {r && (r.pending.saleItemsWithoutTax > 0 || r.pending.purchaseItemsWithoutIbsCbs > 0) && (
        <Alert tone="warning" title="Ficou de fora da conta">
          {r.pending.saleItemsWithoutTax > 0 &&
            `${r.pending.saleItemsWithoutTax} item(ns) vendido(s) sem IBS/CBS calculado (confira o perfil fiscal dos produtos). `}
          {r.pending.purchaseItemsWithoutIbsCbs > 0 &&
            `${r.pending.purchaseItemsWithoutIbsCbs} item(ns) de compra sem IBS/CBS destacado ou de nota não autorizada.`}
        </Alert>
      )}
      {r && r.sources.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          Regras: {r.sources.join('; ')}. O crédito só vale depois que o fornecedor recolher o
          imposto; esta conta usa o valor destacado nas notas autorizadas do mês.
        </p>
      )}
    </>
  );
}
