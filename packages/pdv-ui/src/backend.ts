import type { CatalogProduct, ProductCatalog, ProductPack } from '@bipae/domain';
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
  /** Último número de venda que o servidor já tem deste caixa (F3-12); caixas antigos não mandam. */
  lastTerminalSeq?: number;
}

export type AuthorizablePermission =
  'pos.discount.above_limit' | 'pos.sale.cancel' | 'pos.cash.withdrawal';

/** Produto cadastrado pelo caixa (MF-07): o mínimo para vender, com o que veio do catálogo. */
export interface QuickProductInput {
  name: string;
  barcodes: string[];
  unit: string;
  priceCents: number;
  isWeighable: boolean;
  ncm: string | null;
  cest: string | null;
  catalog: ProductCatalog | null;
  packs: ProductPack[];
}

export interface PosBackend extends SyncTransport {
  listTerminals(): Promise<PosTerminal[]>;
  createTerminal(input: {
    storeId: string;
    name: string;
    platform: 'web' | 'desktop';
  }): Promise<PosTerminal>;
  listStores(): Promise<{ id: string; name: string }[]>;
  terminalContext(terminalId: string): Promise<TerminalContext>;
  authorize(
    email: string,
    password: string,
    permission: AuthorizablePermission,
  ): Promise<{ userId: string; name: string }>;
  /** Consulta rápida ao catálogo (tempo limite de 1,5 s). Ausente: o caixa não oferece o cadastro. */
  catalogLookup?(gtin: string): Promise<CatalogProduct>;
  /** Cadastra o produto no servidor (precisa de internet e da permissão de cadastro). */
  createProduct?(input: QuickProductInput): Promise<{ id: string }>;
}

export interface PosUser {
  id: string;
  name: string;
  tenantId: string;
  permissions: string[];
}
