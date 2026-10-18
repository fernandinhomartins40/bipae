import {
  CAMPAIGN_BODY_MAX,
  CAMPAIGN_SUBJECT_MAX,
  CRM_SEGMENT_LABELS,
  CRM_SEGMENTS,
  formatBRL,
  type Cents,
  type CrmCustomerRow,
  type CrmSegment,
  type CustomerSummary,
  type EmailCampaignView,
  type LoyaltyProgram,
  type LoyaltyStatement,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  MoneyField,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
      <LoyaltyProgramCard />
      {canExport && <CampaignsCard segment={segment} />}
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

const LOYALTY_KIND: Record<LoyaltyStatement['entries'][number]['kind'], string> = {
  earn: 'Ganhou na compra',
  redeem: 'Usou no caixa',
  reverse_earn: 'Estorno (cancelamento ou devolução)',
  reverse_redeem: 'Pontos devolvidos (venda cancelada)',
};

/** Pontos de fidelidade do cliente (F6-08.b). */
export function LoyaltyPanel({ customerId }: { customerId: string }) {
  const { api } = useApp();
  const statement = useQuery({
    queryKey: ['loyalty', customerId],
    queryFn: () => api.get<LoyaltyStatement>(`/loyalty/customers/${customerId}`),
  });
  const s = statement.data;
  if (!s?.hasTaxId || (s.points === 0 && s.entries.length === 0)) return null;
  return (
    <section className="rounded-ui border border-border p-4 text-sm" aria-labelledby="pontos">
      <h3 id="pontos" className="mb-2 font-semibold">
        Pontos de fidelidade
      </h3>
      <p data-testid="loyalty-balance">
        <span className="font-semibold">{s.points} pontos</span> (valem {money(s.valueCents)})
      </p>
      <ul className="mt-2 flex flex-col gap-1" aria-label="Extrato de pontos">
        {s.entries.slice(0, 10).map((e, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span>
              {LOYALTY_KIND[e.kind]} · {day(e.createdAt)}
              {e.expiresAt && e.points > 0 && ` · vence ${day(e.expiresAt)}`}
            </span>
            <span className={e.points > 0 ? 'text-success' : 'text-muted'}>
              {e.points > 0 ? `+${e.points}` : e.points}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Configuração do programa de pontos (F6-08.b), na tela Relacionamento. */
export function LoyaltyProgramCard() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const canEdit = useCan('catalog.price.write');
  const current = useQuery({
    queryKey: ['loyalty', 'program'],
    queryFn: () => api.get<{ program: LoyaltyProgram | null }>('/loyalty/program'),
  });
  const [form, setForm] = useState<LoyaltyProgram | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const p: LoyaltyProgram = form ??
    current.data?.program ?? {
      active: false,
      centsPerPoint: 100,
      pointValueCents: 5,
      expiryMonths: 6,
      minRedeemPoints: 100,
    };
  const set = (patch: Partial<LoyaltyProgram>) => setForm({ ...p, ...patch });
  const whole = (text: string) => Math.max(0, Math.floor(Number(text.replace(/\D/g, '')) || 0));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.put('/loyalty/program', p);
      await queryClient.invalidateQueries({ queryKey: ['loyalty'] });
      setForm(null);
      setMessage({
        ok: true,
        text: 'Programa de fidelidade salvo. Os caixas recebem na próxima sincronização.',
      });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!current.data) return null;
  return (
    <section className="mb-6 rounded-ui border border-border p-4" aria-labelledby="fidelidade">
      <h2 id="fidelidade" className="mb-1 text-lg font-bold">
        Programa de fidelidade
      </h2>
      <p className="mb-3 text-sm text-muted">
        O cliente ganha pontos nas compras com CPF ou CNPJ na nota e usa no caixa como desconto,
        mesmo sem internet. Os pontos que vencem primeiro são usados primeiro.
      </p>
      {message && (
        <div className="mb-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyField
          label="1 ponto a cada (R$ de compra)"
          value={p.centsPerPoint}
          onChange={(v) => set({ centsPerPoint: v ?? 0 })}
        />
        <MoneyField
          label="Cada ponto vale no caixa (R$)"
          value={p.pointValueCents}
          onChange={(v) => set({ pointValueCents: v ?? 0 })}
        />
        <TextField
          label="Os pontos vencem em (meses)"
          inputMode="numeric"
          value={String(p.expiryMonths)}
          onChange={(e) => set({ expiryMonths: whole(e.target.value) })}
        />
        <TextField
          label="Mínimo de pontos para usar"
          inputMode="numeric"
          value={String(p.minRedeemPoints)}
          onChange={(e) => set({ minRedeemPoints: whole(e.target.value) })}
        />
      </div>
      <div className="mt-3">
        <Checkbox
          label="Programa ligado"
          checked={p.active}
          onChange={(active) => set({ active })}
        />
      </div>
      {canEdit && (
        <Button className="mt-3" loading={busy} onClick={() => void save()}>
          Salvar programa
        </Button>
      )}
    </section>
  );
}

/**
 * Campanhas por e-mail (F6-08.c): o e-mail vai só para quem aceitou ofertas e tem e-mail, do
 * segmento escolhido acima. Cada um leva um link para não receber mais.
 */
export function CampaignsCard({ segment }: { segment: CrmSegment | null }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const campaigns = useQuery({
    queryKey: ['crm', 'campaigns'],
    queryFn: () => api.get<{ emailEnabled: boolean; items: EmailCampaignView[] }>('/crm/campaigns'),
  });
  const [form, setForm] = useState({ name: '', subject: '', body: '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const audience = segment ? CRM_SEGMENT_LABELS[segment].label.toLowerCase() : 'todos os clientes';

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.post<{ recipients: number }>('/crm/campaigns', { ...form, segment });
      await queryClient.invalidateQueries({ queryKey: ['crm', 'campaigns'] });
      setForm({ name: '', subject: '', body: '' });
      setMessage({
        ok: true,
        text: `Campanha enviada para ${r.recipients} ${r.recipients === 1 ? 'pessoa' : 'pessoas'}.`,
      });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!campaigns.data) return null;
  const items = campaigns.data.items;
  return (
    <section className="mb-6 rounded-ui border border-border p-4" aria-labelledby="campanhas">
      <h2 id="campanhas" className="mb-1 text-lg font-bold">
        Campanhas por e-mail
      </h2>
      {!campaigns.data.emailEnabled ? (
        <Alert tone="warning" title="Falta configurar">
          O envio de e-mails ainda não está ligado no Bipaê. Assim que estiver, você manda ofertas
          daqui para quem aceitou receber.
        </Alert>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Vai para {audience} que aceitaram receber ofertas e têm e-mail. Cada e-mail leva um link
            para a pessoa não receber mais, e o envio fica na auditoria (LGPD).
          </p>
          {message && (
            <div className="mb-3">
              <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Nome da campanha"
              hint="Só para você reconhecer depois."
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="Assunto do e-mail"
              value={form.subject}
              maxLength={CAMPAIGN_SUBJECT_MAX}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="mt-3">
            <Field label="Texto do e-mail" hint="Deixe uma linha em branco entre os parágrafos.">
              {(a11y) => (
                <textarea
                  {...a11y}
                  rows={6}
                  maxLength={CAMPAIGN_BODY_MAX}
                  className="w-full rounded-ui border border-border bg-surface p-3 text-base text-text"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Button className="mt-3" loading={busy} onClick={() => void send()}>
            {`Enviar para ${audience}`}
          </Button>
        </>
      )}
      {items.length > 0 && (
        <div className="mt-4">
          <DataTable
            caption="Campanhas enviadas"
            rows={items}
            columns={[
              { header: 'Campanha', cell: (c) => c.name },
              { header: 'Assunto', cell: (c) => c.subject },
              {
                header: 'Segmento',
                cell: (c) => (c.segment ? CRM_SEGMENT_LABELS[c.segment].label : 'Todos'),
              },
              { header: 'Enviados', align: 'right', cell: (c) => String(c.recipients) },
              { header: 'Descadastros', align: 'right', cell: (c) => String(c.unsubscribed) },
              { header: 'Data', cell: (c) => day(c.createdAt) },
            ]}
          />
        </div>
      )}
    </section>
  );
}
