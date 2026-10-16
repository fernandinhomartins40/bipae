import { accountAccess, type AccountView, type AnnouncementView } from '@bipae/domain';
import { Alert, Button, cx, Logo } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgePercent,
  ArrowLeftRight,
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  FileX,
  FolderDown,
  Home,
  Landmark,
  ListChecks,
  LifeBuoy,
  LogOut,
  Monitor,
  Percent,
  PieChart,
  Package,
  PackagePlus,
  Printer,
  Scale,
  ScanBarcode,
  Settings,
  Sparkles,
  Tag,
  Tags,
  ShieldCheck,
  Truck,
  UserRound,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useConfereNotices } from '../confere-notices';
import { useApp, useMe } from '../context';
import { endSupportSession, readSupportSession } from '../support';

const NAV = [
  { to: '/', label: 'Início', icon: Home, permission: null },
  { to: '/caixa', label: 'Abrir o caixa', icon: ScanBarcode, permission: 'pos.sell' },
  { to: '/vendas', label: 'Vendas', icon: BarChart3, permission: 'catalog.read' },
  { to: '/produtos', label: 'Produtos', icon: Package, permission: 'catalog.read' },
  {
    to: '/pedidos-de-compra',
    label: 'Pedidos de compra',
    icon: ClipboardList,
    permission: 'catalog.read',
  },
  { to: '/compras', label: 'Compras', icon: PackagePlus, permission: 'catalog.read' },
  { to: '/inventario', label: 'Inventário', icon: ListChecks, permission: 'catalog.read' },
  { to: '/lotes', label: 'Lote e validade', icon: CalendarClock, permission: 'catalog.read' },
  { to: '/etiquetas', label: 'Etiquetas', icon: Tag, permission: 'catalog.read' },
  { to: '/promocoes', label: 'Promoções', icon: BadgePercent, permission: 'catalog.read' },
  {
    to: '/transferencias',
    label: 'Transferências',
    icon: ArrowLeftRight,
    permission: 'catalog.read',
  },
  {
    to: '/notas-de-entrada',
    label: 'Notas de entrada',
    icon: ClipboardCheck,
    permission: 'catalog.read',
  },
  { to: '/relatorios', label: 'Relatórios', icon: PieChart, permission: 'finance.read' },
  {
    to: '/financeiro',
    label: 'Contas a pagar e receber',
    icon: Wallet,
    permission: 'finance.read',
  },
  { to: '/fluxo-de-caixa', label: 'Fluxo de caixa', icon: TrendingUp, permission: 'finance.read' },
  { to: '/dre', label: 'DRE gerencial', icon: FileBarChart, permission: 'finance.read' },
  {
    to: '/apuracao-ibs-cbs',
    label: 'Apuração de IBS e CBS',
    icon: Scale,
    permission: 'finance.read',
  },
  {
    to: '/contador',
    label: 'Arquivos para o contador',
    icon: FolderDown,
    permission: 'finance.read',
  },
  {
    to: '/conciliacao-bancaria',
    label: 'Conciliação bancária',
    icon: Landmark,
    permission: 'finance.read',
  },
  {
    to: '/recebiveis',
    label: 'Recebíveis de cartão e Pix',
    icon: CreditCard,
    permission: 'finance.read',
  },
  { to: '/inadimplencia', label: 'Inadimplência', icon: AlertTriangle, permission: 'finance.read' },
  { to: '/tabelas-de-preco', label: 'Tabelas de preço', icon: Tags, permission: 'catalog.read' },
  { to: '/perfis-fiscais', label: 'Perfis fiscais', icon: Landmark, permission: 'catalog.read' },
  { to: '/regras-icms', label: 'Regras de ICMS', icon: Percent, permission: 'catalog.read' },
  {
    to: '/inutilizacao',
    label: 'Inutilização de números',
    icon: FileX,
    permission: 'catalog.read',
  },
  { to: '/clientes', label: 'Clientes', icon: UserRound, permission: 'parties.read' },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'parties.read' },
  { to: '/empresas', label: 'Empresas e lojas', icon: Building2, permission: 'admin.terminals' },
  { to: '/caixas', label: 'Caixas', icon: Monitor, permission: 'admin.terminals' },
  { to: '/equipe', label: 'Equipe', icon: Users, permission: 'admin.users' },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, permission: 'audit.read' },
  { to: '/perifericos', label: 'Periféricos', icon: Printer, permission: 'pos.sell' },
  { to: '/baixar', label: 'Baixar o desktop', icon: Download, permission: null },
  { to: '/assinatura', label: 'Minha assinatura', icon: CreditCard, permission: 'admin.users' },
  { to: '/mercadoflow', label: 'MercadoFlow', icon: Sparkles, permission: 'admin.stores' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, permission: null },
] as const;

const LEVEL_TONE = { info: 'success', warning: 'warning', critical: 'danger' } as const;

export function Shell() {
  const { api, setMe, platform } = useApp();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const items = NAV.filter(
    (n) =>
      (!n.permission || me.permissions.includes(n.permission)) &&
      !(n.to === '/baixar' && platform.kind === 'desktop'),
  );
  const support = me.support ? readSupportSession() : null;
  const unseenNotes = useConfereNotices();

  const account = useQuery({
    queryKey: ['account'],
    queryFn: () => api.get<AccountView>('/account'),
    staleTime: 60_000,
  });
  const announcements = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<AnnouncementView[]>('/announcements'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const access = account.data
    ? accountAccess(account.data.tenant.status, account.data.tenant.trialEndsAt)
    : { allowed: true };

  const logout = async () => {
    await api.logout();
    setMe(null);
    if (support) {
      endSupportSession();
      window.close();
    }
    navigate('/entrar');
  };

  const switchTenant = async (tenantId: string) => {
    if (tenantId === me.tenant.id) return;
    const next = await api.switchTenant(tenantId);
    queryClient.clear();
    setMe(next);
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col">
      {me.support && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2 font-semibold text-accent-contrast"
        >
          <LifeBuoy className="size-5" aria-hidden />
          Modo suporte Bipaê
          {me.support.readOnly ? ' · somente leitura' : ' · alterações ficam registradas'}
          {support &&
            ` · termina às ${new Date(support.expiresAt).toLocaleTimeString('pt-BR', { timeStyle: 'short' })}`}
          <Button variant="secondary" onClick={() => void logout()}>
            Encerrar suporte
          </Button>
        </div>
      )}
      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="border-b border-border bg-surface md:w-64 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between p-4">
            <Logo className="text-xl" />
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
              {platform.kind === 'desktop' ? 'Desktop' : 'Online'}
            </span>
          </div>
          <nav
            aria-label="Menu principal"
            className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col"
          >
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-11 shrink-0 items-center gap-3 rounded-ui px-3 font-medium',
                    isActive ? 'bg-primary text-primary-contrast' : 'hover:bg-surface-2',
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label}
                {to === '/notas-de-entrada' && unseenNotes > 0 && (
                  <span
                    className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-contrast"
                    aria-label={
                      unseenNotes === 1
                        ? '1 nota nova para conferir'
                        : `${unseenNotes} notas novas para conferir`
                    }
                  >
                    {unseenNotes > 99 ? '99+' : unseenNotes}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="hidden border-t border-border p-4 md:block">
            {me.tenants.length > 1 && !me.support ? (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Empresa
                <select
                  className="min-h-11 rounded-ui border border-border bg-surface px-2 font-semibold"
                  value={me.tenant.id}
                  onChange={(e) => void switchTenant(e.target.value)}
                >
                  {me.tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="truncate font-semibold">{me.tenant.name}</p>
            )}
            <p className="mt-1 truncate text-sm text-muted">{me.user.name}</p>
            <Button
              variant="ghost"
              className="mt-2 w-full justify-start"
              icon={<LogOut className="size-5" aria-hidden />}
              onClick={() => void logout()}
            >
              Sair
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          {announcements.data && announcements.data.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              {announcements.data.map((a) => (
                <Alert key={a.id} tone={LEVEL_TONE[a.level]} title={a.title}>
                  {a.body}
                </Alert>
              ))}
            </div>
          )}
          {access.allowed ? (
            <Outlet />
          ) : (
            <div className="mx-auto max-w-xl py-12 text-center">
              <h1 className="text-2xl font-bold">
                {access.code === 'trial_expired'
                  ? 'Seu período de teste terminou'
                  : 'Conta indisponível'}
              </h1>
              <p className="mt-3 text-lg text-muted">{access.message}</p>
              {account.data?.tenant.statusReason && (
                <p className="mt-2 text-muted">Motivo: {account.data.tenant.statusReason}</p>
              )}
              <p className="mt-6 text-sm text-muted">
                Os caixas continuam enviando as vendas feitas sem internet: nada se perde.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
