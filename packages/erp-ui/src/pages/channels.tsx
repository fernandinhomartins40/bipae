import {
  cents,
  CHANNEL_ACTION_LABELS,
  CHANNEL_ORDER_STATUS_LABELS,
  CHANNEL_PROVIDER_INFO,
  CHANNEL_PROVIDERS,
  formatBRL,
  type ChannelAction,
  type ChannelCatalogSyncResult,
  type ChannelIntegrationCreated,
  type ChannelIntegrationView,
  type ChannelLinkView,
  type ChannelOrderStatus,
  type ChannelOrderView,
  type ChannelProvider,
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
  SelectField,
  TextField,
} from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp, useCan } from '../context';

const brl = (value: number) => formatBRL(cents(value));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const STATUS_TONE: Record<ChannelOrderStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  received: 'warning',
  needs_mapping: 'danger',
  accepted: 'neutral',
  preparing: 'neutral',
  ready: 'success',
  dispatched: 'success',
  concluded: 'success',
  cancelled: 'danger',
  rejected: 'danger',
};

/**
 * Pedidos de canais (F6-05 iFood, F6-06 marketplaces): liga a integração, mostra os pedidos que
 * chegaram e deixa aceitar, preparar e recusar. O pedido aceito vai para a fila do caixa da loja.
 * O que depende de credencial do canal aparece como "Falta configurar", nunca como se funcionasse.
 */
export function ChannelsPage() {
  const { api } = useApp();
  const canConfigure = useCan('admin.integrations');
  const queryClient = useQueryClient();
  const integrations = useQuery({
    queryKey: ['channels', 'integrations'],
    queryFn: () => api.get<ChannelIntegrationView[]>('/channels/integrations'),
    refetchInterval: 15_000,
  });
  const orders = useQuery({
    queryKey: ['channels', 'orders'],
    queryFn: () => api.get<ChannelOrderView[]>('/channels/orders'),
    refetchInterval: 8000,
  });
  const [editing, setEditing] = useState<boolean>(false);
  const [linking, setLinking] = useState<ChannelIntegrationView | null>(null);
  const [created, setCreated] = useState<ChannelIntegrationCreated | null>(null);
  const [rejecting, setRejecting] = useState<ChannelOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['channels'] });
  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rows = orders.data ?? [];
  const list = integrations.data ?? [];
  return (
    <>
      <PageHeader
        title="Pedidos de canais"
        description="Pedidos do iFood e de marketplaces. Aceitou, o pedido entra na fila do caixa da loja e a venda e a baixa do estoque acontecem lá, como qualquer venda."
        actions={
          canConfigure && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Nova integração
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {created?.inboundSecret && (
        <Alert tone="success" title="Segredo do conector: copie agora">
          <p>
            O conector de {created.name} assina cada pedido (cabeçalho X-Bipae-Signature, no mesmo
            formato dos webhooks) e manda um POST em JSON para o endereço abaixo. O segredo só
            aparece agora.
          </p>
          <code className="mt-2 block break-all rounded-ui bg-surface-2 p-2 text-sm">
            {created.inboundPath}
          </code>
          <code
            className="mt-2 block break-all rounded-ui bg-surface-2 p-2 text-sm"
            aria-label="Segredo do conector"
          >
            {created.inboundSecret}
          </code>
          <Button variant="ghost" onClick={() => setCreated(null)}>
            Já guardei o segredo
          </Button>
        </Alert>
      )}

      <section aria-labelledby="integracoes" className="mb-8">
        <h2 id="integracoes" className="mb-2 text-lg font-bold">
          Integrações
        </h2>
        {integrations.data && list.length === 0 ? (
          <EmptyState title="Nenhuma integração ainda">
            Ligue o iFood (precisa do acesso de integrador do iFood), um marketplace por conector ou
            o simulador para treinar.
          </EmptyState>
        ) : (
          list.length > 0 && (
            <DataTable
              caption="Integrações de canais"
              rows={list}
              columns={[
                { header: 'Nome', cell: (i) => i.name },
                { header: 'Canal', cell: (i) => CHANNEL_PROVIDER_INFO[i.provider].name },
                {
                  header: 'Situação',
                  cell: (i) =>
                    i.missing ? (
                      <Badge tone="warning">{`Falta configurar: ${i.missing}`}</Badge>
                    ) : !i.active ? (
                      <Badge tone="neutral">Desligada</Badge>
                    ) : i.lastError ? (
                      <Badge tone="danger">{i.lastError}</Badge>
                    ) : (
                      <Badge tone="success">Em dia</Badge>
                    ),
                },
                { header: 'Pedidos abertos', cell: (i) => i.openOrders },
                { header: 'Última consulta', cell: (i) => when(i.lastPollAt) },
                {
                  header: 'Ações',
                  cell: (i) => (
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" onClick={() => setLinking(i)}>
                        Produtos ligados
                      </Button>
                      {canConfigure && (i.provider === 'ifood' || i.provider === 'simulator') && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void act(
                              () => api.post(`/channels/integrations/${i.id}/poll`, {}),
                              'Consulta feita.',
                            )
                          }
                        >
                          Buscar pedidos agora
                        </Button>
                      )}
                      {canConfigure && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void act(async () => {
                              const r = await api.post<ChannelCatalogSyncResult>(
                                `/channels/integrations/${i.id}/catalog-sync`,
                                {},
                              );
                              setNotice(
                                r.unavailable
                                  ? r.unavailable
                                  : `${r.sent} produto(s) enviados ao canal (${r.skipped} sem mudança).`,
                              );
                            })
                          }
                        >
                          Enviar cardápio e estoque
                        </Button>
                      )}
                      {canConfigure && i.provider === 'simulator' && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void act(
                                () => api.post(`/channels/integrations/${i.id}/simulate`, {}),
                                'Pedido de teste criado. Clique em "Buscar pedidos agora".',
                              )
                            }
                          >
                            Pedido de teste
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void act(
                                () =>
                                  api.post(`/channels/integrations/${i.id}/simulate`, {
                                    prepaid: true,
                                    unmapped: true,
                                  }),
                                'Pedido pago online, com item sem ligação, criado.',
                              )
                            }
                          >
                            Teste com item sem ligação
                          </Button>
                        </>
                      )}
                      {canConfigure && i.provider === 'generic' && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void act(async () => {
                              setCreated(
                                await api.post<ChannelIntegrationCreated>(
                                  `/channels/integrations/${i.id}/secret`,
                                  {},
                                ),
                              );
                            })
                          }
                        >
                          Gerar outro segredo
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )
        )}
      </section>

      <section aria-labelledby="pedidos">
        <h2 id="pedidos" className="mb-2 text-lg font-bold">
          Pedidos
        </h2>
        {orders.data && rows.length === 0 ? (
          <EmptyState title="Nenhum pedido ainda">
            Os pedidos aparecem aqui assim que o canal avisar. A tela se atualiza sozinha.
          </EmptyState>
        ) : (
          rows.length > 0 && (
            <DataTable
              caption="Pedidos dos canais"
              rows={rows}
              columns={[
                {
                  header: 'Pedido',
                  cell: (o) => (
                    <div>
                      <strong>{`${o.integrationName} #${o.displayId}`}</strong>
                      <div className="text-sm text-muted">{when(o.placedAt)}</div>
                    </div>
                  ),
                },
                {
                  header: 'Cliente',
                  cell: (o) => (
                    <div>
                      {o.customerName}
                      {o.address && <div className="text-sm text-muted">{o.address}</div>}
                    </div>
                  ),
                },
                {
                  header: 'Itens',
                  cell: (o) =>
                    o.items.map((i) => (
                      <div key={i.sku}>
                        {`${i.quantity}x ${i.name}`}
                        {!i.productId && <Badge tone="danger">Sem produto</Badge>}
                      </div>
                    )),
                },
                {
                  header: 'Total',
                  cell: (o) => (
                    <div>
                      {brl(o.totalCents)}
                      <div className="text-sm text-muted">
                        {o.prepaid ? 'Pago pelo canal' : 'Receber na entrega'}
                      </div>
                    </div>
                  ),
                },
                {
                  header: 'Situação',
                  cell: (o) => (
                    <div className="flex flex-col gap-1">
                      <Badge tone={STATUS_TONE[o.status]}>
                        {CHANNEL_ORDER_STATUS_LABELS[o.status]}
                      </Badge>
                      {o.pendingActions > 0 && (
                        <span className="text-sm text-muted">Avisando o canal...</span>
                      )}
                      {o.failedActions > 0 && (
                        <Badge tone="danger">O canal não recebeu o aviso</Badge>
                      )}
                      {o.cancelReason && <span className="text-sm">{o.cancelReason}</span>}
                    </div>
                  ),
                },
                {
                  header: 'Ações',
                  cell: (o) => (
                    <div className="flex flex-wrap gap-1">
                      {o.actions.map((a: ChannelAction) =>
                        a === 'reject' ? (
                          <Button key={a} variant="ghost" onClick={() => setRejecting(o)}>
                            {CHANNEL_ACTION_LABELS[a]}
                          </Button>
                        ) : (
                          <Button
                            key={a}
                            variant={a === 'accept' ? 'primary' : 'secondary'}
                            disabled={a === 'accept' && o.status === 'needs_mapping'}
                            onClick={() =>
                              void act(() => api.post(`/channels/orders/${o.id}/${a}`, {}))
                            }
                          >
                            {CHANNEL_ACTION_LABELS[a]}
                          </Button>
                        ),
                      )}
                      {o.failedActions > 0 && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void act(() => api.post(`/channels/orders/${o.id}/retry`, {}))
                          }
                        >
                          Avisar o canal de novo
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )
        )}
      </section>

      {editing && (
        <IntegrationDrawer
          onClose={() => setEditing(false)}
          onSaved={(c) => {
            setEditing(false);
            if (c.inboundSecret) setCreated(c);
            void refresh();
          }}
        />
      )}
      {linking && <LinksDrawer integration={linking} onClose={() => setLinking(null)} />}
      {rejecting && (
        <RejectDrawer
          order={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function IntegrationDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (c: ChannelIntegrationCreated) => void;
}) {
  const { api } = useApp();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [provider, setProvider] = useState<ChannelProvider>('ifood');
  const [name, setName] = useState('');
  const [storeId, setStoreId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [outboundUrl, setOutboundUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoAccept, setAutoAccept] = useState(false);
  const [commission, setCommission] = useState('');
  const [days, setDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const store = storeId || stores.data?.[0]?.id || '';

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const percent = Number(commission.replace(',', '.') || '0');
      if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
        throw new Error('Comissão inválida: use um número entre 0 e 50.');
      }
      onSaved(
        await api.post<ChannelIntegrationCreated>('/channels/integrations', {
          provider,
          name: name.trim() || CHANNEL_PROVIDER_INFO[provider].name,
          storeId: store,
          autoAccept,
          settlementDays: Number(days) || 30,
          // Pontos-base inteiros: 12,5% = 1250.
          commissionBps: Math.round(percent * 100),
          ...(outboundUrl.trim() && { outboundUrl: outboundUrl.trim() }),
          ...(provider === 'ifood' && {
            merchantId: merchantId.trim(),
            ...(clientId.trim() && { clientId: clientId.trim() }),
            ...(clientSecret.trim() && { clientSecret: clientSecret.trim() }),
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Nova integração">
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <SelectField
          label="Canal"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ChannelProvider)}
          options={CHANNEL_PROVIDERS.map((p) => ({
            value: p,
            label: CHANNEL_PROVIDER_INFO[p].name,
          }))}
        />
        <p className="text-sm text-muted">{CHANNEL_PROVIDER_INFO[provider].description}</p>
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Loja que atende o canal"
          value={store}
          onChange={(e) => setStoreId(e.target.value)}
          options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        {provider === 'ifood' && (
          <>
            <Alert tone="warning" title="Falta configurar no iFood">
              O Bipaê só conversa com o iFood depois que o iFood liberar o acesso de integrador
              (clientId e clientSecret). Sem eles, a integração fica salva e aparece como "Falta
              configurar".
            </Alert>
            <TextField
              label="Código da loja no iFood"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
            <TextField
              label="clientId"
              value={clientId}
              autoComplete="off"
              onChange={(e) => setClientId(e.target.value)}
            />
            <TextField
              label="clientSecret"
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </>
        )}
        {(provider === 'generic' ||
          provider === 'mercadolivre' ||
          provider === 'shopee' ||
          provider === 'amazon') && (
          <TextField
            label={
              provider === 'generic'
                ? 'Endereço (https) que recebe cardápio e estoque'
                : 'Endereço da API do marketplace (https)'
            }
            value={outboundUrl}
            onChange={(e) => setOutboundUrl(e.target.value)}
          />
        )}
        <Checkbox
          label="Aceitar os pedidos sozinho"
          checked={autoAccept}
          onChange={setAutoAccept}
        />
        <TextField
          label="Comissão do canal (%)"
          inputMode="decimal"
          value={commission}
          onChange={(e) => setCommission(e.target.value)}
        />
        <TextField
          label="Dias até o repasse cair"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        <Button loading={busy} disabled={!store} onClick={() => void save()}>
          Criar integração
        </Button>
      </div>
    </Drawer>
  );
}

function LinksDrawer({
  integration,
  onClose,
}: {
  integration: ChannelIntegrationView;
  onClose: () => void;
}) {
  const { api } = useApp();
  const canConfigure = useCan('admin.integrations');
  const queryClient = useQueryClient();
  const links = useQuery({
    queryKey: ['channels', 'links', integration.id],
    queryFn: () => api.get<ChannelLinkView[]>(`/channels/integrations/${integration.id}/links`),
  });
  const products = useQuery({
    queryKey: ['products', 'channel-links'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/products'),
  });
  const [sku, setSku] = useState('');
  const [productId, setProductId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['channels'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Produtos ligados: ${integration.name}`}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Cada item do pedido traz um código do canal. Ligue o código ao produto do Bipaê para o
          pedido poder ser aceito. Produto com o mesmo SKU liga sozinho.
        </p>
        {error && <Alert>{error}</Alert>}
        {canConfigure && (
          <div className="flex flex-col gap-3">
            <TextField
              label="Código no canal"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
            <SelectField
              label="Produto do Bipaê"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={[
                { value: '', label: 'Escolha...' },
                ...(products.data ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Button
              disabled={!sku.trim() || !productId}
              onClick={() =>
                void run(async () => {
                  await api.post(`/channels/integrations/${integration.id}/links`, {
                    sku: sku.trim(),
                    productId,
                  });
                  setSku('');
                })
              }
            >
              Ligar
            </Button>
          </div>
        )}
        {links.data && links.data.length === 0 ? (
          <EmptyState title="Nada ligado ainda">Os itens dos pedidos aparecem aqui.</EmptyState>
        ) : (
          <DataTable
            caption="Produtos ligados"
            rows={links.data ?? []}
            columns={[
              { header: 'Código no canal', cell: (l) => <code>{l.sku}</code> },
              { header: 'Produto', cell: (l) => l.productName },
              {
                header: '',
                cell: (l) =>
                  canConfigure && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void run(() =>
                          api.delete(
                            `/channels/integrations/${integration.id}/links/${encodeURIComponent(l.sku)}`,
                          ),
                        )
                      }
                    >
                      Desfazer
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </div>
    </Drawer>
  );
}

function RejectDrawer({
  order,
  onClose,
  onDone,
}: {
  order: ChannelOrderView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useApp();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Recusar pedido #${order.displayId}`}>
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Motivo (o canal pode mostrar ao cliente)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          disabled={reason.trim().length < 3}
          onClick={() =>
            void api
              .post(`/channels/orders/${order.id}/reject`, { reason: reason.trim() })
              .then(onDone)
              .catch((e: Error) => setError(e.message))
          }
        >
          Recusar pedido
        </Button>
      </div>
    </Drawer>
  );
}
