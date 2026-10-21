import {
  cents,
  formatBRL,
  type CertificateStatus,
  type ConfereNotices,
  type FinancialSummary,
  type MercadoflowDecisions,
  type Page,
  type Product,
  type SalesReport,
} from '@bipae/domain';
import { explainCapability, type CapabilityName, type CapabilityStatus } from '@bipae/platform';
import { Badge, Card, cx, PageHeader } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  PackagePlus,
  PartyPopper,
  Plus,
  ScanBarcode,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { CONFERE_NOTICES_KEY } from '../confere-notices';
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
  barcodeCamera: 'Câmera como leitor de código',
};

const VIA_LABEL = {
  native: 'direto',
  browser: 'pelo navegador',
  connector: 'pelo Bipaê Conector',
  server: 'pela nuvem',
};

/** Dia de hoje no fuso da loja (AAAA-MM-DD), o mesmo que os relatórios usam. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const brl = (value: number) => formatBRL(cents(value));
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * Início: o que a pessoa costuma querer fazer, o que precisa de atenção e como está o dia.
 * Tudo vem de dados que o Bipaê já tem; cada bloco só aparece para quem tem a permissão.
 */
export function HomePage() {
  const me = useMe();
  const firstName = me.user.name.split(' ')[0];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}!`} description={`Você está em ${me.tenant.name}.`} />
      <QuickActions />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AttentionCard />
        <TodayCard />
        <FirstStepsCard />
        <TinoCard />
        <CapabilitiesCard />
      </div>
    </>
  );
}

interface QuickAction {
  to: string;
  title: string;
  text: string;
  icon: LucideIcon;
  permission: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    to: '/caixa',
    title: 'Vender',
    text: 'Vai para a tela do caixa: bipe, receba e pronto.',
    icon: ScanBarcode,
    permission: 'pos.sell',
  },
  {
    to: '/produtos?novo=1',
    title: 'Cadastrar produto',
    text: 'Abre o cadastro já pronto para preencher.',
    icon: Plus,
    permission: 'catalog.write',
  },
  {
    to: '/compras',
    title: 'Dar entrada em mercadoria',
    text: 'Pelo XML da nota: produtos, custo e estoque de uma vez.',
    icon: PackagePlus,
    permission: 'catalog.write',
  },
  {
    to: '/financeiro',
    title: 'Pagar ou receber conta',
    text: 'Veja o que vence e dê baixa no que foi pago.',
    icon: Wallet,
    permission: 'finance.read',
  },
];

/** Regra dos 3 passos: escolher a tarefa aqui, preencher na tela seguinte, concluir. */
function QuickActions() {
  const me = useMe();
  const actions = QUICK_ACTIONS.filter((a) => me.permissions.includes(a.permission));
  if (actions.length === 0) return null;
  return (
    <section aria-labelledby="atalhos-titulo">
      <h2 id="atalhos-titulo" className="mb-3 text-lg font-bold">
        O que você quer fazer?
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map(({ to, title, text, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-full items-start gap-3 rounded-ui border border-border bg-surface p-4 shadow-sm hover:border-primary hover:bg-surface-2"
            >
              <Icon className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden />
              <span className="flex flex-col gap-1">
                <span className="font-bold">{title}</span>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Attention {
  key: string;
  tone: 'danger' | 'warning' | 'info';
  text: string;
  to: string | null;
  action: string;
}

/** Pendências que hoje ficam espalhadas por várias telas, juntas antes de virarem prejuízo. */
function AttentionCard() {
  const { api } = useApp();
  const canFinance = useCan('finance.read');
  const canCatalog = useCan('catalog.read');
  const canCompanies = useCan('admin.terminals');
  const finance = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn: () => api.get<FinancialSummary>('/finance/entries/summary'),
    enabled: canFinance,
    retry: false,
  });
  const lots = useQuery({
    queryKey: ['home', 'lots'],
    queryFn: () =>
      api.get<{ quantityMilli: number; daysLeft: number | null }[]>('/stock/lots?days=30'),
    enabled: canCatalog,
    retry: false,
  });
  const certificates = useQuery({
    queryKey: ['home', 'certificates'],
    queryFn: () => api.get<CertificateStatus[]>('/fiscal/certificates'),
    enabled: canCatalog,
    retry: false,
  });
  const notices = useQuery({
    queryKey: CONFERE_NOTICES_KEY,
    queryFn: () => api.get<ConfereNotices>('/mercadoflow/confere-notices'),
    enabled: canCatalog,
    retry: false,
  });
  if (!canFinance && !canCatalog) return null;

  const items: Attention[] = [];
  const f = finance.data;
  if (f && f.payable.overdueCents > 0) {
    items.push({
      key: 'pagar-atrasado',
      tone: 'danger',
      text: `${brl(f.payable.overdueCents)} em contas a pagar vencidas`,
      to: '/financeiro',
      action: 'Ver contas',
    });
  }
  if (f && f.receivable.overdueCents > 0) {
    items.push({
      key: 'receber-atrasado',
      tone: 'danger',
      text: `${brl(f.receivable.overdueCents)} a receber em atraso`,
      to: '/inadimplencia',
      action: 'Ver quem deve',
    });
  }
  if (f && f.payable.dueNext7Cents > 0) {
    items.push({
      key: 'pagar-semana',
      tone: 'warning',
      text: `${brl(f.payable.dueNext7Cents)} a pagar nos próximos 7 dias`,
      to: '/financeiro',
      action: 'Ver contas',
    });
  }
  const withStock = (lots.data ?? []).filter((l) => l.quantityMilli > 0 && l.daysLeft !== null);
  const expired = withStock.filter((l) => l.daysLeft! < 0).length;
  const expiring = withStock.filter((l) => l.daysLeft! >= 0).length;
  if (expired > 0) {
    items.push({
      key: 'lotes-vencidos',
      tone: 'danger',
      text: `${plural(expired, 'lote vencido', 'lotes vencidos')} ainda no estoque`,
      to: '/lotes',
      action: 'Ver lotes',
    });
  }
  if (expiring > 0) {
    items.push({
      key: 'lotes-vencendo',
      tone: 'warning',
      text: `${plural(expiring, 'lote vence', 'lotes vencem')} em até 30 dias`,
      to: '/lotes',
      action: 'Ver lotes',
    });
  }
  for (const c of certificates.data ?? []) {
    if (c.status === 'valido') continue;
    items.push({
      key: `certificado-${c.companyId}`,
      tone: c.status === 'vencido' ? 'danger' : 'warning',
      text:
        c.status === 'vencido'
          ? `O certificado digital de ${c.subject} venceu: as notas fiscais param`
          : `O certificado digital de ${c.subject} vence em ${plural(c.daysLeft, 'dia', 'dias')}`,
      to: canCompanies ? '/empresas' : null,
      action: canCompanies ? 'Trocar certificado' : 'Avise quem cuida da empresa',
    });
  }
  const unseen = notices.data?.unseen ?? 0;
  if (unseen > 0) {
    items.push({
      key: 'notas',
      tone: 'info',
      text: `${plural(unseen, 'nota nova', 'notas novas')} de fornecedor para conferir`,
      to: '/notas-de-entrada',
      action: 'Conferir',
    });
  }

  const loading = [finance, lots, certificates].some((q) => q.isLoading);
  const tones = {
    danger: 'text-danger',
    warning: 'text-accent',
    info: 'text-primary',
  };

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Precisa da sua atenção</h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-muted" role="status">
          {loading ? (
            'Conferindo as pendências…'
          ) : (
            <>
              <PartyPopper className="size-5 text-success" aria-hidden />
              Nada pendente por aqui. Tudo em dia!
            </>
          )}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Pendências">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-3">
              <AlertTriangle
                className={cx('mt-0.5 size-5 shrink-0', tones[item.tone])}
                aria-hidden
              />
              <span className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{item.text}</span>
                {item.to ? (
                  <Link
                    to={item.to}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline"
                  >
                    {item.action}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-sm text-muted">{item.action}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** A pergunta mais comum do dono, respondida sem abrir relatório nem escolher datas. */
function TodayCard() {
  const { api } = useApp();
  const canSee = useCan('finance.read');
  const day = today();
  const report = useQuery({
    queryKey: ['reports', 'sales', `from=${day}&to=${day}&group=day`],
    queryFn: () => api.get<SalesReport>(`/reports/sales?from=${day}&to=${day}&group=day`),
    enabled: canSee,
    retry: false,
  });
  if (!canSee || report.isError) return null;
  const r = report.data;

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">Hoje na loja</h2>
      {!r ? (
        <p className="text-muted" role="status">
          Somando as vendas de hoje…
        </p>
      ) : r.salesCount === 0 ? (
        <p className="text-muted">Nenhuma venda hoje ainda. A primeira bipada aparece aqui.</p>
      ) : (
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-sm text-muted">Vendas</dt>
            <dd className="text-2xl font-bold tabular-nums">{r.salesCount}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Faturamento</dt>
            <dd className="text-2xl font-bold tabular-nums">{brl(r.revenueCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Ticket médio</dt>
            <dd className="text-2xl font-bold tabular-nums">{brl(r.avgTicketCents)}</dd>
          </div>
        </dl>
      )}
      <Link
        to="/relatorios"
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline"
      >
        Ver o mês inteiro
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </Card>
  );
}

/** Primeiros passos que se marcam sozinhos e somem quando a loja já está rodando. */
function FirstStepsCard() {
  const { api } = useApp();
  const canCatalog = useCan('catalog.read');
  const products = useQuery({
    queryKey: ['products', 'count'],
    queryFn: () => api.get<Page<Product>>('/products?limit=1'),
    enabled: canCatalog,
  });
  const sales = useQuery({
    queryKey: ['sales', 'count'],
    queryFn: () => api.get<Page<unknown>>('/sales?limit=1'),
    enabled: canCatalog,
    retry: false,
  });
  if (!canCatalog || !products.data) return null;

  const steps = [
    { done: true, label: 'Criar sua conta', to: null },
    {
      done: products.data.total > 0,
      label: 'Cadastrar seus primeiros produtos',
      to: '/produtos?novo=1',
    },
    { done: (sales.data?.total ?? 0) > 0, label: 'Fazer uma venda de teste', to: '/caixa' },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
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
  );
}

function CapabilitiesCard() {
  const { platform } = useApp();
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => platform.capabilities(),
  });

  return (
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
