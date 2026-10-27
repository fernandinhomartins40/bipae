import {
  formatBRL,
  describeLimit,
  LIMIT_LABELS,
  LIMIT_RESOURCES,
  TENANT_STATUS_LABELS,
  type AccountView,
  type Cents,
} from '@bipae/domain';
import { Alert, Badge, Button, Card, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { UsageBar } from '../admin/charts';
import { useState } from 'react';
import { useApp, useCan } from '../context';
import { BillingSection } from './billing';

const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const EVENT_LABELS: Record<string, string> = {
  created: 'Conta criada',
  plan_changed: 'Plano alterado',
  trial_set: 'Período de teste',
  suspended: 'Conta suspensa',
  reactivated: 'Conta reativada',
  cancelled: 'Conta cancelada',
  limits_changed: 'Limites ajustados',
  support_session: 'Acesso do suporte Bipaê',
  billing_paid: 'Pagamento do plano confirmado',
  billing_blocked: 'Acesso pausado por falta de pagamento',
  plan_change_scheduled: 'Troca de plano agendada',
};

/** "Minha assinatura": plan, usage against limits and the account history. */
export function AccountPage() {
  const { api } = useApp();
  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => api.get<AccountView>('/account'),
  });
  const a = account.data;
  return (
    <>
      <PageHeader
        title="Minha assinatura"
        description="Seu plano, o quanto você usa dele e o histórico da conta."
      />
      {account.error && <Alert>{(account.error as Error).message}</Alert>}
      {a && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Plano {a.plan.name}</h2>
              <Badge
                tone={
                  a.tenant.status === 'active'
                    ? 'success'
                    : a.tenant.status === 'trial'
                      ? 'warning'
                      : 'danger'
                }
              >
                {TENANT_STATUS_LABELS[a.tenant.status]}
              </Badge>
            </div>
            {a.plan.description && <p className="mt-1 text-muted">{a.plan.description}</p>}
            <p className="mt-2 text-lg font-semibold">
              {a.plan.priceCents === null
                ? 'Preço no lançamento'
                : a.plan.priceCents === 0
                  ? 'Grátis'
                  : `${formatBRL(a.plan.priceCents as Cents)} por mês`}
            </p>
            {a.tenant.trialEndsAt && (
              <p className="mt-2">
                Período de teste até{' '}
                <strong>{dateOnly.format(new Date(a.tenant.trialEndsAt))}</strong>.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-3">
              {LIMIT_RESOURCES.map((r) => (
                <UsageBar
                  key={r}
                  label={LIMIT_LABELS[r].many[0]!.toUpperCase() + LIMIT_LABELS[r].many.slice(1)}
                  used={a.usage[r]}
                  limit={a.limits[r]}
                />
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-bold">Planos disponíveis</h2>
            <ul className="divide-y divide-border">
              {a.plans.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">
                      {p.name} {p.id === a.plan.id && <Badge tone="success">Seu plano</Badge>}
                    </span>
                    <span className="tabular-nums">
                      {p.priceCents === null
                        ? 'no lançamento'
                        : p.priceCents === 0
                          ? 'Grátis'
                          : formatBRL(p.priceCents as Cents)}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {LIMIT_RESOURCES.map((r) => describeLimit(r, p.limits[r])).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <BillingSection plans={a.plans} currentPlanId={a.plan.id} />

          <DataCard purgeAt={a.tenant.purgeAt} />

          <Card className="xl:col-span-2">
            <h2 className="mb-3 text-lg font-bold">Histórico da conta</h2>
            <ul className="flex flex-col gap-2">
              {a.events.map((e, i) => (
                <li key={i} className="border-l-4 border-border pl-3">
                  <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span>{' '}
                  <span className="text-sm text-muted">
                    {dateOnly.format(new Date(e.createdAt))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

/** LGPD (P-03): baixar todos os dados da conta e saber quando a conta cancelada será excluída. */
function DataCard({ purgeAt }: { purgeAt: string | null }) {
  const { api } = useApp();
  const canExport = useCan('admin.users');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await api.download('/account/export');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bipae-dados-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="xl:col-span-2">
      <h2 className="mb-1 text-lg font-bold">Seus dados</h2>
      <p className="text-sm text-muted">
        Baixe um arquivo ZIP com tudo o que a sua empresa guardou no Bipaê: produtos, clientes,
        vendas, estoque e configurações. Senhas e certificados não vão no arquivo.
      </p>
      {purgeAt && (
        <Alert tone="warning" title="Conta cancelada">
          Os dados desta conta serão excluídos de vez em {dateOnly.format(new Date(purgeAt))}. Baixe
          antes o que precisar guardar (as notas fiscais devem ser guardadas por 5 anos).
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {canExport ? (
        <Button className="mt-3" loading={busy} onClick={() => void download()}>
          Baixar meus dados (ZIP)
        </Button>
      ) : (
        <p className="mt-3 text-sm text-muted">Só o dono da conta pode baixar os dados.</p>
      )}
    </Card>
  );
}
