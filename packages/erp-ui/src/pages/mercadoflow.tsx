import type { MercadoflowLinkView, MercadoflowOverview } from '@bipae/domain';
import { Alert, Badge, Button, Card, Checkbox, PageHeader, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp, useCan } from '../context';

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
    if (platform.openExternal) await platform.openExternal(url);
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
      {link.lastError && <p className="mt-1 text-sm text-danger">{link.lastError}</p>}
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
