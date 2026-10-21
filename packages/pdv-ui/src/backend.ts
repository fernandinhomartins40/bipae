import type {
  CatalogProduct,
  FiscalDocumentStatus,
  ProductCatalog,
  ProductPack,
  PixChargeView,
  CardChargeView,
} from '@bipae/domain';
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
  /** Confere quem entra na troca de operador (F2-03). Precisa de internet. */
  operator?(
    email: string,
    password: string,
  ): Promise<{ userId: string; name: string; permissions: string[] }>;
  /** Consulta rápida ao catálogo (tempo limite de 1,5 s). Ausente: o caixa não oferece o cadastro. */
  catalogLookup?(gtin: string): Promise<CatalogProduct>;
  /** Cadastra o produto no servidor (precisa de internet e da permissão de cadastro). */
  createProduct?(input: QuickProductInput): Promise<{ id: string }>;
  /**
   * NFC-e da venda (F3-14.c): situação e, se autorizada, o XML para o cupom fiscal. Precisa de
   * internet; sem ela, a reimpressão sai com o comprovante simples.
   */
  fiscalDocument?(
    saleId: string,
  ): Promise<{ status: FiscalDocumentStatus; xml: string | null; pendingItems: string[] } | null>;
  /** Pix pela API do banco da loja (F8-09): cria a cobrança e acompanha. Precisa de internet. */
  /** Cartão na maquininha comandada pela internet (F8-10). Precisa de internet. */
  cardCharge?: {
    create(
      storeId: string,
      amountCents: number,
      method: 'credit' | 'debit',
    ): Promise<CardChargeView>;
    get(id: string): Promise<CardChargeView>;
    cancel(id: string): Promise<CardChargeView>;
  };
  pixCharge?: {
    create(storeId: string, amountCents: number): Promise<PixChargeView>;
    get(txid: string): Promise<PixChargeView>;
  };
}

export interface PosUser {
  id: string;
  name: string;
  tenantId: string;
  permissions: string[];
}
