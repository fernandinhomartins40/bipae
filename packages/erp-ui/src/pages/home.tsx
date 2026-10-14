import {
  cents,
  formatBRL,
  type MercadoflowDecisions,
  type Page,
  type Product,
} from '@bipae/domain';
import { explainCapability, type CapabilityName, type CapabilityStatus } from '@bipae/platform';
import { Badge, Card, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ExternalLink, Sparkles } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { useApp, useCan, useMe } from '../context';

const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  storage: 'Banco local (vender sem internet)',
  printer: 'Impressora',
  cashDrawer: 'Gaveta de dinheiro',
  scale: 'Balança',
  tef: 'TEF / pinpad',
  certificateA1: 'Certificado A1',
  certificateA3: 'Certificado A3',
  updater: 'Atualização automática',
  notifications: 'Notificações',
};

const VIA_LABEL = {
  native: 'direto',
  browser: 'pelo navegador',
  connector: 'pelo Bipaê Conector',
  server: 'pela nuvem',
};

export function HomePage() {
  const { api, platform } = useApp();
  const me = useMe();
  const products = useQuery({
    queryKey: ['products', 'count'],
    queryFn: () => api.get<Page<Product>>('/products?limit=1'),
    enabled: me.permissions.includes('catalog.read'),
  });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => platform.capabilities(),
  });

  const firstName = me.user.name.split(' ')[0];
  const hasProducts = (products.data?.total ?? 0) > 0;
  const steps = [
    { done: true, label: 'Criar sua conta', to: null },
    { done: hasProducts, label: 'Cadastrar seus primeiros produtos', to: '/produtos' },
    { done: false, label: 'Fazer uma venda de teste', to: '/caixa' },
  ];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}!`} description={`Você está em ${me.tenant.name}.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-bold">Primeiros passos</h2>
          <ol className="flex flex-col gap-3">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-3">
                {step.done ? (
                  <CheckCircle2 className="size-6 text-success" aria-label="Feito" />
                ) : (
                  <Circle className="size-6 text-muted" aria-label="A fazer" />
                )}
                {step.to && !step.done ? (
                  <Link to={step.to} className="font-medium text-primary underline">
                    {step.label}
                  </Link>
                ) : (
                  <span className={step.done ? 'text-muted line-through' : ''}>{step.label}</span>
                )}
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">
            O que funciona {platform.kind === 'desktop' ? 'neste computador' : 'neste navegador'}
          </h2>
          <p className="mb-4 text-sm text-muted">
            Bipaê {platform.kind === 'desktop' ? 'Desktop' : 'Online'} · versão {platform.version}
          </p>
          <ul className="flex flex-col gap-3">
            {capabilities.data &&
              (Object.entries(capabilities.data) as [CapabilityName, CapabilityStatus][]).map(
                ([name, status]) => {
                  const explanation = explainCapability(name, status, platform.kind);
                  return (
                    <li key={name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{CAPABILITY_LABELS[name]}</span>
                        {status.available ? (
                          <Badge tone="success">Disponível {VIA_LABEL[status.via]}</Badge>
                        ) : (
                          <Badge tone="warning">{explanation?.title ?? 'Indisponível'}</Badge>
                        )}
                      </div>
                      {explanation && <p className="text-sm text-muted">{explanation.message}</p>}
                    </li>
                  );
                },
              )}
          </ul>
        </Card>
        <TinoCard />
      </div>
    </>
  );
}

/** 'COMPRAR' → 'Comprar' (o tipo vem do MercadoFlow; o Bipaê não inventa tipos). */
const actionLabel = (type: string) =>
  type ? type.charAt(0) + type.slice(1).toLowerCase().replaceAll('_', ' ') : 'Outras';

/**
 * Card do Tino (MF-10): decisões que o MercadoFlow sugere para cada loja vinculada. O Bipaê só
 * mostra; cada decisão abre no MercadoFlow, onde é tomada.
 */
function TinoCard() {
  const { api, platform } = useApp();
  const canSee = useCan('catalog.price.write');
  const decisions = useQuery({
    queryKey: ['mercadoflow', 'decisions'],
    queryFn: () => api.get<MercadoflowDecisions>('/mercadoflow/decisions'),
    enabled: canSee,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const stores = decisions.data?.enabled ? decisions.data.stores : [];
  if (!canSee || stores.length === 0) return null;

  const openLink = (url: string) => (event: MouseEvent) => {
    if (!platform.openExternal) return;
    event.preventDefault();
    void platform.openExternal(url);
  };
  const link = (url: string, text: string) => (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={openLink(url)}
      className="inline-flex items-center gap-1 font-medium text-primary underline"
    >
      {text}
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );

  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Sparkles className="size-5 text-primary" aria-hidden />
        Tino, do MercadoFlow
      </h2>
      <p className="mb-4 text-sm text-muted">
        Sugestões para suas lojas. A decisão é tomada no MercadoFlow.
      </p>
      <div className="flex flex-col gap-6">
        {stores.map((store) => (
          <section key={store.storeId} aria-label={`Tino: ${store.storeName}`}>
            {stores.length > 1 && <h3 className="mb-2 font-semibold">{store.storeName}</h3>}
            {store.status === 'unavailable' ? (
              <p className="text-sm text-muted">
                O MercadoFlow não respondeu agora. As decisões voltam a aparecer em instantes.
              </p>
            ) : (
              <>
                <p className="text-base">
                  <strong>{store.total === 1 ? '1 decisão' : `${store.total} decisões`}</strong>
                  {store.expectedImpactCents > 0 && (
                    <> ({formatBRL(cents(store.expectedImpactCents))} em jogo)</>
                  )}
                </p>
                {Object.keys(store.byActionType).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(store.byActionType).map(([type, count]) => (
                      <Badge key={type} tone="neutral">
                        {actionLabel(type)}: {count}
                      </Badge>
                    ))}
                  </div>
                )}
                {store.lockedByPlan && (
                  <p className="mt-2 text-sm text-muted">
                    Algumas decisões dependem do plano do MercadoFlow.
                  </p>
                )}
                {store.items.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-3">
                    {store.items.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5">
                        <span className="font-medium">{item.title || item.productName}</span>
                        {item.rationale && (
                          <span className="text-sm text-muted">{item.rationale}</span>
                        )}
                        <span className="flex flex-wrap items-center gap-3 text-sm">
                          {item.expectedImpactCents !== null && item.expectedImpactCents > 0 && (
                            <span>{formatBRL(cents(item.expectedImpactCents))} em jogo</span>
                          )}
                          {item.url && link(item.url, 'Ver no MercadoFlow')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {store.url && (
                  <div className="mt-3">{link(store.url, 'Ver todas as decisões')}</div>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
