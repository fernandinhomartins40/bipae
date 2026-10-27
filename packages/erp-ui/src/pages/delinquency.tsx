import { cents, formatBRL, formatTaxId, type DelinquentCustomer } from '@bipae/domain';
import {
  Alert,
  Badge,
  buttonClass,
  DataTable,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
} from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { Ban, HandCoins, PartyPopper, TriangleAlert, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function CreditStatus({ blocked }: { blocked: boolean }) {
  return blocked ? (
    <Badge tone="danger">Bloqueado no caixa</Badge>
  ) : (
    <Badge tone="warning">Em tolerância</Badge>
  );
}

/** Inadimplência do crediário (F4-09): quem está com parcela vencida e há quanto tempo. */
export function DelinquencyPage() {
  const { api } = useApp();
  // O recebimento é na ficha do cliente: o atalho só aparece para quem pode receber.
  const canCredit = useCan('parties.credit');
  const canEdit = useCan('parties.write');
  const canReceive = canCredit && canEdit;
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ['finance', 'delinquency'],
    queryFn: () => api.get<DelinquentCustomer[]>('/finance/entries/delinquency'),
  });
  const rows = (list.data ?? []).map((r) => ({ ...r, id: r.taxId }));
  const total = rows.reduce((sum, r) => sum + r.overdueCents, 0);
  const blocked = rows.filter((r) => r.blocked).length;
  return (
    <>
      <PageHeader
        title="Inadimplência do crediário"
        description="Clientes com parcela vencida. Toque no cliente para abrir a ficha e receber."
        icon={<TriangleAlert />}
        tone="red"
        actions={
          canReceive &&
          (list.data?.length ?? 0) > 0 && (
            <Link to="/clientes" className={buttonClass('secondary', 'lg')}>
              <HandCoins className="size-5" aria-hidden />
              Receber na ficha do cliente
            </Link>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Ninguém em atraso" icon={<PartyPopper />} tone="green">
          Todas as parcelas do crediário estão em dia.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <>
            <StatGrid label="Resumo da inadimplência" columns={3}>
              <StatCard
                label="Em atraso"
                tone="red"
                icon={<TriangleAlert />}
                value={brl(total)}
                valueTestId="delinquency-total"
              />
              <StatCard
                label="Clientes em atraso"
                tone="orange"
                icon={<Users />}
                value={String(rows.length)}
              />
              <StatCard
                label="Bloqueados no caixa"
                tone={blocked > 0 ? 'red' : 'green'}
                icon={<Ban />}
                value={String(blocked)}
                hint="Sem crediário até pagar."
              />
            </StatGrid>
            <DataTable
              caption="Clientes com parcela vencida"
              rows={rows}
              // Um clique abre a ficha deste cliente, já pronta para receber (PIE OP-05): antes era
              // preciso ir a Clientes e procurar o nome de novo.
              onRowClick={
                canReceive
                  ? (r) =>
                      // "Cliente sem cadastro" não tem ficha para abrir.
                      r.customerId && navigate(`/clientes?abrir=${encodeURIComponent(r.taxId)}`)
                  : undefined
              }
              card={(r) => (
                <>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-bold">{r.name}</span>
                    <span className="text-sm text-muted">
                      {formatTaxId(r.taxId)}
                      {r.phone && ` · ${r.phone}`}
                    </span>
                    <span className="text-sm text-muted">
                      {r.installments} {r.installments === 1 ? 'parcela' : 'parcelas'} · venceu em{' '}
                      {day(r.oldestDue)} ({r.daysLate} dias)
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-lg font-extrabold tabular-nums">
                      {brl(r.overdueCents)}
                    </span>
                    <CreditStatus blocked={r.blocked} />
                  </span>
                </>
              )}
              columns={[
                {
                  header: 'Cliente',
                  cell: (r) => (
                    <span>
                      <span className="font-bold">{r.name}</span>
                      <span className="block text-sm text-muted">
                        {formatTaxId(r.taxId)}
                        {r.phone && ` · ${r.phone}`}
                      </span>
                    </span>
                  ),
                },
                {
                  header: 'Em atraso',
                  align: 'right',
                  cell: (r) => <span className="font-extrabold">{brl(r.overdueCents)}</span>,
                },
                { header: 'Parcelas', align: 'right', cell: (r) => r.installments },
                { header: 'Venceu em', cell: (r) => `${day(r.oldestDue)} (${r.daysLate} dias)` },
                { header: 'Crediário', cell: (r) => <CreditStatus blocked={r.blocked} /> },
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
