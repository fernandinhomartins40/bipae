import type { InutilizationView, NumberingGapView } from '@bipae/domain';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const DEFAULT_REASON = 'Números da NFC-e que ficaram sem nota (devolução ou venda cancelada)';

const day = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

const range = (from: number, to: number) => (from === to ? `${from}` : `${from} a ${to}`);

/**
 * Inutilização de números da NFC-e (F3-17): os números que ficaram sem nota (devolução, venda
 * cancelada antes de a nota sair) precisam ser inutilizados na SEFAZ. A tela mostra os buracos
 * de cada série e pede a inutilização. Só homologação, como toda a emissão por enquanto.
 */
export function InutilizationPage() {
  const { api } = useApp();
  const canWrite = useCan('fiscal.profile.write');
  const queryClient = useQueryClient();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () =>
      api.get<{ id: string; legalName: string; tradeName: string | null }[]>('/companies'),
  });
  const [companyId, setCompanyId] = useState('');
  const company = companyId || companies.data?.[0]?.id || '';
  const gaps = useQuery({
    queryKey: ['inutilization-gaps', company],
    queryFn: () => api.get<NumberingGapView[]>(`/fiscal/inutilizations/gaps?companyId=${company}`),
    enabled: Boolean(company),
  });
  const history = useQuery({
    queryKey: ['inutilizations', company],
    queryFn: () => api.get<InutilizationView[]>(`/fiscal/inutilizations?companyId=${company}`),
    enabled: Boolean(company),
  });
  const [form, setForm] = useState({ series: '', from: '', to: '', reason: DEFAULT_REASON });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<InutilizationView | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (g: NumberingGapView) => {
    setDone(null);
    setError(null);
    setForm((f) => ({ ...f, series: String(g.series), from: String(g.from), to: String(g.to) }));
  };

  const submit = async () => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const result = await api.post<InutilizationView>('/fiscal/inutilizations', {
        companyId: company,
        series: Number(form.series),
        from: Number(form.from),
        to: Number(form.to),
        reason: form.reason,
      });
      setDone(result);
      await queryClient.invalidateQueries({ queryKey: ['inutilization-gaps', company] });
      await queryClient.invalidateQueries({ queryKey: ['inutilizations', company] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Inutilização de números"
        description="Números da NFC-e que ficaram sem nota, como devoluções e vendas canceladas antes de a nota sair, precisam ser inutilizados na SEFAZ. Ambiente de homologação (sem valor fiscal)."
      />
      <div className="mb-4 max-w-md">
        <SelectField
          label="Empresa"
          value={company}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setDone(null);
          }}
          options={(companies.data ?? []).map((c) => ({
            value: c.id,
            label: c.tradeName ?? c.legalName,
          }))}
        />
      </div>

      <section aria-label="Números sem nota" className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Números sem nota</h2>
        {gaps.error && <Alert>{(gaps.error as Error).message}</Alert>}
        {gaps.data && gaps.data.length === 0 && (
          <EmptyState title="Nenhum número para inutilizar">
            A numeração das NFC-e desta empresa está em ordem.
          </EmptyState>
        )}
        {gaps.data && gaps.data.length > 0 && (
          <DataTable
            caption="Números sem nota"
            rows={gaps.data.map((g) => ({ ...g, id: `${g.series}-${g.from}` }))}
            columns={[
              { header: 'Série', cell: (g) => g.series },
              { header: 'Números', cell: (g) => range(g.from, g.to) },
              {
                header: '',
                align: 'right',
                cell: (g) =>
                  canWrite ? (
                    <Button variant="secondary" onClick={() => pick(g)}>
                      Inutilizar
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </section>

      {canWrite && (
        <Card className="mb-6 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Pedir inutilização</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="Série"
              inputMode="numeric"
              value={form.series}
              onChange={(e) => setForm({ ...form, series: e.target.value })}
            />
            <TextField
              label="Do número"
              inputMode="numeric"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
            <TextField
              label="Até o número"
              inputMode="numeric"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </div>
          <TextField
            label="Justificativa"
            hint="De 15 a 255 caracteres; vai para a SEFAZ."
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          {error && <Alert>{error}</Alert>}
          {done && done.status === 'registered' && (
            <Alert tone="success" title="Números inutilizados">
              Série {done.series}, números {range(done.from, done.to)}
              {done.protocol && ` · protocolo ${done.protocol}`}.
            </Alert>
          )}
          {done && done.status === 'rejected' && (
            <Alert title={`A SEFAZ recusou. Código ${done.cStat}: ${done.xMotivo}`}>
              {done.help && (
                <span className="flex flex-col gap-1">
                  <span>
                    <strong>O que aconteceu:</strong> {done.help.cause}
                  </span>
                  <span>
                    <strong>O que fazer:</strong> {done.help.fix}
                  </span>
                </span>
              )}
            </Alert>
          )}
          <div>
            <Button
              loading={busy}
              disabled={!company || !form.series || !form.from || !form.to}
              onClick={() => void submit()}
            >
              Inutilizar na SEFAZ
            </Button>
          </div>
        </Card>
      )}

      <section aria-label="Pedidos feitos">
        <h2 className="mb-2 text-lg font-semibold">Pedidos feitos</h2>
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-muted">Nenhum pedido de inutilização ainda.</p>
        )}
        {history.data && history.data.length > 0 && (
          <DataTable
            caption="Pedidos de inutilização"
            rows={history.data}
            columns={[
              { header: 'Data', cell: (r) => day(r.createdAt) },
              { header: 'Série', cell: (r) => r.series },
              { header: 'Números', cell: (r) => range(r.from, r.to) },
              {
                header: 'Situação',
                cell: (r) =>
                  r.status === 'registered' ? (
                    <Badge tone="success">Inutilizados</Badge>
                  ) : (
                    <Badge tone="danger">Recusado ({r.cStat})</Badge>
                  ),
              },
              { header: 'Justificativa', cell: (r) => r.reason },
            ]}
          />
        )}
      </section>
    </>
  );
}
