import {
  formatBRL,
  formatTaxId,
  LIMIT_LABELS,
  LIMIT_RESOURCES,
  PLATFORM_ROLE_LABELS,
  TENANT_STATUS_LABELS,
  type Cents,
  type LimitResource,
  type PlanLimits,
  type PlatformRole,
  type TenantStatus,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  Modal,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useDeferredValue, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DailyBars, lastDays, StatTile, UsageBar } from './charts';
import { useAdmin } from './admin-app';
import { TenantBillingPanel } from './billing-pages';

const brl = (c: number | null | undefined) =>
  c === null || c === undefined ? '—' : formatBRL(c as Cents);
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const when = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');

const STATUS_TONE: Record<TenantStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  trial: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};

function StatusBadge({ status }: { status: TenantStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{TENANT_STATUS_LABELS[status]}</Badge>;
}

function ErrorBox({ error }: { error: unknown }) {
  return error ? <Alert>{(error as Error).message}</Alert> : null;
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </Card>
  );
}

// ================================================================= dashboard

interface Dashboard {
  tenants: Partial<Record<TenantStatus, number>>;
  byPlan: { planId: string; name: string; tenants: number }[];
  mrrCents: number;
  activeTerminals24h: number;
  activeTenants7d: number;
  signups: { day: string; count: number }[];
  sales: { day: string; count: number; totalCents: number }[];
  trialsEnding: { id: string; name: string; trialEndsAt: string | null }[];
}

export function DashboardPage() {
  const { api } = useAdmin();
  const data = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<Dashboard>('/admin/dashboard'),
  });
  const d = data.data;
  return (
    <>
      <PageHeader title="Visão geral" description="Saúde da plataforma e dos clientes." />
      <ErrorBox error={data.error} />
      {d && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Clientes ativos"
              value={String(d.tenants.active ?? 0)}
              hint={`${d.tenants.trial ?? 0} em teste`}
            />
            <StatTile
              label="Receita mensal estimada"
              value={brl(d.mrrCents)}
              hint="Soma dos planos pagos ativos"
            />
            <StatTile
              label="Usaram o sistema (7 dias)"
              value={String(d.activeTenants7d)}
              hint="Clientes com login na semana"
            />
            <StatTile
              label="Caixas ativos (24 h)"
              value={String(d.activeTerminals24h)}
              hint="Enviaram vendas ou eventos"
            />
            <StatTile label="Suspensos" value={String(d.tenants.suspended ?? 0)} />
            <StatTile label="Cancelados" value={String(d.tenants.cancelled ?? 0)} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <DailyBars
                title="Novos clientes por dia (30 dias)"
                points={lastDays(
                  d.signups.map((s) => ({ day: s.day, value: s.count })),
                  30,
                )}
              />
            </Card>
            <Card>
              <DailyBars
                title="Faturamento dos clientes por dia (30 dias)"
                points={lastDays(
                  d.sales.map((s) => ({ day: s.day, value: s.totalCents })),
                  30,
                )}
                format={(v) => brl(v)}
              />
            </Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Clientes por plano">
              <ul className="divide-y divide-border">
                {d.byPlan.map((p) => (
                  <li key={p.planId} className="flex justify-between py-2">
                    <Link
                      className="font-medium text-primary underline"
                      to={`/admin/clientes?plano=${p.planId}`}
                    >
                      {p.name}
                    </Link>
                    <span className="tabular-nums">{p.tenants}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Testes terminando em 7 dias">
              {d.trialsEnding.length === 0 ? (
                <p className="text-muted">Nenhum teste terminando.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.trialsEnding.map((t) => (
                    <li key={t.id} className="flex justify-between py-2">
                      <Link
                        className="font-medium text-primary underline"
                        to={`/admin/clientes/${t.id}`}
                      >
                        {t.name}
                      </Link>
                      <span>{t.trialEndsAt ? dateOnly.format(new Date(t.trialEndsAt)) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}

// ================================================================= clients

interface TenantRow {
  id: string;
  name: string;
  status: TenantStatus;
  planId: string;
  planName: string;
  trialEndsAt: string | null;
  createdAt: string;
  owner: string | null;
  users: number;
  terminals: number;
  products: number;
  sales30d: number;
  lastActivity: string | null;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  limits: PlanLimits;
  features: string[];
  public: boolean;
  active: boolean;
  sort: number;
  tenants: number;
}

function usePlans() {
  const { api } = useAdmin();
  return useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api.get<Plan[]>('/admin/plans') });
}

export function TenantsPage() {
  const { api, can } = useAdmin();
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState(params.get('plano') ?? '');
  const [creating, setCreating] = useState(false);
  const deferred = useDeferredValue(q.trim());
  const plans = usePlans();
  const list = useQuery({
    queryKey: ['admin', 'tenants', deferred, status, planId],
    queryFn: () =>
      api.get<{ items: TenantRow[]; total: number }>(
        `/admin/tenants?limit=200${deferred ? `&q=${encodeURIComponent(deferred)}` : ''}${status ? `&status=${status}` : ''}${planId ? `&planId=${planId}` : ''}`,
      ),
  });
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cada cliente é uma conta, com suas empresas, lojas, caixas e equipe."
        actions={
          can('platform.tenants.create') && (
            <Button onClick={() => setCreating(true)}>Novo cliente</Button>
          )
        }
      />
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <input
          type="search"
          aria-label="Buscar clientes"
          placeholder="Nome, CNPJ, razão social ou e-mail"
          className="min-h-11 rounded-ui border border-border bg-surface px-3"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Todas' },
            ...Object.entries(TENANT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <SelectField
          label="Plano"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={[
            { value: '', label: 'Todos' },
            ...(plans.data ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>
      <ErrorBox error={list.error} />
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title="Nenhum cliente encontrado" />
      ) : (
        list.data && (
          <DataTable
            caption="Clientes"
            rows={list.data.items}
            onRowClick={(t) => navigate(`/admin/clientes/${t.id}`)}
            columns={[
              {
                header: 'Cliente',
                cell: (t) => (
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-muted">{t.owner ?? 'sem dono'}</p>
                  </div>
                ),
              },
              { header: 'Situação', cell: (t) => <StatusBadge status={t.status} /> },
              { header: 'Plano', cell: (t) => t.planName },
              { header: 'Caixas', align: 'right', cell: (t) => t.terminals },
              { header: 'Usuários', align: 'right', cell: (t) => t.users },
              { header: 'Vendas (30 d)', align: 'right', cell: (t) => t.sales30d },
              { header: 'Última atividade', cell: (t) => when(t.lastActivity) },
              { header: 'Desde', cell: (t) => dateOnly.format(new Date(t.createdAt)) },
            ]}
          />
        )
      )}
      {list.data && <p className="mt-3 text-sm text-muted">{list.data.total} clientes</p>}
      {creating && <CreateTenant plans={plans.data ?? []} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateTenant({ plans, onClose }: { plans: Plan[]; onClose: () => void }) {
  const { api } = useAdmin();
  const navigate = useNavigate();
  const [v, setV] = useState({
    businessName: '',
    ownerName: '',
    ownerEmail: '',
    password: '',
    planId: 'gratis',
    trialDays: '',
  });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const trialEndsAt = v.trialDays
        ? new Date(Date.now() + Number(v.trialDays) * 86_400_000).toISOString()
        : null;
      const { id } = await api.post<{ id: string }>('/admin/tenants', {
        businessName: v.businessName,
        ownerName: v.ownerName,
        ownerEmail: v.ownerEmail,
        password: v.password,
        planId: v.planId,
        trialEndsAt,
      });
      navigate(`/admin/clientes/${id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Novo cliente">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome do negócio"
          value={v.businessName}
          onChange={(e) => setV({ ...v, businessName: e.target.value })}
        />
        <TextField
          label="Nome do dono"
          value={v.ownerName}
          onChange={(e) => setV({ ...v, ownerName: e.target.value })}
        />
        <TextField
          label="E-mail do dono"
          type="email"
          value={v.ownerEmail}
          onChange={(e) => setV({ ...v, ownerEmail: e.target.value })}
        />
        <TextField
          label="Senha inicial"
          type="password"
          autoComplete="new-password"
          hint="Combine com o cliente para trocar no primeiro acesso."
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
        />
        <SelectField
          label="Plano"
          value={v.planId}
          onChange={(e) => setV({ ...v, planId: e.target.value })}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
        />
        <TextField
          label="Dias de teste (opcional)"
          inputMode="numeric"
          value={v.trialDays}
          onChange={(e) => setV({ ...v, trialDays: e.target.value.replace(/\D/g, '') })}
        />
        <Button type="submit">Criar cliente</Button>
      </form>
    </Drawer>
  );
}

// ================================================================= client record

interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    status: TenantStatus;
    planId: string;
    trialEndsAt: string | null;
    statusReason: string | null;
    limitOverrides: Partial<PlanLimits> | null;
    createdAt: string;
  };
  plan: Plan;
  limits: PlanLimits;
  usage: Record<LimitResource, number>;
  sales30d: { count: number; totalCents: number };
  companies: {
    id: string;
    legalName: string;
    tradeName: string | null;
    taxId: string | null;
    uf: string | null;
  }[];
  stores: { id: string; name: string; companyId: string }[];
  terminals: {
    id: string;
    name: string;
    platform: string;
    nfceSeries: number;
    status: string;
    lastSync: string | null;
    lastSeq: number;
    storeId: string;
  }[];
  members: {
    userId: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    lastLogin: string | null;
  }[];
  events: {
    id: string;
    kind: string;
    data: Record<string, unknown> | null;
    createdAt: string;
    adminName: string | null;
  }[];
  audit: { seq: number; action: string; createdAt: string; data: unknown }[];
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Conta criada',
  plan_changed: 'Plano alterado',
  trial_set: 'Teste definido',
  suspended: 'Suspenso',
  reactivated: 'Reativado',
  cancelled: 'Cancelado',
  limits_changed: 'Limites especiais',
  note: 'Anotação',
  support_session: 'Acesso de suporte',
};

type Action = null | 'plan' | 'suspend' | 'reactivate' | 'cancel' | 'limits' | 'note' | 'support';

export function TenantDetailPage() {
  const { id = '' } = useParams();
  const { api, can } = useAdmin();
  const [action, setAction] = useState<Action>(null);
  const detail = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: () => api.get<TenantDetail>(`/admin/tenants/${id}`),
  });
  const d = detail.data;
  const queryClient = useQueryClient();
  const done = async () => {
    setAction(null);
    await queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  if (detail.error) return <ErrorBox error={detail.error} />;
  if (!d) return null;
  const manage = can('platform.tenants.manage');
  const storeName = (sid: string) => d.stores.find((s) => s.id === sid)?.name ?? '—';

  return (
    <>
      <p className="mb-2 text-sm">
        <Link to="/admin/clientes" className="text-primary underline">
          ← Clientes
        </Link>
      </p>
      <PageHeader
        title={d.tenant.name}
        description={`Cliente desde ${dateOnly.format(new Date(d.tenant.createdAt))} · plano ${d.plan.name}`}
        actions={<StatusBadge status={d.tenant.status} />}
      />
      {d.tenant.statusReason && d.tenant.status !== 'active' && (
        <Alert tone="warning" title="Motivo">
          {d.tenant.statusReason}
        </Alert>
      )}

      <div className="mb-6 mt-4 flex flex-wrap gap-2">
        {can('platform.support') && (
          <Button
            icon={<ExternalLink className="size-4" aria-hidden />}
            onClick={() => setAction('support')}
          >
            Acesso de suporte
          </Button>
        )}
        {manage && (
          <>
            <Button variant="secondary" onClick={() => setAction('plan')}>
              Mudar plano ou teste
            </Button>
            <Button variant="secondary" onClick={() => setAction('limits')}>
              Limites especiais
            </Button>
            {d.tenant.status === 'suspended' || d.tenant.status === 'cancelled' ? (
              <Button variant="secondary" onClick={() => setAction('reactivate')}>
                Reativar
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setAction('suspend')}>
                Suspender
              </Button>
            )}
            {d.tenant.status !== 'cancelled' && (
              <Button variant="ghost" onClick={() => setAction('cancel')}>
                Cancelar conta
              </Button>
            )}
          </>
        )}
        {can('platform.notes') && (
          <Button variant="ghost" onClick={() => setAction('note')}>
            Anotar
          </Button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Uso do plano">
          <div className="flex flex-col gap-3">
            {LIMIT_RESOURCES.map((r) => (
              <UsageBar
                key={r}
                label={LIMIT_LABELS[r].many[0]!.toUpperCase() + LIMIT_LABELS[r].many.slice(1)}
                used={d.usage[r]}
                limit={d.limits[r]}
              />
            ))}
          </div>
          {d.tenant.trialEndsAt && (
            <p className="mt-3 text-sm text-muted">
              Teste até {dateOnly.format(new Date(d.tenant.trialEndsAt))}
            </p>
          )}
          {d.tenant.limitOverrides && (
            <p className="mt-1 text-sm text-muted">Tem limites especiais negociados.</p>
          )}
        </Section>
        <Section title="Cobrança">
          <TenantBillingPanel tenantId={id} />
        </Section>
        <Section title="Movimento (30 dias)">
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="Vendas" value={d.sales30d.count.toLocaleString('pt-BR')} />
            <StatTile label="Faturamento" value={brl(d.sales30d.totalCents)} />
          </div>
        </Section>

        <Section title={`Empresas (${d.companies.length})`}>
          <ul className="divide-y divide-border">
            {d.companies.map((c) => (
              <li key={c.id} className="py-2">
                <p className="font-medium">{c.tradeName ?? c.legalName}</p>
                <p className="text-sm text-muted">
                  {c.taxId ? formatTaxId(c.taxId) : 'sem CNPJ'}
                  {c.uf && ` · ${c.uf}`} · lojas:{' '}
                  {d.stores
                    .filter((s) => s.companyId === c.id)
                    .map((s) => s.name)
                    .join(', ') || '—'}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Caixas (${d.terminals.length})`}>
          {d.terminals.length === 0 ? (
            <p className="text-muted">Nenhum caixa.</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.terminals.map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{t.name}</span>{' '}
                    <span className="text-sm text-muted">
                      · {t.platform === 'desktop' ? 'desktop' : 'navegador'} · série {t.nfceSeries}{' '}
                      · {storeName(t.storeId)}
                    </span>
                  </span>
                  <span className="text-sm">
                    {t.status === 'revoked' ? (
                      <Badge>Desativado</Badge>
                    ) : (
                      `sincronizou ${when(t.lastSync)}`
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`Equipe do cliente (${d.members.length})`}>
          <ul className="divide-y divide-border">
            {d.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{m.name}</span>{' '}
                  <span className="text-sm text-muted">
                    · {m.role} · {m.email}
                  </span>
                  <span className="block text-sm text-muted">
                    último acesso: {when(m.lastLogin)}
                  </span>
                </span>
                {manage && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      const r = await api.post<{ revoked: number }>(
                        `/admin/tenants/${id}/users/${m.userId}/revoke-sessions`,
                      );
                      alert(`${r.revoked} sessões encerradas.`);
                    }}
                  >
                    Encerrar sessões
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Histórico da conta">
          <ul className="flex flex-col gap-3">
            {d.events.map((e) => (
              <li key={e.id} className="border-l-4 border-border pl-3">
                <p className="font-medium">
                  {EVENT_LABELS[e.kind] ?? e.kind}
                  <span className="ml-2 text-sm font-normal text-muted">
                    {when(e.createdAt)}
                    {e.adminName && ` · ${e.adminName}`}
                  </span>
                </p>
                {e.data && <p className="text-sm text-muted">{describeEvent(e.kind, e.data)}</p>}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Auditoria recente do cliente">
          <ul className="divide-y divide-border text-sm">
            {d.audit.map((a) => (
              <li key={a.seq} className="flex justify-between gap-3 py-1.5">
                <span>
                  <span className="text-muted">#{a.seq}</span> {a.action}
                </span>
                <span className="text-muted">{when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {action === 'support' && (
        <SupportDialog tenantId={id} tenantName={d.tenant.name} onClose={() => setAction(null)} />
      )}
      {action === 'plan' && (
        <PlanDialog
          tenantId={id}
          current={d.tenant.planId}
          onClose={() => setAction(null)}
          onDone={done}
        />
      )}
      {action === 'limits' && (
        <LimitsDialog
          tenantId={id}
          limits={d.limits}
          overrides={d.tenant.limitOverrides}
          onClose={() => setAction(null)}
          onDone={done}
        />
      )}
      {(action === 'suspend' || action === 'reactivate' || action === 'cancel') && (
        <ReasonDialog
          title={
            {
              suspend: 'Suspender cliente',
              reactivate: 'Reativar cliente',
              cancel: 'Cancelar conta',
            }[action]
          }
          explanation={
            {
              suspend:
                'O cliente perde o acesso na hora e todas as sessões são encerradas. Vendas feitas sem internet continuam sendo recebidas.',
              reactivate: 'O cliente volta a usar o sistema normalmente.',
              cancel: 'A conta é encerrada. Os dados ficam guardados (obrigação fiscal de 5 anos).',
            }[action]
          }
          confirm={
            { suspend: 'Suspender', reactivate: 'Reativar', cancel: 'Cancelar conta' }[action]
          }
          danger={action !== 'reactivate'}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.post(`/admin/tenants/${id}/${action}`, { reason });
            await done();
          }}
        />
      )}
      {action === 'note' && (
        <ReasonDialog
          title="Anotar na ficha"
          explanation="Anotações são internas: o cliente não vê."
          confirm="Salvar anotação"
          field="Anotação"
          onClose={() => setAction(null)}
          onConfirm={async (note) => {
            await api.post(`/admin/tenants/${id}/notes`, { note });
            await done();
          }}
        />
      )}
    </>
  );
}

function describeEvent(kind: string, data: Record<string, unknown>) {
  const parts: string[] = [];
  if (data.from && data.to) parts.push(`${String(data.from)} → ${String(data.to)}`);
  if (data.trialEndsAt)
    parts.push(`teste até ${dateOnly.format(new Date(String(data.trialEndsAt)))}`);
  if (data.reason) parts.push(String(data.reason));
  if (data.note) parts.push(String(data.note));
  if (kind === 'support_session') parts.push(data.readOnly ? 'somente leitura' : 'com alterações');
  return parts.join(' · ');
}

function ReasonDialog({
  title,
  explanation,
  confirm,
  danger,
  field = 'Motivo',
  onClose,
  onConfirm,
}: {
  title: string;
  explanation: string;
  confirm: string;
  danger?: boolean;
  field?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onConfirm(reason);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="text-muted">{explanation}</p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label={field}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <Button type="submit" variant={danger ? 'danger' : 'primary'}>
          {confirm}
        </Button>
      </form>
    </Modal>
  );
}

function SupportDialog({
  tenantId,
  tenantName,
  onClose,
}: {
  tenantId: string;
  tenantName: string;
  onClose: () => void;
}) {
  const { api, can, appBase } = useAdmin();
  const [reason, setReason] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Acesso de suporte">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const s = await api.post<{ accessToken: string; expiresIn: number; readOnly: boolean }>(
              `/admin/tenants/${tenantId}/impersonate`,
              { reason, readOnly },
            );
            const expires = Date.now() + s.expiresIn * 1000;
            // Token goes in the fragment: never sent to any server, cleared from the address bar on open.
            window.open(
              `${appBase}/suporte#token=${encodeURIComponent(s.accessToken)}&exp=${expires}`,
              '_blank',
              'noopener',
            );
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="text-muted">
          Abre {tenantName} numa nova aba como o dono da conta, por 30 minutos. O cliente vê esse
          acesso na auditoria dele.
        </p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Motivo (fica registrado)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        {can('platform.tenants.manage') && (
          <Checkbox
            label="Somente leitura"
            hint="Desmarque só se precisar corrigir algo para o cliente. Cada alteração fica marcada com o seu nome."
            checked={readOnly}
            onChange={setReadOnly}
          />
        )}
        <Button type="submit">Abrir como o cliente</Button>
      </form>
    </Modal>
  );
}

function PlanDialog({
  tenantId,
  current,
  onClose,
  onDone,
}: {
  tenantId: string;
  current: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { api } = useAdmin();
  const plans = usePlans();
  const [planId, setPlanId] = useState(current);
  const [trialDays, setTrialDays] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Mudar plano ou teste">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post(`/admin/tenants/${tenantId}/plan`, {
              planId,
              trialEndsAt: trialDays
                ? new Date(Date.now() + Number(trialDays) * 86_400_000).toISOString()
                : null,
              reason,
            });
            await onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <Alert>{error}</Alert>}
        <SelectField
          label="Plano"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          options={(plans.data ?? [])
            .filter((p) => p.active)
            .map((p) => ({ value: p.id, label: `${p.name} · ${brl(p.priceCents)}` }))}
        />
        <TextField
          label="Dias de teste (deixe vazio para plano definitivo)"
          inputMode="numeric"
          value={trialDays}
          onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ''))}
        />
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit">Salvar</Button>
      </form>
    </Modal>
  );
}

function LimitsDialog({
  tenantId,
  limits,
  overrides,
  onClose,
  onDone,
}: {
  tenantId: string;
  limits: PlanLimits;
  overrides: Partial<PlanLimits> | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { api } = useAdmin();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      LIMIT_RESOURCES.map((r) => [
        r,
        overrides && r in overrides
          ? overrides[r] === null
            ? 'ilimitado'
            : String(overrides[r])
          : '',
      ]),
    ),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Limites especiais">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed: Partial<PlanLimits> = {};
          for (const r of LIMIT_RESOURCES) {
            const v = values[r]!.trim().toLowerCase();
            if (!v) continue;
            parsed[r] = v === 'ilimitado' ? null : Number(v);
          }
          try {
            await api.post(`/admin/tenants/${tenantId}/limits`, { overrides: parsed, reason });
            await onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="text-muted">
          Vazio = usa o limite do plano. Digite "ilimitado" para tirar o limite.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMIT_RESOURCES.map((r) => (
            <TextField
              key={r}
              label={`${LIMIT_LABELS[r].many} (plano: ${limits[r] ?? 'ilimitado'})`}
              value={values[r]}
              onChange={(e) => setValues({ ...values, [r]: e.target.value })}
            />
          ))}
        </div>
        <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit">Salvar limites</Button>
      </form>
    </Modal>
  );
}

// ================================================================= people

interface Person {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  staffRole: PlatformRole | null;
  clients: { tenantId: string; name: string; status: TenantStatus; active: boolean }[];
}

export function PeoplePage() {
  const { api, can } = useAdmin();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const people = useQuery({
    queryKey: ['admin', 'people', deferred],
    queryFn: () => api.get<Person[]>(`/admin/users?q=${encodeURIComponent(deferred)}`),
    enabled: deferred.length >= 2,
  });
  return (
    <>
      <PageHeader
        title="Pessoas"
        description="Encontre qualquer pessoa em qualquer cliente pelo nome ou e-mail."
      />
      <input
        type="search"
        aria-label="Buscar pessoas"
        placeholder="Nome ou e-mail (mínimo 2 letras)"
        className="mb-4 min-h-11 w-full max-w-xl rounded-ui border border-border bg-surface px-3"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <ErrorBox error={people.error} />
      <div className="flex flex-col gap-3">
        {people.data?.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {p.name}{' '}
                  {p.staffRole && (
                    <Badge tone="warning">Equipe Bipaê · {PLATFORM_ROLE_LABELS[p.staffRole]}</Badge>
                  )}
                </p>
                <p className="text-sm text-muted">
                  {p.email} · conta desde {dateOnly.format(new Date(p.createdAt))}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {p.clients.map((c) => (
                    <li key={c.tenantId}>
                      <Link to={`/admin/clientes/${c.tenantId}`} className="text-primary underline">
                        {c.name}
                      </Link>{' '}
                      {!c.active && <span className="text-sm text-muted">(bloqueado)</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {can('platform.tenants.manage') && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Encerrar todas as sessões de ${p.email}?`)) return;
                    const r = await api.post<{ revoked: number }>(
                      `/admin/users/${p.id}/revoke-sessions`,
                    );
                    alert(`${r.revoked} sessões encerradas.`);
                  }}
                >
                  Encerrar todas as sessões
                </Button>
              )}
              {can('platform.tenants.manage') && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (
                      !confirm(
                        `Zerar a verificação em duas etapas de ${p.email}? Faça isso só depois de confirmar que é a própria pessoa (ela perdeu o celular). As sessões abertas serão encerradas.`,
                      )
                    )
                      return;
                    await api.post(`/admin/users/${p.id}/reset-totp`);
                    alert(
                      'Verificação em duas etapas zerada. A pessoa pode entrar só com a senha e ativar de novo.',
                    );
                  }}
                >
                  Zerar verificação em duas etapas
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

// ================================================================= plans

export function PlansPage() {
  const { can } = useAdmin();
  const plans = usePlans();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Planos"
        description="Limites e preços. Mudanças valem na hora para todos os clientes do plano."
        actions={
          can('platform.plans.manage') && (
            <Button onClick={() => setEditing('new')}>Novo plano</Button>
          )
        }
      />
      <ErrorBox error={plans.error} />
      {plans.data && (
        <DataTable
          caption="Planos"
          rows={plans.data}
          onRowClick={can('platform.plans.manage') ? setEditing : undefined}
          columns={[
            { header: 'Plano', cell: (p) => <span className="font-semibold">{p.name}</span> },
            {
              header: 'Preço/mês',
              align: 'right',
              cell: (p) => (p.priceCents === null ? 'a definir' : brl(p.priceCents)),
            },
            ...LIMIT_RESOURCES.map((r) => ({
              header: LIMIT_LABELS[r].many[0]!.toUpperCase() + LIMIT_LABELS[r].many.slice(1),
              align: 'right' as const,
              cell: (p: Plan) => p.limits[r] ?? '∞',
            })),
            { header: 'Clientes', align: 'right', cell: (p) => p.tenants },
            {
              header: 'Situação',
              cell: (p) =>
                p.active ? (
                  p.public ? (
                    <Badge tone="success">Público</Badge>
                  ) : (
                    <Badge>Privado</Badge>
                  )
                ) : (
                  <Badge tone="danger">Inativo</Badge>
                ),
            },
          ]}
        />
      )}
      {editing && (
        <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function PlanForm({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const { api } = useAdmin();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    id: plan?.id ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price:
      plan?.priceCents === null || plan?.priceCents === undefined
        ? ''
        : String(plan.priceCents / 100).replace('.', ','),
    features: plan?.features.join(', ') ?? 'pos, offline',
    public: plan?.public ?? true,
    active: plan?.active ?? true,
    sort: String(plan?.sort ?? 10),
    limits: Object.fromEntries(
      LIMIT_RESOURCES.map((r) => [
        r,
        plan ? (plan.limits[r] === null ? '' : String(plan.limits[r])) : '',
      ]),
    ) as Record<string, string>,
  });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      id: v.id,
      name: v.name,
      description: v.description || null,
      priceCents:
        v.price.trim() === ''
          ? null
          : Math.round(Number(v.price.replace(/\./g, '').replace(',', '.')) * 100),
      limits: Object.fromEntries(
        LIMIT_RESOURCES.map((r) => [r, v.limits[r]!.trim() === '' ? null : Number(v.limits[r])]),
      ),
      features: v.features
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean),
      public: v.public,
      active: v.active,
      sort: Number(v.sort) || 0,
    };
    try {
      if (plan) await api.put(`/admin/plans/${plan.id}`, body);
      else await api.post('/admin/plans', body);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={plan ? `Plano ${plan.name}` : 'Novo plano'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Código"
          value={v.id}
          disabled={Boolean(plan)}
          onChange={(e) => setV({ ...v, id: e.target.value })}
          hint="Ex.: mercado-plus. Não muda depois."
        />
        <TextField
          label="Nome"
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
        <TextField
          label="Descrição"
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
        <TextField
          label="Preço por mês (R$)"
          inputMode="decimal"
          hint="Vazio = a definir"
          value={v.price}
          onChange={(e) => setV({ ...v, price: e.target.value })}
        />
        <p className="text-sm font-semibold">Limites (vazio = ilimitado)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {LIMIT_RESOURCES.map((r) => (
            <TextField
              key={r}
              label={LIMIT_LABELS[r].many}
              inputMode="numeric"
              value={v.limits[r]}
              onChange={(e) =>
                setV({ ...v, limits: { ...v.limits, [r]: e.target.value.replace(/\D/g, '') } })
              }
            />
          ))}
        </div>
        <TextField
          label="Recursos (separados por vírgula)"
          value={v.features}
          onChange={(e) => setV({ ...v, features: e.target.value })}
        />
        <TextField
          label="Ordem na página de preços"
          inputMode="numeric"
          value={v.sort}
          onChange={(e) => setV({ ...v, sort: e.target.value })}
        />
        <Checkbox
          label="Público (aparece para os clientes)"
          checked={v.public}
          onChange={(x) => setV({ ...v, public: x })}
        />
        <Checkbox label="Ativo" checked={v.active} onChange={(x) => setV({ ...v, active: x })} />
        <Button type="submit">Salvar plano</Button>
      </form>
    </Drawer>
  );
}

// ================================================================= announcements

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  planIds: string[] | null;
  startsAt: string;
  endsAt: string | null;
}

export function AnnouncementsPage() {
  const { api, can } = useAdmin();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/admin/announcements'),
  });
  const plans = usePlans();
  const [v, setV] = useState({ title: '', body: '', level: 'info', planId: '' });
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  return (
    <>
      <PageHeader
        title="Avisos"
        description="Mensagens que aparecem no topo do sistema dos clientes (manutenção, novidades)."
      />
      {can('platform.announcements.manage') && (
        <Card className="mb-6">
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api.post('/admin/announcements', {
                  title: v.title,
                  body: v.body,
                  level: v.level,
                  planIds: v.planId ? [v.planId] : null,
                });
                setV({ title: '', body: '', level: 'info', planId: '' });
                await queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {error && (
              <div className="md:col-span-2">
                <Alert>{error}</Alert>
              </div>
            )}
            <TextField
              label="Título"
              value={v.title}
              onChange={(e) => setV({ ...v, title: e.target.value })}
            />
            <SelectField
              label="Tipo"
              value={v.level}
              onChange={(e) => setV({ ...v, level: e.target.value })}
              options={[
                { value: 'info', label: 'Informação' },
                { value: 'warning', label: 'Atenção' },
                { value: 'critical', label: 'Crítico' },
              ]}
            />
            <div className="md:col-span-2">
              <TextField
                label="Mensagem"
                value={v.body}
                onChange={(e) => setV({ ...v, body: e.target.value })}
              />
            </div>
            <SelectField
              label="Para quem"
              value={v.planId}
              onChange={(e) => setV({ ...v, planId: e.target.value })}
              options={[
                { value: '', label: 'Todos os clientes' },
                ...(plans.data ?? []).map((p) => ({ value: p.id, label: `Plano ${p.name}` })),
              ]}
            />
            <div className="flex items-end">
              <Button type="submit">Publicar aviso</Button>
            </div>
          </form>
        </Card>
      )}
      <ErrorBox error={list.error} />
      <div className="flex flex-col gap-3">
        {list.data?.map((a) => {
          const live =
            new Date(a.startsAt).getTime() <= now &&
            (!a.endsAt || new Date(a.endsAt).getTime() > now);
          return (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {a.title}{' '}
                    {live ? <Badge tone="success">No ar</Badge> : <Badge>Encerrado</Badge>}{' '}
                    <Badge
                      tone={
                        a.level === 'critical'
                          ? 'danger'
                          : a.level === 'warning'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {a.level === 'critical'
                        ? 'Crítico'
                        : a.level === 'warning'
                          ? 'Atenção'
                          : 'Informação'}
                    </Badge>
                  </p>
                  <p className="mt-1">{a.body}</p>
                  <p className="mt-1 text-sm text-muted">
                    {a.planIds ? `Planos: ${a.planIds.join(', ')}` : 'Todos os clientes'} · desde{' '}
                    {when(a.startsAt)}
                    {a.endsAt && ` até ${when(a.endsAt)}`}
                  </p>
                </div>
                {live && can('platform.announcements.manage') && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await api.post(`/admin/announcements/${a.id}/end`);
                      await queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
                    }}
                  >
                    Encerrar
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ================================================================= Bipaê team

interface Staff {
  userId: string;
  name: string;
  email: string;
  role: PlatformRole;
  active: boolean;
  totpEnabled: boolean;
  lastLogin: string | null;
}

export function TeamPage() {
  const { api, can, me } = useAdmin();
  const queryClient = useQueryClient();
  const team = useQuery({
    queryKey: ['admin', 'team'],
    queryFn: () => api.get<Staff[]>('/admin/admins'),
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PlatformRole>('support');
  const [error, setError] = useState<string | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin', 'team'] });
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const manage = can('platform.admins.manage');
  return (
    <>
      <PageHeader
        title="Equipe Bipaê"
        description="Quem acessa este painel. Todos usam verificação em duas etapas."
      />
      {error && <Alert>{error}</Alert>}
      {manage && (
        <Card className="mb-6">
          <form
            className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api.post('/admin/admins', { email, role });
                setEmail('');
              });
            }}
          >
            <TextField
              label="E-mail da pessoa (precisa ter conta no Bipaê)"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <SelectField
              label="Papel"
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformRole)}
              options={Object.entries(PLATFORM_ROLE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Button type="submit">Adicionar</Button>
          </form>
        </Card>
      )}
      {team.data && (
        <DataTable
          caption="Equipe Bipaê"
          rows={team.data.map((s) => ({ ...s, id: s.userId }))}
          columns={[
            {
              header: 'Pessoa',
              cell: (s) => (
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-sm text-muted">{s.email}</p>
                </div>
              ),
            },
            {
              header: 'Papel',
              cell: (s) =>
                manage && s.userId !== me.user.id ? (
                  <select
                    aria-label={`Papel de ${s.name}`}
                    className="rounded-ui border border-border bg-surface px-2 py-1"
                    value={s.role}
                    onChange={(e) =>
                      void act(() =>
                        api.patch(`/admin/admins/${s.userId}`, { role: e.target.value }),
                      )
                    }
                  >
                    {Object.entries(PLATFORM_ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  PLATFORM_ROLE_LABELS[s.role]
                ),
            },
            {
              header: '2 etapas',
              cell: (s) =>
                s.totpEnabled ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <ShieldCheck className="size-4" aria-hidden /> Ativa
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <ShieldAlert className="size-4" aria-hidden /> Pendente
                  </span>
                ),
            },
            { header: 'Último acesso', cell: (s) => when(s.lastLogin) },
            {
              header: 'Situação',
              cell: (s) =>
                s.active ? (
                  <Badge tone="success">Ativo</Badge>
                ) : (
                  <Badge tone="danger">Sem acesso</Badge>
                ),
            },
            {
              header: 'Ações',
              cell: (s) =>
                manage && s.userId !== me.user.id ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(() =>
                          api.patch(`/admin/admins/${s.userId}`, { active: !s.active }),
                        )
                      }
                    >
                      {s.active ? 'Remover acesso' : 'Devolver acesso'}
                    </Button>
                    {s.totpEnabled && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (
                            confirm(
                              `Zerar a verificação em duas etapas de ${s.name}? Use quando a pessoa perder o celular.`,
                            )
                          ) {
                            void act(() => api.post(`/admin/admins/${s.userId}/reset-totp`));
                          }
                        }}
                      >
                        Zerar 2 etapas
                      </Button>
                    )}
                  </div>
                ) : null,
            },
          ]}
        />
      )}
    </>
  );
}

// ================================================================= audit

interface PlatformAuditRow {
  id: string;
  seq: number;
  actorId: string | null;
  action: string;
  tenantId: string | null;
  target: string | null;
  data: unknown;
  ip: string | null;
  createdAt: string;
}

export function AuditPage() {
  const { api } = useAdmin();
  const list = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<{ items: PlatformAuditRow[]; total: number }>('/admin/audit?limit=200'),
  });
  const verify = useQuery({
    queryKey: ['admin', 'audit', 'verify'],
    queryFn: () =>
      api.get<{ valid: boolean; brokenAt: number | null; entries: number }>('/admin/audit/verify'),
  });
  return (
    <>
      <PageHeader
        title="Auditoria da plataforma"
        description="Tudo o que a equipe Bipaê fez. Registro permanente, que ninguém consegue alterar."
      />
      {verify.data &&
        (verify.data.valid ? (
          <Alert tone="success" title="Trilha íntegra">
            {verify.data.entries} registros conferidos.
          </Alert>
        ) : (
          <Alert title="Atenção: trilha alterada">
            O registro nº {verify.data.brokenAt} não confere.
          </Alert>
        ))}
      <ErrorBox error={list.error} />
      <div className="mt-4">
        {list.data && (
          <DataTable
            caption="Auditoria da plataforma"
            rows={list.data.items}
            columns={[
              { header: 'Nº', align: 'right', cell: (a) => a.seq },
              { header: 'Quando', cell: (a) => when(a.createdAt) },
              { header: 'Ação', cell: (a) => <code className="text-sm">{a.action}</code> },
              {
                header: 'Cliente',
                cell: (a) =>
                  a.tenantId ? (
                    <Link to={`/admin/clientes/${a.tenantId}`} className="text-primary underline">
                      abrir
                    </Link>
                  ) : (
                    '—'
                  ),
              },
              {
                header: 'Detalhes',
                cell: (a) => (
                  <code className="block max-w-md truncate text-sm text-muted">
                    {a.data ? JSON.stringify(a.data) : ''}
                  </code>
                ),
              },
              { header: 'IP', cell: (a) => a.ip ?? '—' },
            ]}
          />
        )}
      </div>
    </>
  );
}

// ================================================================= system

interface SystemInfo {
  api: { version: string; commit: string };
  node: string;
  uptimeSeconds: number;
  memoryMb: { rss: number; heapUsed: number };
  database: { kind: string; size: string; version: string };
  migrations: { name: string; applied_at: string }[];
  tables: { name: string; rows: number; size: string }[];
  config: {
    requireTotp: boolean;
    supportSessionMinutes: number;
    minimumClientVersions: Record<string, string>;
  };
}

export function SystemPage() {
  const { api } = useAdmin();
  const info = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => api.get<SystemInfo>('/admin/system'),
  });
  const s = info.data;
  return (
    <>
      <PageHeader
        title="Sistema"
        description="Versões, banco de dados e configuração da plataforma."
      />
      <ErrorBox error={info.error} />
      {s && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Aplicação">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">API</dt>
              <dd>
                {s.api.version} ({s.api.commit.slice(0, 7)})
              </dd>
              <dt className="text-muted">Node.js</dt>
              <dd>{s.node}</dd>
              <dt className="text-muted">No ar há</dt>
              <dd>
                {Math.floor(s.uptimeSeconds / 3600)} h {Math.floor((s.uptimeSeconds % 3600) / 60)}{' '}
                min
              </dd>
              <dt className="text-muted">Memória</dt>
              <dd>
                {s.memoryMb.rss} MB (heap {s.memoryMb.heapUsed} MB)
              </dd>
              <dt className="text-muted">2 etapas obrigatória</dt>
              <dd>{s.config.requireTotp ? 'sim' : 'não'}</dd>
              <dt className="text-muted">Acesso de suporte</dt>
              <dd>{s.config.supportSessionMinutes} min</dd>
            </dl>
          </Section>
          <Section title="Banco de dados">
            <p>
              {s.database.kind} · {s.database.size}
            </p>
            <p className="text-sm text-muted">{s.database.version.split(' on ')[0]}</p>
            <p className="mt-3 text-sm font-semibold">Migrações aplicadas</p>
            <ul className="text-sm">
              {s.migrations.map((m) => (
                <li key={m.name}>
                  {m.name} · {when(m.applied_at)}
                </li>
              ))}
            </ul>
          </Section>
          <div className="xl:col-span-2">
            <DataTable
              caption="Maiores tabelas"
              rows={s.tables.map((t) => ({ ...t, id: t.name }))}
              columns={[
                { header: 'Tabela', cell: (t) => <code>{t.name}</code> },
                { header: 'Linhas', align: 'right', cell: (t) => t.rows.toLocaleString('pt-BR') },
                { header: 'Tamanho', align: 'right', cell: (t) => t.size },
              ]}
            />
          </div>
        </div>
      )}
    </>
  );
}
