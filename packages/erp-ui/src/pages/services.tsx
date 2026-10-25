import { formatBRL, type Cents, type ServiceView } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  FormSection,
  MoneyField,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';

const money = (cents: number) => formatBRL(cents as Cents);
const dotted = (code: string) => `${code.slice(0, 2)}.${code.slice(2, 4)}.${code.slice(4)}`;

interface NationalService {
  code: string;
  description: string;
}

interface IssRateAnswer {
  city: string | null;
  rate: string | null;
  message: string | null;
}

/**
 * Busca a alíquota do ISS que a prefeitura cadastrou no Sistema Nacional NFS-e para o serviço,
 * com o certificado da empresa: o dono não precisa saber o número.
 */
function IssRateLookup({ code, onFound }: { code: string; onFound: (rate: string) => void }) {
  const { api } = useApp();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const lookup = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.get<IssRateAnswer>(`/fiscal/nfse/iss-rate?code=${code}`);
      if (r.rate) {
        onFound(r.rate);
        setNote({
          ok: true,
          text: `${r.city ?? 'A prefeitura'} cadastrou ${r.rate.replace('.', ',')}% para este serviço no Sistema Nacional NFS-e.`,
        });
      } else {
        setNote({ ok: false, text: r.message ?? 'A prefeitura não informou a alíquota.' });
      }
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" disabled={busy} onClick={() => void lookup()}>
        {busy ? 'Buscando...' : 'Buscar a alíquota na prefeitura'}
      </Button>
      {note && <Alert tone={note.ok ? 'success' : 'warning'}>{note.text}</Alert>}
    </div>
  );
}

/**
 * Serviços que a empresa presta (F5-13.c): cada um com o código da lista nacional de serviços
 * (vai na NFS-e), a alíquota do ISSQN do município e o preço.
 */
export function ServicesPage() {
  const { api } = useApp();
  const canWrite = useCan('catalog.write');
  const list = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceView[]>('/services'),
  });
  const [open, setOpen] = useState<ServiceView | 'new' | null>(null);
  const rows = list.data ?? [];
  const newButton = (label: string) => (
    <Button size="lg" icon={<Plus className="size-5" aria-hidden />} onClick={() => setOpen('new')}>
      {label}
    </Button>
  );
  const issText = (r: ServiceView) => (r.issRate ? `${r.issRate.replace('.', ',')}%` : '—');
  return (
    <>
      <PageHeader
        title="Serviços"
        description="O que a sua empresa faz: cada serviço com o código da lista nacional, que vai na NFS-e, e a alíquota do ISS do município."
        icon={<ClipboardList />}
        tone="blue"
        actions={canWrite && newButton('Novo serviço')}
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState
          title="Nenhum serviço cadastrado"
          icon={<ClipboardList />}
          tone="blue"
          action={canWrite && newButton('Cadastrar o primeiro serviço')}
        >
          Cadastre os serviços que você faz (troca de óleo, conserto, instalação...) para usar nas
          ordens de serviço.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Serviços"
            rows={rows}
            onRowClick={canWrite ? (r) => setOpen(r) : undefined}
            card={(r) => (
              <>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-bold">{r.name}</span>
                  <span className="text-sm text-muted">
                    Código {dotted(r.code)} · ISS {issText(r)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-lg font-extrabold tabular-nums">{money(r.priceCents)}</span>
                  <ServiceStatus active={r.active} />
                </span>
              </>
            )}
            columns={[
              { header: 'Serviço', cell: (r) => <span className="font-bold">{r.name}</span> },
              { header: 'Código nacional', cell: (r) => dotted(r.code) },
              { header: 'ISS', cell: issText },
              {
                header: 'Preço',
                align: 'right',
                cell: (r) => <span className="font-extrabold">{money(r.priceCents)}</span>,
              },
              { header: 'Situação', cell: (r) => <ServiceStatus active={r.active} /> },
            ]}
          />
        )
      )}
      {open && (
        <ServiceDrawer service={open === 'new' ? null : open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function ServiceStatus({ active }: { active: boolean }) {
  return active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>;
}

function ServiceDrawer({ service, onClose }: { service: ServiceView | null; onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState(service?.name ?? '');
  const [code, setCode] = useState<NationalService | null>(
    service ? { code: service.code, description: service.codeDescription ?? '' } : null,
  );
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const found = useQuery({
    queryKey: ['nfse-services', q],
    queryFn: () => api.get<NationalService[]>(`/fiscal/nfse-services?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const [nbs, setNbs] = useState(service?.nbs ?? '');
  const [rate, setRate] = useState(service?.issRate?.replace('.', ',') ?? '');
  const [price, setPrice] = useState<number>(service?.priceCents ?? 0);
  const [active, setActive] = useState(service?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const body = { name, code: code?.code ?? '', nbs, issRate: rate, priceCents: price, active };
      if (service) await api.put(`/services/${service.id}`, body);
      else await api.post('/services', body);
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={service ? 'Editar serviço' : 'Novo serviço'}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <FormSection title="O básico">
          <TextField
            label="Nome do serviço"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <MoneyField label="Preço" value={price} onChange={(c) => setPrice(c ?? 0)} />
        </FormSection>
        <FormSection title="Na nota de serviço (NFS-e)">
          {code ? (
            <div className="flex items-start justify-between gap-3 rounded-ui border border-border p-3">
              <span className="text-sm">
                <span className="font-semibold">Código nacional {dotted(code.code)}</span>
                <span className="block text-muted">{code.description}</span>
              </span>
              <Button variant="ghost" onClick={() => setCode(null)}>
                Trocar
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <TextField
                label="Código na lista nacional de serviços"
                placeholder="Ex.: 14.01 ou conserto de veículos"
                hint="A lista oficial da NFS-e Nacional (LC 116/2003)."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {q.length >= 2 && found.data && (
                <ul
                  className="rounded-ui border border-border"
                  aria-label="Serviços da lista nacional"
                >
                  {found.data.length === 0 && (
                    <li className="p-3 text-muted">Nenhum serviço encontrado.</li>
                  )}
                  {found.data.map((s) => (
                    <li key={s.code}>
                      <button
                        type="button"
                        className="w-full p-3 text-left hover:bg-surface-2"
                        onClick={() => {
                          setCode(s);
                          setSearch('');
                        }}
                      >
                        {dotted(s.code)} · {s.description}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <TextField
            label="NBS (opcional)"
            hint="Nomenclatura Brasileira de Serviços, 9 dígitos."
            value={nbs}
            onChange={(e) => setNbs(e.target.value)}
          />
          <TextField
            label="Alíquota do ISS no município (%)"
            hint="De 0 a 5%. No Simples ela só vai na nota quando há retenção."
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          {code && (
            <IssRateLookup code={code.code} onFound={(found) => setRate(found.replace('.', ','))} />
          )}
        </FormSection>
        <Checkbox label="Serviço ativo" checked={active} onChange={setActive} />
        <Button disabled={!name.trim() || !code} onClick={() => void save()}>
          Salvar serviço
        </Button>
      </div>
    </Drawer>
  );
}
