import { accountAccess, type AccountView, type AnnouncementView } from '@bipae/domain';
import { EmailVerificationBanner } from './auth';
import { Alert, Button, cx, Logo } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Home,
  LifeBuoy,
  LogOut,
  Menu,
  ScanBarcode,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useConfereNotices } from '../confere-notices';
import { useApp, useMe } from '../context';
import { groupOf, searchNav, visibleGroups, type NavItem } from '../nav';
import { endSupportSession, readSupportSession } from '../support';

const LEVEL_TONE = { info: 'success', warning: 'warning', critical: 'danger' } as const;

/** Grupos que a pessoa deixou abertos: conveniência deste aparelho, não dado do negócio. */
const OPEN_GROUPS_KEY = 'bipae.menu.abertos';

function readOpenGroups(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveOpenGroups(ids: string[]) {
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(ids));
  } catch {
    // Sem armazenamento (janela anônima): o menu só não lembra o que estava aberto.
  }
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex min-h-11 items-center gap-3 rounded-ui border-l-4 px-3 font-medium',
    // Verde cheio fica só para "Abrir o caixa"; a tela atual ganha fundo e barra.
    isActive
      ? 'border-primary bg-surface-2 font-semibold text-text'
      : 'border-transparent hover:bg-surface-2',
  );

function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-contrast"
      aria-label={label}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function Shell() {
  const { api, setMe, platform } = useApp();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const support = me.support ? readSupportSession() : null;
  const unseenNotes = useConfereNotices();

  const groups = useMemo(
    () => visibleGroups(me.permissions, (i) => i.to === '/baixar' && platform.kind === 'desktop'),
    [me.permissions, platform.kind],
  );
  const activeGroup = groupOf(location.pathname);
  const withActive = (ids: string[]) =>
    activeGroup && !ids.includes(activeGroup) ? [...ids, activeGroup] : ids;
  const [openGroups, setOpenGroups] = useState<string[]>(() => withActive(readOpenGroups()));
  const [query, setQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [seenPath, setSeenPath] = useState(location.pathname);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const results = searchNav(groups, query);

  // Cada troca de tela fecha a gaveta do celular, limpa a busca e abre o grupo da tela.
  if (seenPath !== location.pathname) {
    setSeenPath(location.pathname);
    setMobileOpen(false);
    setQuery('');
    setOpenGroups(withActive(openGroups));
  }

  useEffect(() => saveOpenGroups(openGroups), [openGroups]);

  useEffect(() => {
    if (!mobileOpen) return;
    searchRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMobileOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const toggleGroup = (id: string) =>
    setOpenGroups((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]));

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.stopPropagation();
      setQuery('');
    }
    if (e.key === 'Enter' && results[0]) void navigate(results[0].item.to);
  };

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

  const canSell = me.permissions.includes('pos.sell');
  const notesLabel =
    unseenNotes === 1 ? '1 nota nova para conferir' : `${unseenNotes} notas novas para conferir`;

  const itemLink = (item: NavItem, hint?: ReactNode) => {
    const Icon: LucideIcon = item.icon;
    return (
      <NavLink to={item.to} className={linkClass}>
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="flex flex-col">
          {item.label}
          {hint}
        </span>
        {item.to === '/notas-de-entrada' && unseenNotes > 0 && (
          <CountBadge count={unseenNotes} label={notesLabel} />
        )}
      </NavLink>
    );
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* WCAG 2.4.1: quem usa teclado pula o menu e vai direto ao conteúdo. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-ui focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
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
      {/* Celular: barra fixa com o menu em gaveta e o caixa sempre à mão. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-3 py-2 md:hidden">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          aria-label="Abrir o menu"
          aria-expanded={mobileOpen}
          aria-controls="menu-lateral"
          icon={<Menu className="size-6" aria-hidden />}
          onClick={() => setMobileOpen(true)}
        />
        <Logo className="min-w-0 flex-1 truncate text-lg" />
        {canSell && (
          <NavLink
            to="/caixa"
            className="flex min-h-11 items-center gap-2 rounded-ui bg-primary px-3 font-semibold text-primary-contrast"
          >
            <ScanBarcode className="size-5" aria-hidden />
            Abrir o caixa
          </NavLink>
        )}
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-hidden
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          id="menu-lateral"
          className={cx(
            'flex-col border-border bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:border-r',
            mobileOpen
              ? 'fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-xs border-r shadow-xl'
              : 'hidden',
          )}
        >
          <div className="flex items-center justify-between gap-2 p-4">
            <Logo className="text-xl" />
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
              {platform.kind === 'desktop' ? 'Desktop' : 'Online'}
            </span>
            {mobileOpen && (
              <Button
                variant="ghost"
                className="md:hidden"
                aria-label="Fechar o menu"
                icon={<X className="size-5" aria-hidden />}
                onClick={() => {
                  setMobileOpen(false);
                  menuButtonRef.current?.focus();
                }}
              />
            )}
          </div>
          <div className="px-2 pb-2">
            <label className="relative block">
              <span className="sr-only">Procurar no menu</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="O que você procura?"
                className="min-h-11 w-full rounded-ui border border-border bg-surface pl-9 pr-3"
              />
            </label>
          </div>
          <nav aria-label="Menu principal" className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="flex flex-col gap-1">
              <li>
                <NavLink to="/" end className={linkClass}>
                  <Home className="size-5 shrink-0" aria-hidden />
                  Início
                </NavLink>
              </li>
              {canSell && (
                <li>
                  <NavLink
                    to="/caixa"
                    className="mb-1 flex min-h-11 items-center gap-3 rounded-ui bg-primary px-3 font-semibold text-primary-contrast hover:bg-primary-hover"
                  >
                    <ScanBarcode className="size-5 shrink-0" aria-hidden />
                    Abrir o caixa
                  </NavLink>
                </li>
              )}
            </ul>
            {query ? (
              results.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1" aria-label="Resultados da busca">
                  {results.map(({ group, item }) => (
                    <li key={item.to}>
                      {itemLink(
                        item,
                        <span className="text-xs font-normal opacity-80">{group.label}</span>,
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 px-3 text-sm text-muted" role="status">
                  Nada encontrado para “{query}”. Tente outra palavra ou veja a Ajuda.
                </p>
              )
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {groups.map((group) => {
                  const expanded = openGroups.includes(group.id);
                  const notes = group.items.some((i) => i.to === '/notas-de-entrada')
                    ? unseenNotes
                    : 0;
                  return (
                    <li key={group.id}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? `grupo-${group.id}` : undefined}
                        onClick={() => toggleGroup(group.id)}
                        className={cx(
                          'flex min-h-11 w-full items-center gap-2 rounded-ui px-3 text-left text-sm font-bold uppercase tracking-wide text-muted hover:bg-surface-2',
                          activeGroup === group.id && 'text-text',
                        )}
                      >
                        {group.label}
                        {!expanded && notes > 0 && <CountBadge count={notes} label={notesLabel} />}
                        <ChevronDown
                          className={cx(
                            'size-4 shrink-0 transition-transform',
                            !(notes > 0 && !expanded) && 'ml-auto',
                            expanded && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </button>
                      {/* Grupo fechado não monta os links: o contador fica só no grupo. */}
                      {expanded && (
                        <ul id={`grupo-${group.id}`} className="mb-1 flex flex-col gap-1">
                          {group.items.map((item) => (
                            <li key={item.to}>{itemLink(item)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <ul className="mt-2 border-t border-border pt-2">
              <li>
                <NavLink to="/ajuda" className={linkClass}>
                  <LifeBuoy className="size-5 shrink-0" aria-hidden />
                  Ajuda
                </NavLink>
              </li>
            </ul>
          </nav>
          <div className="border-t border-border p-4">
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
        <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-8">
          {announcements.data && announcements.data.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              {announcements.data.map((a) => (
                <Alert key={a.id} tone={LEVEL_TONE[a.level]} title={a.title}>
                  {a.body}
                </Alert>
              ))}
            </div>
          )}
          <EmailVerificationBanner />
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
