import { PERMISSIONS, type AuditEntry, type Page, type Terminal } from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MemberStoresForm, type StoreOption } from './member-stores';
import { useApp } from '../context';
import { useForm } from '../forms';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ---------------------------------------------------------------- Terminals

export function TerminalsPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const terminals = useQuery({
    queryKey: ['terminals'],
    queryFn: () => api.get<Terminal[]>('/terminals'),
  });
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });

  return (
    <>
      <PageHeader
        title="Caixas"
        description="Cada caixa (no navegador ou no app desktop) tem sua própria série de NFC-e, para nunca repetir número mesmo sem internet."
        actions={
          <Button icon={<Plus className="size-5" aria-hidden />} onClick={() => setCreating(true)}>
            Novo caixa
          </Button>
        }
      />
      {terminals.data && (
        <DataTable
          caption="Caixas cadastrados"
          rows={terminals.data}
          columns={[
            { header: 'Nome', cell: (t) => <span className="font-semibold">{t.name}</span> },
            {
              header: 'Tipo',
              cell: (t) => (t.platform === 'desktop' ? 'App desktop' : 'Navegador'),
            },
            { header: 'Série NFC-e', align: 'right', cell: (t) => t.nfceSeries },
            {
              header: 'Situação',
              cell: (t) =>
                t.status === 'active' ? (
                  <Badge tone="success">Ativo</Badge>
                ) : (
                  <Badge>Desativado</Badge>
                ),
            },
            {
              header: 'Ações',
              cell: (t) =>
                t.status === 'active' && (
                  <Button
                    variant="ghost"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        !confirm(
                          `Desativar "${t.name}"? A série ${t.nfceSeries} não será reutilizada.`,
                        )
                      )
                        return;
                      await api.post(`/terminals/${t.id}/revoke`);
                      await queryClient.invalidateQueries({ queryKey: ['terminals'] });
                    }}
                  >
                    Desativar
                  </Button>
                ),
            },
          ]}
        />
      )}
      {creating && stores.data && (
        <TerminalForm stores={stores.data} onClose={() => setCreating(false)} />
      )}
    </>
  );
}

function TerminalForm({
  stores,
  onClose,
}: {
  stores: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { api, platform } = useApp();
  const queryClient = useQueryClient();
  const form = useForm({
    name: '',
    storeId: stores[0]?.id ?? '',
    platform: platform.kind as string,
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      await api.post('/terminals', v);
      await queryClient.invalidateQueries({ queryKey: ['terminals'] });
      onClose();
    });
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Novo caixa">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome do caixa"
          placeholder="Ex.: Caixa 1"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />
        <SelectField
          label="Loja"
          value={form.values.storeId}
          onChange={(e) => form.set('storeId', e.target.value)}
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
        />
        <SelectField
          label="Onde vai rodar"
          value={form.values.platform}
          onChange={(e) => form.set('platform', e.target.value)}
          options={[
            { value: 'desktop', label: 'App desktop (com impressora, balança e gaveta)' },
            { value: 'web', label: 'Navegador (tablet, celular ou computador)' },
          ]}
        />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Criar caixa
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------- Team

interface Member {
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  active: boolean;
  /** Lojas que a pessoa usa (F1-05); null = todas. */
  storeIds: string[] | null;
}
interface Role {
  id: string;
  name: string;
  systemKey: string | null;
  permissions: string[];
}

export function TeamPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/members') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<StoreOption[]>('/stores'),
  });
  const [storesOf, setStoresOf] = useState<Member | null>(null);
  const storeNames = (ids: string[] | null) =>
    ids === null
      ? 'Todas'
      : ids.map((id) => stores.data?.find((s) => s.id === id)?.name ?? '—').join(', ') || 'Nenhuma';

  return (
    <>
      <PageHeader
        title="Equipe"
        description="Quem acessa o Bipaê e o que cada pessoa pode fazer."
        actions={
          <Button icon={<Plus className="size-5" aria-hidden />} onClick={() => setAdding(true)}>
            Adicionar pessoa
          </Button>
        }
      />
      {members.data && (
        <DataTable
          caption="Equipe"
          rows={members.data.map((m) => ({ ...m, id: m.userId }))}
          columns={[
            {
              header: 'Pessoa',
              cell: (m) => (
                <div>
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-sm text-muted">{m.email}</p>
                </div>
              ),
            },
            { header: 'Papel', cell: (m) => m.roleName },
            { header: 'Lojas', cell: (m) => storeNames(m.storeIds) },
            {
              header: 'Acesso',
              cell: (m) =>
                m.active ? (
                  <Badge tone="success">Ativo</Badge>
                ) : (
                  <Badge tone="danger">Bloqueado</Badge>
                ),
            },
            {
              header: 'Ações',
              cell: (m) => (
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setStoresOf(m)}
                    aria-label={`Lojas de ${m.name}`}
                  >
                    Lojas
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api.patch(`/members/${m.userId}`, { active: !m.active });
                        await queryClient.invalidateQueries({ queryKey: ['members'] });
                      } catch (error) {
                        alert((error as Error).message);
                      }
                    }}
                  >
                    {m.active ? 'Bloquear' : 'Liberar'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}

      {storesOf && (
        <MemberStoresForm
          member={storesOf}
          stores={stores.data ?? []}
          onClose={() => setStoresOf(null)}
        />
      )}

      <h2 className="mb-3 mt-8 text-lg font-bold">Papéis</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.id}>
            <p className="font-semibold">{role.name}</p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted">
              {role.permissions.map((p) => (
                <li key={p}>{PERMISSIONS[p as keyof typeof PERMISSIONS]?.label ?? p}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {adding && roles.data && <MemberForm roles={roles.data} onClose={() => setAdding(false)} />}
    </>
  );
}

function MemberForm({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const assignable = roles.filter((r) => r.systemKey !== 'owner');
  const form = useForm({
    name: '',
    email: '',
    password: '',
    roleId: assignable.find((r) => r.systemKey === 'cashier')?.id ?? assignable[0]?.id ?? '',
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (v) => {
      await api.post('/members', v);
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    });
  };
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Adicionar pessoa">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Nome"
          value={form.values.name}
          onChange={(e) => form.set('name', e.target.value)}
          error={form.errors.name}
          autoFocus
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.values.email}
          onChange={(e) => form.set('email', e.target.value)}
          error={form.errors.email}
        />
        <TextField
          label="Senha inicial"
          type="password"
          autoComplete="new-password"
          hint="Se a pessoa já tem conta no Bipaê (um contador, por exemplo), ela usa a senha dela."
          value={form.values.password}
          onChange={(e) => form.set('password', e.target.value)}
          error={form.errors.password}
        />
        <SelectField
          label="Papel"
          value={form.values.roleId}
          onChange={(e) => form.set('roleId', e.target.value)}
          options={assignable.map((r) => ({ value: r.id, label: r.name }))}
        />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={form.submitting}>
            Adicionar
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------- Audit

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'Conta criada',
  'product.created': 'Produto cadastrado',
  'product.updated': 'Produto alterado',
  'product.price_changed': 'Preço alterado',
  'customer.created': 'Cliente cadastrado',
  'customer.updated': 'Cliente alterado',
  'customer.marketing_consent_changed': 'Consentimento de marketing alterado',
  'supplier.created': 'Fornecedor cadastrado',
  'supplier.updated': 'Fornecedor alterado',
  'terminal.created': 'Caixa criado',
  'terminal.revoked': 'Caixa desativado',
  'member.added': 'Pessoa adicionada à equipe',
  'member.updated': 'Acesso de pessoa alterado',
  'role.created': 'Papel criado',
  'role.updated': 'Permissões alteradas',
  'fiscal_profile.created': 'Perfil fiscal criado',
  'fiscal_profile.updated': 'Perfil fiscal alterado',
  'price_table.created': 'Tabela de preço criada',
  'price_table.updated': 'Tabela de preço alterada',
  'company.created': 'Empresa criada',
  'company.updated': 'Dados da empresa alterados',
  'store.created': 'Loja criada',
  'auth.refresh_reuse_detected': 'Sessão suspeita encerrada',
};

export function AuditPage() {
  const { api } = useApp();
  const entries = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.get<Page<AuditEntry>>('/audit?limit=200'),
  });
  const verify = useQuery({
    queryKey: ['audit', 'verify'],
    queryFn: () =>
      api.get<{ valid: boolean; brokenAt: number | null; entries: number }>('/audit/verify'),
  });

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro permanente de ações importantes. Ninguém consegue apagar ou alterar."
      />
      {verify.data &&
        (verify.data.valid ? (
          <Alert tone="success" title="Trilha íntegra">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-5" aria-hidden /> {verify.data.entries} registros
              conferidos.
            </span>
          </Alert>
        ) : (
          <Alert title="Atenção: trilha alterada">
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="size-5" aria-hidden /> O registro nº {verify.data.brokenAt}{' '}
              não confere. Fale com o suporte.
            </span>
          </Alert>
        ))}
      <div className="mt-4">
        {entries.data && (
          <DataTable
            caption="Registros de auditoria"
            rows={entries.data.items}
            columns={[
              { header: 'Nº', align: 'right', cell: (e) => e.seq },
              { header: 'Quando', cell: (e) => dateTime.format(new Date(e.createdAt)) },
              { header: 'O quê', cell: (e) => ACTION_LABELS[e.action] ?? e.action },
              {
                header: 'Detalhes',
                cell: (e) => (
                  <code className="block max-w-md truncate text-sm text-muted">
                    {e.data ? JSON.stringify(e.data) : ''}
                  </code>
                ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
