import { formatBRL, type Cents, type ServiceView } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  MoneyField,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useApp, useCan } from '../context';

const money = (cents: number) => formatBRL(cents as Cents);
const dotted = (code: string) => `${code.slice(0, 2)}.${code.slice(2, 4)}.${code.slice(4)}`;

interface NationalService {
  code: string;
  description: string;
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
  return (
    <>
      <PageHeader
        title="Serviços"
        description="O que a sua empresa faz: cada serviço com o código da lista nacional, que vai na NFS-e, e a alíquota do ISS do município."
        actions={
          canWrite && (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen('new')}>
              Novo serviço
            </Button>
          )
        }
      />
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      {list.data && rows.length === 0 ? (
        <EmptyState title="Nenhum serviço cadastrado">
          Cadastre os serviços que você faz (troca de óleo, conserto, instalação...) para usar nas
          ordens de serviço.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Serviços"
            rows={rows}
            onRowClick={(r) => canWrite && setOpen(r)}
            columns={[
              { header: 'Serviço', cell: (r) => r.name },
              { header: 'Código nacional', cell: (r) => dotted(r.code) },
              { header: 'ISS', cell: (r) => (r.issRate ? `${r.issRate.replace('.', ',')}%` : '—') },
              { header: 'Preço', align: 'right', cell: (r) => money(r.priceCents) },
              {
                header: 'Situação',
                cell: (r) =>
                  r.active ? (
                    <Badge tone="success">Ativo</Badge>
                  ) : (
                    <Badge tone="neutral">Inativo</Badge>
                  ),
              },
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
        <TextField label="Nome do serviço" value={name} onChange={(e) => setName(e.target.value)} />
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
          hint="De 0 a 5%. Peça ao município ou ao contador; no Simples ela só vai na nota quando há retenção."
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <MoneyField label="Preço" value={price} onChange={(c) => setPrice(c ?? 0)} />
        <Checkbox label="Serviço ativo" checked={active} onChange={setActive} />
        <Button disabled={!name.trim() || !code} onClick={() => void save()}>
          Salvar serviço
        </Button>
      </div>
    </Drawer>
  );
}
