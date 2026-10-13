import type { SyncPullResult, SyncPushResult } from '@bipae/domain';
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
    createTerminal: (input) => api.post<PosTerminal>('/terminals', input),
    listStores: () => api.get<{ id: string; name: string }[]>('/stores'),
    terminalContext: (id) => api.get<TerminalContext>(`/pos/terminals/${id}/context`),
    authorize: (email, password, permission) =>
      api.post<{ userId: string; name: string }>('/auth/authorize', {
        email,
        password,
        permission,
      }),
  };
}
