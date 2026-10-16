import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  type WebhookCreated,
  type WebhookDeliveryView,
  type WebhookEvent,
  type WebhookView,
} from '@bipae/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const DELIVERY_STATUS = {
  pending: { label: 'Tentando de novo', tone: 'warning' },
  sent: { label: 'Entregue', tone: 'success' },
  failed: { label: 'Desistiu', tone: 'danger' },
} as const;

const eventLabel = (e: string) => WEBHOOK_EVENT_LABELS[e as WebhookEvent] ?? 'Aviso de teste';

/**
 * Webhooks (F6-01.c, ADR-0016): o Bipaê avisa outro sistema quando algo acontece (venda,
 * devolução, produto). Cada aviso vai assinado com o segredo, e o que falha é tentado de novo.
 */
export function WebhooksSection() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const hooks = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get<WebhookView[]>('/webhooks'),
  });
  const [editing, setEditing] = useState<WebhookView | 'new' | null>(null);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [viewing, setViewing] = useState<WebhookView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = hooks.data ?? [];
  return (
    <section className="mt-8" aria-labelledby="webhooks">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="webhooks" className="text-lg font-bold">
          Webhooks (avisos para outro sistema)
        </h2>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          Novo webhook
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted">
        O Bipaê manda um aviso (POST em JSON) para o endereço quando algo acontece. Cada aviso vai
        assinado no cabeçalho X-Bipae-Signature com o segredo. Se o endereço não responder, o Bipaê
        tenta de novo por até 15 horas.
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {secret && (
        <Alert tone="success" title="Segredo do webhook: copie agora">
          <p>
            Use este segredo no sistema de {secret.url} para conferir a assinatura dos avisos. Ele
            só aparece agora.
          </p>
          <code
            className="mt-2 block break-all rounded-ui bg-surface-2 p-2 text-sm"
            aria-label="Segredo do webhook"
          >
            {secret.secret}
          </code>
          <Button variant="ghost" onClick={() => setSecret(null)}>
            Já guardei o segredo
          </Button>
        </Alert>
      )}
      {hooks.data && rows.length === 0 ? (
        <EmptyState title="Nenhum webhook ainda">
          Cadastre o endereço do outro sistema para ele saber na hora de cada venda ou mudança de
          produto.
        </EmptyState>
      ) : (
        rows.length > 0 && (
          <DataTable
            caption="Webhooks"
            rows={rows}
            columns={[
              { header: 'Endereço', cell: (h) => <code className="break-all">{h.url}</code> },
              { header: 'Avisos', cell: (h) => h.events.map(eventLabel).join('; ') },
              {
                header: 'Situação',
                cell: (h) =>
                  !h.active ? (
                    <Badge tone="neutral">Desativado</Badge>
                  ) : h.failed > 0 ? (
                    <Badge tone="danger">{`${h.failed} aviso(s) não entregue(s)`}</Badge>
                  ) : h.pending > 0 ? (
                    <Badge tone="warning">{`${h.pending} tentando de novo`}</Badge>
                  ) : (
                    <Badge tone="success">Em dia</Badge>
                  ),
              },
              { header: 'Último aviso entregue', cell: (h) => when(h.lastDeliveryAt) },
              {
                header: 'Ações',
                cell: (h) => (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(
                          () => api.post(`/webhooks/${h.id}/ping`, {}),
                          'Aviso de teste enviado. Veja o resultado em "Entregas".',
                        )
                      }
                    >
                      Enviar teste
                    </Button>
                    <Button variant="ghost" onClick={() => setViewing(h)}>
                      Entregas
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(h)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void act(async () => {
                          const r = await api.post<WebhookCreated>(`/webhooks/${h.id}/secret`, {});
                          setSecret({ url: r.url, secret: r.secret });
                        })
                      }
                    >
                      Gerar outro segredo
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )
      )}
      {editing && (
        <WebhookDrawer
          hook={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) setSecret({ url: created.url, secret: created.secret });
          }}
        />
      )}
      {viewing && <DeliveriesDrawer hook={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

function WebhookDrawer({
  hook,
  onClose,
  onSaved,
}: {
  hook: WebhookView | null;
  onClose: () => void;
  onSaved: (created: WebhookCreated | null) => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState(hook?.url ?? 'https://');
  const [events, setEvents] = useState<WebhookEvent[]>(
    (hook?.events as WebhookEvent[] | undefined) ?? ['sale.completed'],
  );
  const [active, setActive] = useState(hook?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = { url: url.trim(), events, active };
      if (hook) {
        await api.put(`/webhooks/${hook.id}`, body);
        await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
        onSaved(null);
      } else {
        const created = await api.post<WebhookCreated>('/webhooks', body);
        await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
        onSaved(created);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={hook ? 'Editar webhook' : 'Novo webhook'}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Endereço que recebe os avisos"
          placeholder="https://minhaloja.com.br/bipae/avisos"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">Quando avisar</legend>
          {WEBHOOK_EVENTS.map((e) => (
            <Checkbox
              key={e}
              label={WEBHOOK_EVENT_LABELS[e]}
              checked={events.includes(e)}
              onChange={(on) =>
                setEvents((list) => (on ? [...list, e] : list.filter((x) => x !== e)))
              }
            />
          ))}
        </fieldset>
        {hook && <Checkbox label="Ativo" checked={active} onChange={setActive} />}
        <Button loading={busy} disabled={events.length === 0} onClick={() => void save()}>
          {hook ? 'Salvar' : 'Criar webhook'}
        </Button>
      </div>
    </Drawer>
  );
}

function DeliveriesDrawer({ hook, onClose }: { hook: WebhookView; onClose: () => void }) {
  const { api } = useApp();
  const list = useQuery({
    queryKey: ['webhooks', hook.id, 'deliveries'],
    queryFn: () => api.get<WebhookDeliveryView[]>(`/webhooks/${hook.id}/deliveries`),
    refetchInterval: 5000,
  });
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Entregas do webhook">
      <div className="flex flex-col gap-3">
        <p className="break-all text-sm text-muted">{hook.url}</p>
        {list.data && list.data.length === 0 && <p className="text-muted">Nenhum aviso ainda.</p>}
        <ul className="flex flex-col gap-2" aria-label="Entregas">
          {(list.data ?? []).map((d) => (
            <li key={d.id} className="rounded-ui border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{eventLabel(d.event)}</span>
                <Badge tone={DELIVERY_STATUS[d.status].tone}>
                  {DELIVERY_STATUS[d.status].label}
                </Badge>
              </div>
              <p className="text-muted">
                {when(d.createdAt)} · {d.attempts} tentativa(s)
                {d.lastStatus !== null && ` · resposta ${d.lastStatus}`}
              </p>
              {d.lastError && <p className="text-muted">{d.lastError}</p>}
              {d.nextAttemptAt && (
                <p className="text-muted">Próxima tentativa: {when(d.nextAttemptAt)}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
