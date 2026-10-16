import {
  PUBLIC_API_SCOPE_LABELS,
  PUBLIC_API_SCOPES,
  type ApiKeyCreated,
  type ApiKeyView,
  type PublicApiScope,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context';
import { WebhooksSection } from './webhooks';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

/**
 * Integrações (F6-01.a, ADR-0016): chaves da API pública para a loja virtual, o BI ou outro
 * sistema ler os dados sem usar o login de uma pessoa. A chave aparece uma vez.
 */
export function IntegrationsPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<ApiKeyView[]>('/api-keys'),
  });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (k: ApiKeyView) => {
    setError(null);
    try {
      await api.post(`/api-keys/${k.id}/revoke`, {});
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = keys.data ?? [];
  return (
    <>
      <PageHeader
        title="Integrações (API)"
        description="Chaves para outros sistemas (loja virtual, BI, planilhas) lerem os dados do Bipaê. Cada chave tem só as permissões que você escolher e pode ser revogada a qualquer momento."
        actions={
          <Button
            icon={<KeyRound className="size-4" aria-hidden />}
            onClick={() => setCreating(true)}
          >
            Nova chave
          </Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {created && (
        <Alert tone="success" title="Chave criada: copie agora">
          <p>
            Esta é a única vez que a chave aparece. Guarde-a no sistema que vai usar a API; se
            perder, revogue e crie outra.
          </p>
          <code
            className="mt-2 block break-all rounded-ui bg-surface-2 p-2 text-sm"
            aria-label="Chave de API criada"
          >
            {created.key}
          </code>
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(created.key)}
            >
              Copiar chave
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              Já guardei
            </Button>
          </div>
        </Alert>
      )}
      {keys.error && <Alert>{(keys.error as Error).message}</Alert>}
      {keys.data && rows.length === 0 ? (
        <EmptyState title="Nenhuma chave ainda">
          Crie uma chave quando algum sistema precisar ler seus produtos, estoque ou clientes. A
          documentação da API está em /v1/public/openapi.json.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Chaves de API"
            rows={rows}
            columns={[
              { header: 'Nome', cell: (k) => k.name },
              { header: 'Chave', cell: (k) => <code>{k.prefix}</code> },
              {
                header: 'Permissões',
                cell: (k) =>
                  k.scopes.map((s) => PUBLIC_API_SCOPE_LABELS[s as PublicApiScope] ?? s).join('; '),
              },
              { header: 'Criada por', cell: (k) => `${k.createdByName} em ${when(k.createdAt)}` },
              { header: 'Último uso', cell: (k) => when(k.lastUsedAt) },
              {
                header: 'Situação',
                cell: (k) =>
                  k.revokedAt ? (
                    <Badge tone="neutral">Revogada</Badge>
                  ) : (
                    <Button variant="ghost" onClick={() => void revoke(k)}>
                      Revogar {k.name}
                    </Button>
                  ),
              },
            ]}
          />
        )
      )}
      {creating && (
        <NewKey
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
          }}
        />
      )}
      <WebhooksSection />
    </>
  );
}

function NewKey({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (k: ApiKeyCreated) => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<PublicApiScope[]>(['catalog.read']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const k = await api.post<ApiKeyCreated>('/api-keys', { name, scopes });
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      onCreated(k);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Nova chave de API">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome da chave"
          placeholder="Ex.: Loja virtual"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">O que a chave pode fazer</legend>
          {PUBLIC_API_SCOPES.map((s) => (
            <Checkbox
              key={s}
              label={PUBLIC_API_SCOPE_LABELS[s]}
              checked={scopes.includes(s)}
              onChange={(on) =>
                setScopes((list) => (on ? [...list, s] : list.filter((x) => x !== s)))
              }
            />
          ))}
        </fieldset>
        <p className="text-sm text-muted">
          A chave só lê dados, e nunca tem mais permissão do que você. Se o seu acesso for removido,
          ela para de funcionar.
        </p>
        <Button
          loading={busy}
          disabled={name.trim().length < 2 || scopes.length === 0}
          onClick={() => void save()}
        >
          Criar chave
        </Button>
      </div>
    </Drawer>
  );
}
