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
import { DevicesPage } from './pages/devices';
import { PosPage } from './pages/pos';
import { AccountPage } from './pages/account';
import { DownloadsPage, PublicDownloadsPage } from './pages/downloads';
import { FiscalProfilesPage } from './pages/fiscal-profiles';
import { IcmsRulesPage } from './pages/icms-rules';
import { InvitePage } from './pages/invites';
import { PriceTablesPage } from './pages/price-tables';
import { CompaniesPage } from './pages/companies';
import { AdminApp } from './admin/admin-app';
import { captureSupportHandoff, endSupportSession, readSupportSession } from './support';
import { SalesPage } from './pages/sales';
import { ProductsPage } from './pages/products';
import { BankPage } from './pages/bank';
import { SettlementsPage } from './pages/settlements';
import { InventoryPage } from './pages/inventory';
import { TransfersPage } from './pages/transfers';
import { ConditionalsPage } from './pages/conditionals';
import { NfePage } from './pages/nfe';
import { IntegrationsPage } from './pages/integrations';
import { CrmPage } from './pages/crm';
import { HelpPage } from './pages/help';
import { IbsCbsPage } from './pages/ibs-cbs';
import { AccountantPage } from './pages/accountant';
import { LossesPage } from './pages/losses';
import { TabsPage } from './pages/tabs';
import { KitchenPage } from './pages/kitchen';
import { WaiterPage } from './pages/waiter';
import { DeliveryPage } from './pages/delivery';
import { InutilizationPage } from './pages/inutilization';
import { LabelsPage } from './pages/labels';
import { PromotionsPage } from './pages/promotions';
import { LotsPage } from './pages/lots';
import { CashFlowPage } from './pages/cash-flow';
import { DelinquencyPage } from './pages/delinquency';
import { DrePage } from './pages/dre';
import { ReportsPage } from './pages/reports';
import { FinancePage } from './pages/finance';
import { PurchaseOrdersPage } from './pages/purchase-orders';
import { PurchasesPage } from './pages/purchases';
import { ConferePage } from './pages/confere';
import { MercadoflowPage } from './pages/mercadoflow';
import { loadDisplayPreferences, SettingsPage } from './pages/settings';
import { Shell } from './pages/shell';

export interface BipaeAppProps {
  platform: Platform;
  apiUrl: string;
  /** Web uses browser history; the desktop shell uses hash routing (no server fallback). */
  router: 'browser' | 'hash';
  /** Path the web app is served under, e.g. "/app" in production (browser routing only). */
  basename?: string;
}

/**
 * The whole Bipaê UI. Both shells (apps/web and apps/desktop) render exactly this
 * component; only the injected Platform differs (ADR-0012).
 */
export function BipaeApp({ platform, apiUrl, router, basename }: BipaeAppProps) {
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
        onSessionEnd: () => {
          endSupportSession();
          setMe(null);
        },
      }),
    [apiUrl, platform],
  );

  useEffect(() => {
    void loadDisplayPreferences((k) => platform.preferences.get(k)).then((prefs) =>
      applyDisplayPreferences(prefs, document.documentElement),
    );
    // A support session opened from the staff panel takes over this tab only.
    if (router === 'browser') captureSupportHandoff(basename ?? '');
    const support = readSupportSession();
    if (support) api.useSupportToken(support.token);
    api
      .restore()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setRestoring(false));
  }, [api, platform, router, basename]);

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
        <Router {...(router === 'browser' && basename && basename !== '/' && { basename })}>
          <Routes>
            <Route path="/download" element={<PublicDownloadsPage />} />
            <Route
              path="/admin/*"
              element={<AdminApp platform={platform} apiUrl={apiUrl} appBase={basename ?? ''} />}
            />
            <Route
              path="/entrar"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route path="/convite/:token" element={<InvitePage />} />
            <Route
              path="/criar-conta"
              element={
                <PublicOnly>
                  <SignupPage />
                </PublicOnly>
              }
            />
            <Route
              path="/caixa"
              element={
                <RequireAuth>
                  <PosPage />
                </RequireAuth>
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
              <Route path="vendas" element={<SalesPage />} />
              <Route path="empresas" element={<CompaniesPage />} />
              <Route path="assinatura" element={<AccountPage />} />
              <Route path="produtos" element={<ProductsPage />} />
              <Route path="compras" element={<PurchasesPage />} />
              <Route path="inventario" element={<InventoryPage />} />
              <Route path="etiquetas" element={<LabelsPage />} />
              <Route path="promocoes" element={<PromotionsPage />} />
              <Route path="lotes" element={<LotsPage />} />
              <Route path="transferencias" element={<TransfersPage />} />
              <Route path="condicional" element={<ConditionalsPage />} />
              <Route path="integracoes" element={<IntegrationsPage />} />
              <Route path="relacionamento" element={<CrmPage />} />
              <Route path="ajuda" element={<HelpPage />} />
              <Route path="ajuda/:slug" element={<HelpPage />} />
              <Route path="pedidos-de-compra" element={<PurchaseOrdersPage />} />
              <Route path="financeiro" element={<FinancePage />} />
              <Route path="fluxo-de-caixa" element={<CashFlowPage />} />
              <Route path="dre" element={<DrePage />} />
              <Route path="apuracao-ibs-cbs" element={<IbsCbsPage />} />
              <Route path="contador" element={<AccountantPage />} />
              <Route path="prevencao-de-perdas" element={<LossesPage />} />
              <Route path="comandas" element={<TabsPage />} />
              <Route path="cozinha" element={<KitchenPage />} />
              <Route path="garcom" element={<WaiterPage />} />
              <Route path="delivery" element={<DeliveryPage />} />
              <Route path="inutilizacao" element={<InutilizationPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="inadimplencia" element={<DelinquencyPage />} />
              <Route path="conciliacao-bancaria" element={<BankPage />} />
              <Route path="recebiveis" element={<SettlementsPage />} />
              <Route path="notas-de-entrada" element={<ConferePage />} />
              <Route path="nfe" element={<NfePage />} />
              <Route path="perfis-fiscais" element={<FiscalProfilesPage />} />
              <Route path="regras-icms" element={<IcmsRulesPage />} />
              <Route path="tabelas-de-preco" element={<PriceTablesPage />} />
              <Route path="clientes" element={<PartiesPage kind="customer" />} />
              <Route path="fornecedores" element={<PartiesPage kind="supplier" />} />
              <Route path="caixas" element={<TerminalsPage />} />
              <Route path="equipe" element={<TeamPage />} />
              <Route path="auditoria" element={<AuditPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="mercadoflow" element={<MercadoflowPage />} />
              <Route path="perifericos" element={<DevicesPage />} />
              <Route path="baixar" element={<DownloadsPage />} />
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
