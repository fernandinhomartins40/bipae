import type { SyncTransport } from '@bipae/sync';

/**
 * What the register needs from the server. The host app (erp-ui) implements it with its
 * HTTP client; the register itself never depends on a specific HTTP stack.
 */
export interface PosTerminal {
  id: string;
  name: string;
  platform: 'web' | 'desktop';
  nfceSeries: number;
  storeId: string;
}

export interface TerminalContext {
  terminal: PosTerminal & { status: 'active' | 'revoked' };
  storeName: string;
  businessName: string;
  taxId: string | null;
}

export type AuthorizablePermission =
  | 'pos.discount.above_limit'
  | 'pos.sale.cancel'
  | 'pos.cash.withdrawal';

export interface PosBackend extends SyncTransport {
  listTerminals(): Promise<PosTerminal[]>;
  createTerminal(input: { storeId: string; name: string; platform: 'web' | 'desktop' }): Promise<PosTerminal>;
  listStores(): Promise<{ id: string; name: string }[]>;
  terminalContext(terminalId: string): Promise<TerminalContext>;
  authorize(email: string, password: string, permission: AuthorizablePermission): Promise<{ userId: string; name: string }>;
}

export interface PosUser {
  id: string;
  name: string;
  tenantId: string;
  permissions: string[];
}
