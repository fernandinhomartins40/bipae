import type { Me } from '@bipae/domain';
import type { Platform } from '@bipae/platform';
import { applyDisplayPreferences, Logo } from '@bipae/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ApiClient } from './api-client';
import { AppContextProvider, useApp } from './context';
import { AuditPage, TeamPage, TerminalsPage } from './pages/admin';
import { LoginPage, SignupPage } from './pages/auth';
import { HomePage } from './pages/home';
import { PartiesPage } from './pages/parties';
import { ProductsPage } from './pages/products';
import { loadDisplayPreferences, SettingsPage } from './pages/settings';
import { Shell } from './pages/shell';

export interface BipaeAppProps {
  platform: Platform;
  apiUrl: string;
  /** Web uses browser history; the desktop shell uses hash routing (no server fallback). */
  router: 'browser' | 'hash';
}

/**
 * The whole Bipaê UI. Both shells (apps/web and apps/desktop) render exactly this
 * component; only the injected Platform differs (ADR-0012).
 */
export function BipaeApp({ platform, apiUrl, router }: BipaeAppProps) {
  const [me, setMe] = useState<Me | null>(null);
  const [restoring, setRestoring] = useState(true);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
      }),
    [],
  );
  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiUrl,
        clientKind: platform.kind,
        clientVersion: platform.version,
        preferences: platform.preferences,
        onSessionEnd: () => setMe(null),
      }),
    [apiUrl, platform],
  );

  useEffect(() => {
    void loadDisplayPreferences((k) => platform.preferences.get(k)).then((prefs) =>
      applyDisplayPreferences(prefs, document.documentElement),
    );
    api
      .restore()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setRestoring(false));
  }, [api, platform]);

  useEffect(() => {
    if (!me) queryClient.clear();
  }, [me, queryClient]);

  const Router = router === 'hash' ? HashRouter : BrowserRouter;

  if (restoring) {
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

  return (
    <QueryClientProvider client={queryClient}>
      <AppContextProvider value={{ platform, api, me, setMe }}>
        <Router>
          <Routes>
            <Route
              path="/entrar"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route
              path="/criar-conta"
              element={
                <PublicOnly>
                  <SignupPage />
                </PublicOnly>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="produtos" element={<ProductsPage />} />
              <Route path="clientes" element={<PartiesPage kind="customer" />} />
              <Route path="fornecedores" element={<PartiesPage kind="supplier" />} />
              <Route path="caixas" element={<TerminalsPage />} />
              <Route path="equipe" element={<TeamPage />} />
              <Route path="auditoria" element={<AuditPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AppContextProvider>
    </QueryClientProvider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me } = useApp();
  const location = useLocation();
  if (!me) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return children;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me } = useApp();
  if (me) return <Navigate to="/" replace />;
  return children;
}
