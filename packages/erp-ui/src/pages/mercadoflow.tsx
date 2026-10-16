import {
  cents,
  formatBRL,
  type MercadoflowLinkView,
  type MercadoflowOverview,
  type MercadoflowPendingView,
} from '@bipae/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, PageHeader, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp, useCan } from '../context';

/** Data e hora de Brasília (dd/mm/aaaa hh:mm). */
const when = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

const STATUS: Record<
  NonNullable<MercadoflowLinkView['status']>,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  ATIVA: { label: 'Vinculada', tone: 'success' },
  PENDENTE: { label: 'Aguardando a aprovação no MercadoFlow', tone: 'warning' },
  REVOGADA: { label: 'Vínculo encerrado', tone: 'danger' },
  RECUSADA: { label: 'Vínculo recusado', tone: 'danger' },
  EXPIRADA: { label: 'Link expirado', tone: 'neutral' },
};

const AUTHORIZATION =
  'Autorizo a criação da conta no MercadoFlow e o envio das vendas, do cadastro, dos preços, do estoque e das notas de entrada desta loja para gerar as análises, e aceito os termos de uso do MercadoFlow.';

/**
 * Tela "MercadoFlow" (seção 5 do contrato): criar ou vincular a conta de cada loja, ver a
 * situação, o desconto de cliente Bipaê e a fila de envio. O Bipaê nunca vê a senha do
 * MercadoFlow: a conta criada recebe o link de senha por e-mail.
 */
export function MercadoflowPage() {
  const { api } = useApp();
  const canManage = useCan('admin.stores');
  const overview = useQuery({
    queryKey: ['mercadoflow'],
    queryFn: () => api.get<MercadoflowOverview>('/mercadoflow'),
    enabled: canManage,
  });
  if (!canManage) {
    return (
      <>
        <PageHeader title="MercadoFlow" />
        <Alert>Só quem gerencia as empresas e lojas pode vincular o MercadoFlow.</Alert>
      </>
    );
  }
  const data = overview.data;
  return (
    <>
      <PageHeader
        title="MercadoFlow"
        description="Inteligência de compras, preço e o Confere (notas de entrada), integrados ao Bipaê."
      />
      {overview.error && <Alert>{(overview.error as Error).message}</Alert>}
      {data && !data.enabled && (
        <Alert tone="warning" title="Chega em breve">
          A integração com o MercadoFlow ainda não está ligada no Bipaê.
        </Alert>
      )}
      {data?.enabled && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-lg font-semibold">
              Clientes Bipaê têm desconto no plano do MercadoFlow.
            </p>
            <p className="text-sm text-muted">
              Crie a conta sem sair do Bipaê ou vincule a que você já tem. O desconto vale enquanto
              a sua assinatura do Bipaê estiver ativa.
            </p>
          </Card>
          {data.stores.map((store) => (
            <StoreLink
              key={store.storeId}
              link={store}
              termsUrl={data.termsUrl}
              publicUrl={data.publicUrl}
            />
          ))}
          <ApprovedPrices />
          <Encartes />
          <Card>
            <h2 className="text-lg font-bold">Envio ao MercadoFlow</h2>
            <p className="text-sm text-muted">
              {data.queue.pending} na fila · {data.queue.sent} enviados · {data.queue.rejected}{' '}
              recusados
            </p>
            {data.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {data.errors.map((e, i) => (
                  <li key={i}>{e.error}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function StoreLink({
  link,
  termsUrl,
  publicUrl,
}: {
  link: MercadoflowLinkView;
  termsUrl: string | null;
  publicUrl: string;
}) {
  const { api, platform } = useApp();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'idle' | 'create'>('idle');
  const [phone, setPhone] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(link.connectUrl);
  const [busy, setBusy] = useState(false);
  const reload = () => queryClient.invalidateQueries({ queryKey: ['mercadoflow'] });

  // Enquanto o vínculo estiver pendente, pergunta ao MercadoFlow a cada 30 segundos.
  useEffect(() => {
    if (link.status !== 'PENDENTE') return;
    const timer = setInterval(() => {
      void api
        .post<{ status: string }>(`/mercadoflow/links/${link.storeId}/refresh`)
        .then(async (r) => {
          if (r.status !== 'PENDENTE') {
            await queryClient.invalidateQueries({ queryKey: ['mercadoflow'] });
          }
        })
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [api, queryClient, link.status, link.storeId]);

  const open = async (url: string) => {
    setConnectUrl(url);
    // Se o navegador não abrir, o link continua na tela para copiar.
    if (platform.openExternal) await platform.openExternal(url).catch(() => undefined);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const result = await api.post<
        | { status: 'CRIADA'; email: string }
        | { status: 'JA_TEM_CONTA'; message: string; connectUrl: string }
      >('/mercadoflow/accounts', {
        storeId: link.storeId,
        phone,
        acceptTerms: accepted || undefined,
      });
      if (result.status === 'CRIADA') {
        setMessage({
          ok: true,
          text: `Conta criada! Enviamos para ${result.email} o link para criar a senha do MercadoFlow.`,
        });
      } else {
        setMessage({
          ok: true,
          text: `${result.message} Entre no MercadoFlow para autorizar o vínculo.`,
        });
        await open(result.connectUrl);
      }
      setMode('idle');
      await reload();
    });

  const connect = () =>
    run(async () => {
      const returnUrl = window.location.href.startsWith('http')
        ? window.location.href
        : 'https://www.bipae.com.br/app/mercadoflow';
      const result = await api.post<{ connectUrl: string }>('/mercadoflow/connect', {
        storeId: link.storeId,
        returnUrl,
      });
      await open(result.connectUrl);
      await reload();
    });

  const status = link.status ? STATUS[link.status] : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{link.storeName}</h2>
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : <Badge>Sem vínculo</Badge>}
      </div>
      {link.salesPausedUntil ? (
        <div className="mt-3">
          <Alert tone="warning" title="Limite do plano do MercadoFlow">
            As vendas desta loja voltam a ser enviadas às {when(link.salesPausedUntil)}. Para não
            pausar, aumente o plano no MercadoFlow.{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void open(`${publicUrl}/app/planos`)}
            >
              Ver planos
            </button>
          </Alert>
        </div>
      ) : (
        link.lastError && <p className="mt-1 text-sm text-danger">{link.lastError}</p>
      )}
      {link.lastSalesSyncAt && (
        <p className="mt-1 text-sm text-muted">
          Vendas enviadas ao MercadoFlow pela última vez em {when(link.lastSalesSyncAt)}.
        </p>
      )}
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {link.status === 'ATIVA' && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {link.discount?.active && link.discount.percent !== undefined && (
            <p className="text-base font-semibold text-success">
              Desconto de cliente Bipaê: {link.discount.percent}% no plano do MercadoFlow.
            </p>
          )}
          <p className="text-muted">Permissões: {link.scopes.join(', ') || 'nenhuma'}</p>
          <Checkbox
            label="Aplicar sozinho os preços aprovados no MercadoFlow"
            hint="Desligado, cada preço aprovado espera você conferir e aplicar."
            checked={link.autoApply.prices}
            onChange={(checked) =>
              void run(async () => {
                await api.put(`/mercadoflow/links/${link.storeId}/auto-apply`, { prices: checked });
                await reload();
              })
            }
          />
          {link.scopes.includes('promotions:read') && (
            <>
              <Checkbox
                label="Aplicar sozinho os encartes do MercadoFlow"
                hint="Desligado, cada encarte espera você conferir e aplicar. O Bipaê busca os encartes de hora em hora."
                checked={link.autoApply.promotions}
                onChange={(checked) =>
                  void run(async () => {
                    await api.put(`/mercadoflow/links/${link.storeId}/auto-apply`, {
                      promotions: checked,
                    });
                    await reload();
                  })
                }
              />
              <div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { found } = await api.post<{ found: number }>(
                        `/mercadoflow/links/${link.storeId}/promotions/fetch`,
                      );
                      setMessage({
                        ok: true,
                        text:
                          found === 0
                            ? 'Nenhum encarte valendo no MercadoFlow agora.'
                            : `${found} encarte(s) do MercadoFlow conferido(s).`,
                      });
                      await queryClient.invalidateQueries({
                        queryKey: ['mercadoflow', 'pendings'],
                      });
                    })
                  }
                >
                  Buscar encartes agora
                </Button>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void open(`${publicUrl}/app`)}>
              Abrir o MercadoFlow
            </Button>
            <Button variant="ghost" onClick={() => void open(`${publicUrl}/app/integracoes`)}>
              Gerenciar permissões
            </Button>
          </div>
        </div>
      )}
      {link.status !== 'ATIVA' && mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setMode('create')} disabled={busy}>
            Criar minha conta MercadoFlow
          </Button>
          <Button variant="secondary" onClick={() => void connect()} disabled={busy}>
            Já tenho conta MercadoFlow
          </Button>
        </div>
      )}
      {mode === 'create' && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">
            Usamos o CNPJ e o nome da empresa desta loja, e o seu nome e e-mail. A senha você cria
            pelo link que o MercadoFlow manda para o seu e-mail.
          </p>
          <TextField
            label="Telefone com DDD"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Checkbox label={AUTHORIZATION} checked={accepted} onChange={setAccepted} />
          {termsUrl && (
            <a
              className="text-sm text-primary underline"
              href={termsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ler os termos de uso do MercadoFlow
            </a>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? 'Criando...' : 'Criar a conta'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {link.status === 'PENDENTE' && connectUrl && (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p>
            Entre no MercadoFlow por este link para aprovar o vínculo. Esta tela atualiza sozinha.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface-2 px-2 py-1">{connectUrl}</code>
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(connectUrl)}>
              Copiar link
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const brl = (value: unknown) => (typeof value === 'number' ? formatBRL(cents(value)) : '—');

/**
 * Preços aprovados no MercadoFlow (MF-11.a): cada um espera o gerente aplicar (na tabela de
 * preço da loja, se ela tiver uma) ou descartar.
 */
function ApprovedPrices() {
  const { api } = useApp();
  const canApply = useCan('catalog.price.write');
  const queryClient = useQueryClient();
  const pendings = useQuery({
    queryKey: ['mercadoflow', 'pendings'],
    queryFn: () => api.get<MercadoflowPendingView[]>('/mercadoflow/pendings'),
  });
  const [error, setError] = useState<string | null>(null);
  const prices = (pendings.data ?? []).filter((p) => p.kind === 'price');
  if (prices.length === 0) return null;
  const act = async (id: string, action: 'apply' | 'dismiss') => {
    setError(null);
    try {
      await api.post(`/mercadoflow/pendings/${id}/${action}`);
    } catch (e) {
      setError((e as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ['mercadoflow', 'pendings'] });
  };
  return (
    <section aria-label="Preços aprovados no MercadoFlow">
      <h2 className="mb-2 text-lg font-bold">Preços aprovados no MercadoFlow</h2>
      {error && <Alert>{error}</Alert>}
      <DataTable
        caption="Preços aprovados no MercadoFlow"
        rows={prices}
        columns={[
          { header: 'Loja', cell: (p) => p.storeName },
          {
            header: 'Produto',
            cell: (p) => (
              <span className="flex flex-col">
                <span>{String(p.data.productName ?? p.data.gtin)}</span>
                {p.problem && <span className="text-sm text-danger">{p.problem}</span>}
              </span>
            ),
          },
          { header: 'Preço atual', align: 'right', cell: (p) => brl(p.data.currentPriceCents) },
          { header: 'Aprovado', align: 'right', cell: (p) => brl(p.data.priceCents) },
          { header: 'Quem aprovou', cell: (p) => String(p.data.approvedBy ?? '—') },
          {
            header: '',
            align: 'right',
            cell: (p) =>
              canApply ? (
                <span className="flex justify-end gap-2">
                  <Button onClick={() => void act(p.id, 'apply')} disabled={Boolean(p.problem)}>
                    Aplicar
                  </Button>
                  <Button variant="ghost" onClick={() => void act(p.id, 'dismiss')}>
                    Descartar
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
    </section>
  );
}

const shortDay = (value: unknown) =>
  typeof value === 'string' ? value.split('-').reverse().join('/') : '—';

/**
 * Encartes do MercadoFlow (MF-11.b): cada encarte espera o gerente aplicar (vira uma promoção
 * por produto, só na loja dele) ou descartar.
 */
function Encartes() {
  const { api } = useApp();
  const canApply = useCan('catalog.price.write');
  const queryClient = useQueryClient();
  const pendings = useQuery({
    queryKey: ['mercadoflow', 'pendings'],
    queryFn: () => api.get<MercadoflowPendingView[]>('/mercadoflow/pendings'),
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const list = (pendings.data ?? []).filter((p) => p.kind === 'promotion');
  if (list.length === 0 && !message) return null;
  const act = async (id: string, action: 'apply' | 'dismiss') => {
    setMessage(null);
    try {
      const result = await api.post<{ promotions?: number }>(
        `/mercadoflow/pendings/${id}/${action}`,
      );
      if (action === 'apply') {
        setMessage({
          ok: true,
          text: `Encarte aplicado: ${result.promotions ?? 0} promoção(ões) criada(s) no caixa desta loja.`,
        });
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
    await queryClient.invalidateQueries({ queryKey: ['mercadoflow', 'pendings'] });
  };
  const items = (p: MercadoflowPendingView) =>
    (p.data.items as { productId: string | null }[] | undefined) ?? [];
  return (
    <section aria-label="Encartes do MercadoFlow">
      <h2 className="mb-2 text-lg font-bold">Encartes do MercadoFlow</h2>
      {message && (
        <div className="mb-2">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {list.length > 0 && (
        <DataTable
          caption="Encartes do MercadoFlow"
          rows={list}
          columns={[
            { header: 'Loja', cell: (p) => p.storeName },
            {
              header: 'Encarte',
              cell: (p) => (
                <span className="flex flex-col">
                  <span className="font-semibold">{String(p.data.name)}</span>
                  {p.problem && <span className="text-sm text-danger">{p.problem}</span>}
                </span>
              ),
            },
            {
              header: 'Vigência',
              cell: (p) => `${shortDay(p.data.validFrom)} a ${shortDay(p.data.validUntil)}`,
            },
            {
              header: 'Produtos',
              cell: (p) => {
                const all = items(p);
                const found = all.filter((i) => i.productId).length;
                return found === all.length
                  ? `${all.length}`
                  : `${found} de ${all.length} cadastrados no Bipaê`;
              },
            },
            {
              header: '',
              align: 'right',
              cell: (p) =>
                canApply ? (
                  <span className="flex justify-end gap-2">
                    <Button onClick={() => void act(p.id, 'apply')} disabled={Boolean(p.problem)}>
                      Aplicar
                    </Button>
                    <Button variant="ghost" onClick={() => void act(p.id, 'dismiss')}>
                      Descartar
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
      )}
    </section>
  );
}
