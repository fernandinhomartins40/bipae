import type { Platform } from '@bipae/platform';
import { Alert, Button, Card, cx, Logo, TextField } from '@bipae/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  Landmark,
  LogOut,
  Megaphone,
  ScrollText,
  Server,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { ApiClient, ApiError } from '../api-client';
import {
  AnnouncementsPage,
  AuditPage,
  DashboardPage,
  PeoplePage,
  PlansPage,
  SystemPage,
  TeamPage,
  TenantDetailPage,
  TenantsPage,
} from './admin-pages';
import { FiscalCoveragePage } from './coverage-page';

export interface AdminMe {
  user: { id: string; name: string; email: string };
  role: 'owner' | 'support' | 'viewer';
  permissions: string[];
  totpEnabled: boolean;
  mfaRequired: boolean;
}

interface AdminContextValue {
  api: ApiClient;
  me: AdminMe;
  can: (permission: string) => boolean;
  /** Where the client app lives, to open support sessions ("/app" in production). */
  appBase: string;
}

const AdminCtx = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const value = useContext(AdminCtx);
  if (!value) throw new Error('useAdmin fora do painel');
  return value;
}

/**
 * Bipaê staff panel (super admin), at /app/admin. Its own session (separate from any client
 * login in the same browser) and mandatory 2FA. See docs/saas/plano.md.
 */
export function AdminApp({
  platform,
  apiUrl,
  appBase,
}: {
  platform: Platform;
  apiUrl: string;
  appBase: string;
}) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useMemo(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
    [],
  );
  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiUrl,
        clientKind: platform.kind,
        clientVersion: platform.version,
        preferences: platform.preferences,
        authBase: '/admin/auth',
        refreshKey: 'bipae.adminRefreshToken',
        onSessionEnd: () => setMe(null),
      }),
    [apiUrl, platform],
  );

  useEffect(() => {
    api
      .restore<AdminMe>()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-label="Carregando"
      >
        <Logo className="animate-pulse text-3xl" />
      </div>
    );
  }
  if (!me) return <AdminLogin api={api} onLogin={setMe} />;
  if (me.mfaRequired && !me.totpEnabled) return <TotpSetup api={api} me={me} onDone={setMe} />;

  const value: AdminContextValue = { api, me, can: (p) => me.permissions.includes(p), appBase };
  return (
    <QueryClientProvider client={queryClient}>
      <AdminCtx.Provider value={value}>
        <AdminShell
          onLogout={async () => {
            await api.logout();
            queryClient.clear();
            setMe(null);
          }}
        >
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="clientes" element={<TenantsPage />} />
            <Route path="clientes/:id" element={<TenantDetailPage />} />
            <Route path="pessoas" element={<PeoplePage />} />
            <Route path="planos" element={<PlansPage />} />
            <Route path="avisos" element={<AnnouncementsPage />} />
            <Route path="equipe" element={<TeamPage />} />
            <Route path="auditoria" element={<AuditPage />} />
            <Route path="sistema" element={<SystemPage />} />
            <Route path="cobertura-fiscal" element={<FiscalCoveragePage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </AdminShell>
      </AdminCtx.Provider>
    </QueryClientProvider>
  );
}

const NAV = [
  { to: '/admin', label: 'Visão geral', icon: BarChart3, end: true },
  { to: '/admin/clientes', label: 'Clientes', icon: Building2 },
  { to: '/admin/pessoas', label: 'Pessoas', icon: Users },
  { to: '/admin/planos', label: 'Planos', icon: Tags },
  { to: '/admin/avisos', label: 'Avisos', icon: Megaphone },
  { to: '/admin/equipe', label: 'Equipe Bipaê', icon: ShieldCheck },
  { to: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
  { to: '/admin/cobertura-fiscal', label: 'Cobertura fiscal', icon: Landmark },
  { to: '/admin/sistema', label: 'Sistema', icon: Server },
];

const ROLE_LABEL = { owner: 'Administrador', support: 'Suporte', viewer: 'Consulta' };

function AdminShell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { me } = useAdmin();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-text text-bg md:w-64 md:border-b-0">
        <div className="flex items-center justify-between p-4">
          <Logo className="text-xl text-bg" inverted />
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-contrast">
            Admin
          </span>
        </div>
        <nav
          aria-label="Painel da plataforma"
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                cx(
                  'flex min-h-11 shrink-0 items-center gap-3 rounded-ui px-3 font-medium',
                  isActive ? 'bg-primary text-primary-contrast' : 'opacity-85 hover:bg-white/10',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/15 p-4">
          <p className="truncate font-semibold">{me.user.name}</p>
          <p className="truncate text-sm opacity-75">
            {ROLE_LABEL[me.role]} · {me.user.email}
          </p>
          <button
            type="button"
            className="mt-2 flex min-h-11 items-center gap-2 rounded-ui px-2 font-medium hover:bg-white/10"
            onClick={onLogout}
          >
            <LogOut className="size-5" aria-hidden /> Sair do painel
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

function AdminLogin({ api, onLogin }: { api: ApiClient; onLogin: (me: AdminMe) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.loginAs<AdminMe>({ email, password, ...(needsTotp && { totp }) }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedsTotp(true);
        setError(null);
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-text p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-3">
          <Logo className="text-2xl" />
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-contrast">
            Admin
          </span>
        </div>
        <h1 className="text-2xl font-bold">Painel da plataforma</h1>
        <p className="mb-5 mt-1 text-muted">
          Acesso restrito à equipe Bipaê. Tudo aqui fica registrado.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <Alert>{error}</Alert>}
          {!needsTotp ? (
            <>
              <TextField
                label="E-mail"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <TextField
                label="Senha"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          ) : (
            <TextField
              label="Código do aplicativo autenticador"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              hint="Abra o Google Authenticator (ou similar) e digite os 6 dígitos do Bipaê Admin."
              autoFocus
            />
          )}
          <Button type="submit" size="lg" loading={busy}>
            {needsTotp ? 'Confirmar código' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function TotpSetup({
  api,
  me,
  onDone,
}: {
  api: ApiClient;
  me: AdminMe;
  onDone: (me: AdminMe) => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .post<{ secret: string; uri: string }>('/admin/auth/totp/setup')
      .then(async (s) =>
        setSetup({ ...s, qr: await QRCode.toDataURL(s.uri, { margin: 1, width: 220 }) }),
      )
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        me: AdminMe;
      }>('/admin/auth/totp/enable', { code });
      onDone(await api.adopt(result));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-text p-4">
      <Card className="w-full max-w-lg">
        <h1 className="text-2xl font-bold">Ative a verificação em duas etapas</h1>
        <p className="mt-1 text-muted">
          Olá, {me.user.name.split(' ')[0]}! O painel acessa os dados de todos os clientes, então
          pedimos um código do celular além da senha.
        </p>
        <ol className="my-4 list-inside list-decimal space-y-1">
          <li>Instale o Google Authenticator, Microsoft Authenticator ou similar.</li>
          <li>Leia o código QR abaixo com o aplicativo.</li>
          <li>Digite o código de 6 dígitos que aparecer.</li>
        </ol>
        {error && <Alert>{error}</Alert>}
        {setup && (
          <div className="my-4 flex flex-col items-center gap-2">
            <img
              src={setup.qr}
              alt="Código QR para o aplicativo autenticador"
              width={220}
              height={220}
            />
            <p className="text-sm text-muted">
              Sem câmera? Digite a chave:{' '}
              <code className="font-mono font-semibold text-text" data-testid="totp-secret">
                {setup.secret}
              </code>
            </p>
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField
            label="Código de 6 dígitos"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button type="submit">Ativar e entrar no painel</Button>
        </form>
      </Card>
    </main>
  );
}
