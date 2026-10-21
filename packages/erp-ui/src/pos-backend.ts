import type {
  CatalogProduct,
  FiscalDocumentView,
  PixChargeView,
  SyncPullResult,
  SyncPushResult,
} from '@bipae/domain';
import type { PosBackend, PosTerminal, TerminalContext } from '@bipae/pdv-ui';
import type { ApiClient } from './api-client';

/** The register's server access, over the same HTTP client as the back office. */
export function createPosBackend(api: ApiClient): PosBackend {
  return {
    push: (terminalId, events) => api.post<SyncPushResult>('/sync/events', { terminalId, events }),
    pull: (cursor, limit, pricingVersion, fiscalVersion) =>
      api.get<SyncPullResult>(
        `/sync/pull?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${encodeURIComponent(pricingVersion)}` : ''
        }${fiscalVersion ? `&fiscalVersion=${encodeURIComponent(fiscalVersion)}` : ''}`,
      ),
    listTerminals: () => api.get<PosTerminal[]>('/pos/terminals'),
    pixCharge: {
      create: (storeId, amountCents) =>
        api.post<PixChargeView>('/payments/pix/charges', { storeId, amountCents }),
      get: (txid) => api.get<PixChargeView>(`/payments/pix/charges/${txid}`),
    },
    createTerminal: (input) => api.post<PosTerminal>('/terminals', input),
    listStores: () => api.get<{ id: string; name: string }[]>('/stores'),
    terminalContext: (id) => api.get<TerminalContext>(`/pos/terminals/${id}/context`),
    operator: (email, password) =>
      api.post<{ userId: string; name: string; permissions: string[] }>('/auth/operator', {
        email,
        password,
      }),
    authorize: (email, password, permission) =>
      api.post<{ userId: string; name: string }>('/auth/authorize', {
        email,
        password,
        permission,
      }),
    // O caixa nunca espera o catálogo: sem resposta em 1,5 s, segue sem ele.
    catalogLookup: (gtin) =>
      Promise.race([
        api.get<CatalogProduct>(`/product-catalog/products/${gtin}?quick=1`),
        new Promise<CatalogProduct>((resolve) =>
          setTimeout(() => resolve({ gtin, found: false, reason: 'SEM_RESPOSTA' }), 1500),
        ),
      ]).catch((): CatalogProduct => ({ gtin, found: false, reason: 'SEM_RESPOSTA' })),
    createProduct: (input) => api.post<{ id: string }>('/products', input),
    fiscalDocument: async (saleId) => {
      const doc = await api.get<FiscalDocumentView | null>(`/sales/${saleId}/fiscal`);
      if (!doc) return null;
      const xml =
        doc.status === 'authorized'
          ? await (await api.download(`/fiscal/documents/${doc.id}/xml`)).text()
          : null;
      return { status: doc.status, xml, pendingItems: doc.pendingItems };
    },
  };
}
