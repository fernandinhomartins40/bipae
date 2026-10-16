import {
  bigint,
  boolean,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PromotionRule } from '@bipae/domain';

/** Typed mirror of migrations/*.sql. The SQL files are the source of truth (RLS, triggers). */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  status: text('status', { enum: ['active', 'trial', 'suspended', 'cancelled'] })
    .notNull()
    .default('active'),
  planId: text('plan_id').notNull().default('gratis'),
  trialEndsAt: ts('trial_ends_at'),
  statusReason: text('status_reason'),
  statusChangedAt: ts('status_changed_at'),
  /** Exclusão definitiva dos dados (P-03); a linha fica anonimizada para a auditoria. */
  purgedAt: ts('purged_at'),
  limitOverrides: jsonb('limit_overrides').$type<Partial<PlanLimits>>(),
  notes: text('notes'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** TOTP seed sealed with SecretBox (F1-01); null until the user starts the setup. */
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  systemKey: text('system_key'),
  name: text('name').notNull(),
  permissions: text('permissions').array().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    storeIds: uuid('store_ids').array(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  familyId: uuid('family_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  replacedBy: uuid('replaced_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  taxId: text('tax_id'),
  uf: char('uf', { length: 2 }),
  /** Regime tributário (F3-06.c): mei, simples, simples-excesso, presumido ou real. */
  taxRegime: text('tax_regime'),
  /** Optante pelo Simples que apura o IBS e a CBS pelo regime regular (F4-13). */
  ibsCbsRegular: boolean('ibs_cbs_regular').notNull().default(false),
  /** Dados do emitente da nota (F3-14.b). */
  ie: text('ie'),
  street: text('street'),
  streetNumber: text('street_number'),
  complement: text('complement'),
  district: text('district'),
  cityCode: char('city_code', { length: 7 }),
  cep: char('cep', { length: 8 }),
  phone: text('phone'),
  /** Código tPag escolhido para o Pix e o vale (dúvida D-029). */
  nfcePaymentCodes: jsonb('nfce_payment_codes')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Regras de ICMS próprias da empresa (F3-06.e), por NCM e vigência. */
export const companyIcmsRules = pgTable('company_icms_rules', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  name: text('name').notNull(),
  ncm: text('ncm').array().notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  effect: jsonb('effect').notNull(),
  source: text('source').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Certificado A1 da empresa (F3-10): .pfx e senha cifrados; o resto é só para exibir. */
export const companyCertificates = pgTable('company_certificates', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  sealedPfx: text('sealed_pfx').notNull(),
  sealedPassword: text('sealed_password').notNull(),
  subject: text('subject').notNull(),
  cnpj: text('cnpj').notNull(),
  serial: text('serial').notNull(),
  fingerprint: text('fingerprint').notNull(),
  notBefore: ts('not_before').notNull(),
  notAfter: ts('not_after').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  name: text('name').notNull(),
  /** Default price table of the store's registers (F1-03). */
  priceTableId: uuid('price_table_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const terminals = pgTable('terminals', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  platform: text('platform', { enum: ['web', 'desktop'] }).notNull(),
  nfceSeries: integer('nfce_series').notNull(),
  status: text('status', { enum: ['active', 'revoked'] })
    .notNull()
    .default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

export const units = pgTable(
  'units',
  {
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    decimals: smallint('decimals').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.code] })],
);

export const fiscalProfiles = pgTable('fiscal_profiles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  data: jsonb('data').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  unit: text('unit').notNull(),
  priceCents: money('price_cents').notNull(),
  costCents: money('cost_cents'),
  ncm: char('ncm', { length: 8 }),
  cest: char('cest', { length: 7 }),
  isWeighable: boolean('is_weighable').notNull().default(false),
  tracksLot: boolean('tracks_lot').notNull().default(false),
  /** Preparado na cozinha: vai para a tela da cozinha quando lançado numa comanda (F5-09). */
  kitchen: boolean('kitchen').notNull().default(false),
  /** Insumo da ficha técnica (F5-11): baixa no estoque com o prato, não aparece no caixa. */
  ingredient: boolean('ingredient').notNull().default(false),
  /** Atacarejo (F5-03): preço de atacado a partir de uma quantidade (em milésimos). */
  wholesalePriceCents: money('wholesale_price_cents'),
  wholesaleMinMilli: bigint('wholesale_min_milli', { mode: 'number' }),
  active: boolean('active').notNull().default(true),
  fiscalProfileId: uuid('fiscal_profile_id'),
  parentId: uuid('parent_id'),
  attributes: jsonb('attributes').$type<Record<string, string>>(),
  /** Marca, fabricante, departamento, categoria e conteúdo (catálogo, MF-02). */
  catalog: jsonb('catalog').$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const productBarcodes = pgTable(
  'product_barcodes',
  {
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    productId: uuid('product_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.code] })],
);

export const productComponents = pgTable(
  'product_components',
  {
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    componentId: uuid('component_id').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 4, mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.componentId] })],
);

export const priceTables = pgTable('price_tables', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const priceTableItems = pgTable(
  'price_table_items',
  {
    tenantId: uuid('tenant_id').notNull(),
    priceTableId: uuid('price_table_id').notNull(),
    productId: uuid('product_id').notNull(),
    priceCents: money('price_cents').notNull(),
  },
  (t) => [primaryKey({ columns: [t.priceTableId, t.productId] })],
);

const partyColumns = () => ({
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  taxId: text('tax_id'),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address'),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  ...partyColumns(),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  marketingConsentAt: ts('marketing_consent_at'),
  /** Price table for this customer, above the store's (F1-03). */
  priceTableId: uuid('price_table_id'),
  /** Limite do crediário (F2-02); nulo = o cliente não compra no crediário. */
  creditLimitCents: money('credit_limit_cents'),
});

/** Extrato do crediário pelo CPF/CNPJ (F2-02): venda soma, o resto vem negativo. */
export const customerCreditEntries = pgTable('customer_credit_entries', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  customerTaxId: text('customer_tax_id').notNull(),
  kind: text('kind', { enum: ['sale', 'cancel', 'return', 'payment'] }).notNull(),
  amountCents: money('amount_cents').notNull(),
  saleId: uuid('sale_id'),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const suppliers = pgTable('suppliers', partyColumns());

/** Convite de equipe por link (F1-06); o segredo do link fica só como hash. */
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  roleId: uuid('role_id').notNull(),
  storeIds: uuid('store_ids').array(),
  email: text('email'),
  tokenHash: text('token_hash').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  acceptedBy: uuid('accepted_by'),
  revokedAt: ts('revoked_at'),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  actorId: uuid('actor_id'),
  authorizedBy: uuid('authorized_by'),
  data: jsonb('data'),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
  createdAt: ts('created_at').notNull(),
});

// ---------------------------------------------------------------- Phase 2: sales and sync

export const syncEvents = pgTable('sync_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  type: text('type').notNull(),
  deviceSeq: bigint('device_seq', { mode: 'number' }).notNull(),
  operatorId: uuid('operator_id').notNull(),
  occurredAt: ts('occurred_at').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  payload: jsonb('payload').notNull(),
});

export const cashSessions = pgTable('cash_sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  operatorId: uuid('operator_id').notNull(),
  openedAt: ts('opened_at').notNull(),
  openingCents: money('opening_cents').notNull(),
  closedAt: ts('closed_at'),
  declared: jsonb('declared'),
  expected: jsonb('expected'),
  differenceCents: money('difference_cents'),
});

export const cashMovements = pgTable('cash_movements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  kind: text('kind', { enum: ['withdrawal', 'supply'] }).notNull(),
  amountCents: money('amount_cents').notNull(),
  reason: text('reason'),
  operatorId: uuid('operator_id').notNull(),
  authorizedBy: uuid('authorized_by'),
  occurredAt: ts('occurred_at').notNull(),
});

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  storeId: uuid('store_id').notNull(),
  terminalSeq: integer('terminal_seq').notNull(),
  sessionId: uuid('session_id').notNull(),
  kind: text('kind', { enum: ['sale', 'return'] }).notNull(),
  status: text('status', { enum: ['completed', 'cancelled'] }).notNull(),
  originalSaleId: uuid('original_sale_id'),
  subtotalCents: money('subtotal_cents').notNull(),
  discountCents: money('discount_cents').notNull(),
  totalCents: money('total_cents').notNull(),
  customerTaxId: text('customer_tax_id'),
  operatorId: uuid('operator_id').notNull(),
  discountAuthorizedBy: uuid('discount_authorized_by'),
  occurredAt: ts('occurred_at').notNull(),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  data: jsonb('data').notNull(),
  /** A conta de impostos do servidor bateu com a do caixa? Nulo quando o caixa não calculou. */
  taxCheck: text('tax_check'),
  /** Venda para entrega (F5-10): bairro, taxa, contato e endereço, como o caixa mandou. */
  delivery: jsonb('delivery').$type<SaleDelivery>(),
  deliveryStatus: text('delivery_status', { enum: ['pending', 'out', 'delivered'] }),
  deliveryUpdatedAt: ts('delivery_updated_at'),
});

export interface SaleDelivery {
  zoneId: string | null;
  zoneName: string;
  feeCents: number;
  name: string;
  phone: string;
  address: {
    street: string;
    number: string;
    complement: string | null;
    district: string;
    cityCode: string | null;
    cityName: string | null;
    uf: string | null;
    cep: string | null;
  };
}

export const saleItems = pgTable(
  'sale_items',
  {
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    line: integer('line').notNull(),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull(),
    unitPriceCents: money('unit_price_cents').notNull(),
    grossCents: money('gross_cents').notNull(),
    discountCents: money('discount_cents').notNull(),
    totalCents: money('total_cents').notNull(),
    /** Resumo dos impostos do item, calculado pelo caixa (F3-06.d3). */
    taxes: jsonb('taxes'),
  },
  (t) => [primaryKey({ columns: [t.saleId, t.line] })],
);

export const salePayments = pgTable(
  'sale_payments',
  {
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    idx: integer('idx').notNull(),
    method: text('method').notNull(),
    amountCents: money('amount_cents').notNull(),
    changeCents: money('change_cents').notNull().default(0),
    nsu: text('nsu'),
    authorizationCode: text('authorization_code'),
    provider: text('provider'),
  },
  (t) => [primaryKey({ columns: [t.saleId, t.idx] })],
);

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  productId: uuid('product_id').notNull(),
  deltaMilli: bigint('delta_milli', { mode: 'number' }).notNull(),
  reason: text('reason', {
    enum: [
      'sale',
      'sale_cancelled',
      'return',
      'adjustment',
      'count',
      'purchase',
      'confere',
      'transfer_out',
      'transfer_in',
    ],
  }).notNull(),
  refId: uuid('ref_id'),
  note: text('note'),
  actorId: uuid('actor_id'),
  occurredAt: ts('occurred_at').notNull(),
});

// ---------------------------------------------------------------- compras (0011)

/** O que entrou de cada item de uma nota de compra (F3-19). */
export interface PurchaseInvoiceItem {
  line: number;
  supplierCode: string;
  description: string;
  productId: string;
  /** Unidades de estoque por unidade da nota. */
  factor: string;
  quantityMilli: number;
  unitCostCents: number;
  created: boolean;
  taxes: unknown;
}

export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  storeId: uuid('store_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  accessKey: char('access_key', { length: 44 }).notNull(),
  number: integer('number').notNull(),
  series: integer('series').notNull(),
  issuedAt: ts('issued_at').notNull(),
  totalCents: money('total_cents').notNull(),
  authorized: boolean('authorized').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  xml: text('xml').notNull(),
  items: jsonb('items').$type<PurchaseInvoiceItem[]>().notNull(),
  importedBy: uuid('imported_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const supplierProductCodes = pgTable(
  'supplier_product_codes',
  {
    tenantId: uuid('tenant_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    supplierCode: text('supplier_code').notNull(),
    productId: uuid('product_id').notNull(),
    factor: numeric('factor', { precision: 14, scale: 4 }).notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.supplierId, t.supplierCode] })],
);

// ---------------------------------------------------------------- MercadoFlow (0012)

export const mercadoflowLinks = pgTable('mercadoflow_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  storeId: uuid('store_id').notNull(),
  marketId: text('market_id'),
  status: text('status', {
    enum: ['PENDENTE', 'ATIVA', 'REVOGADA', 'RECUSADA', 'EXPIRADA'],
  }).notNull(),
  connectCode: text('connect_code'),
  connectUrl: text('connect_url'),
  scopes: text('scopes').array().notNull().default([]),
  createdVia: text('created_via', { enum: ['ACCOUNT', 'CONNECT'] }).notNull(),
  customerActiveSent: boolean('customer_active_sent'),
  connectedAt: ts('connected_at'),
  revokedAt: ts('revoked_at'),
  lastSalesSyncAt: ts('last_sales_sync_at'),
  /** LIMITE_DO_PLANO: vendas da loja em pausa até esta hora (MF-08). */
  salesPausedUntil: ts('sales_paused_until'),
  /** Aplicar sozinho o preço aprovado e o encarte do MercadoFlow (MF-11). */
  autoApplyPrices: boolean('auto_apply_prices').notNull().default(false),
  autoApplyPromotions: boolean('auto_apply_promotions').notNull().default(false),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Preço aprovado e encarte do MercadoFlow esperando o gerente (MF-11). */
export const mercadoflowPendings = pgTable('mercadoflow_pendings', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  marketId: text('market_id').notNull(),
  kind: text('kind', { enum: ['price', 'promotion', 'order'] }).notNull(),
  sourceKey: text('source_key').notNull(),
  status: text('status', { enum: ['pending', 'applied', 'dismissed'] })
    .notNull()
    .default('pending'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  problem: text('problem'),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: ts('resolved_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const mercadoflowOutbox = pgTable('mercadoflow_outbox', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id'),
  kind: text('kind').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'rejected'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  lastError: text('last_error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
});

export const productPacks = pgTable(
  'product_packs',
  {
    tenantId: uuid('tenant_id').notNull(),
    packGtin: text('pack_gtin').notNull(),
    productId: uuid('product_id').notNull(),
    unitsPerPack: integer('units_per_pack').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.packGtin] })],
);

export const mercadoflowWebhookDeliveries = pgTable('mercadoflow_webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  event: text('event').notNull(),
  marketId: text('market_id'),
  payload: jsonb('payload').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  processedAt: ts('processed_at'),
  error: text('error'),
});

export const mercadoflowCatalogCache = pgTable('mercadoflow_catalog_cache', {
  cacheKey: text('cache_key').primaryKey(),
  payload: jsonb('payload').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

// ---------------------------------------------------------------- Confere (0013)

/** O que entrou de um item da conferência. */
export interface ConfereEntryItem {
  item: number;
  productId: string | null;
  quantityMilli: number;
  unitCostCents: number | null;
}

export const confereEntries = pgTable('confere_entries', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  marketId: text('market_id').notNull(),
  documentId: text('document_id').notNull(),
  accessKey: char('access_key', { length: 44 }).notNull(),
  checkId: text('check_id').notNull(),
  supplierId: uuid('supplier_id'),
  status: text('status', { enum: ['applied', 'needs_products'] }).notNull(),
  entry: jsonb('entry').notNull(),
  items: jsonb('items').$type<ConfereEntryItem[]>().notNull().default([]),
  appliedBy: uuid('applied_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  appliedAt: ts('applied_at'),
});

export const confereNotices = pgTable('confere_notices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  documentId: text('document_id').notNull(),
  accessKey: char('access_key', { length: 44 }),
  supplierName: text('supplier_name'),
  invoiceNumber: text('invoice_number'),
  issuedAt: ts('issued_at'),
  totalCents: money('total_cents'),
  itemsCount: integer('items_count'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  seenAt: ts('seen_at'),
});

export const supplierIssues = pgTable('supplier_issues', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  supplierId: uuid('supplier_id'),
  supplierName: text('supplier_name').notNull(),
  accessKey: char('access_key', { length: 44 }).notNull(),
  invoiceNumber: text('invoice_number'),
  item: integer('item').notNull(),
  description: text('description').notNull(),
  kind: text('kind', { enum: ['FALTA', 'SOBRA', 'AVARIA', 'VALIDADE', 'TROCADO'] }).notNull(),
  expectedMilli: bigint('expected_milli', { mode: 'number' }),
  receivedMilli: bigint('received_milli', { mode: 'number' }),
  unitCostCents: money('unit_cost_cents'),
  status: text('status', { enum: ['aberta', 'resolvida'] })
    .notNull()
    .default('aberta'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
});

// ---------------------------------------------------------------- SaaS platform (0003)

export interface PlanLimits {
  companies: number | null;
  stores: number | null;
  terminals: number | null;
  users: number | null;
  products: number | null;
}

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: money('price_cents'),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: text('features').array().notNull(),
  public: boolean('public').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const tenantEvents = pgTable('tenant_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  data: jsonb('data'),
  adminId: uuid('admin_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const platformAdmins = pgTable('platform_admins', {
  userId: uuid('user_id').primaryKey(),
  role: text('role', { enum: ['owner', 'support', 'viewer'] }).notNull(),
  active: boolean('active').notNull().default(true),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const platformAuditLog = pgTable('platform_audit_log', {
  id: uuid('id').primaryKey(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  tenantId: uuid('tenant_id'),
  target: text('target'),
  data: jsonb('data'),
  ip: text('ip'),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  level: text('level', { enum: ['info', 'warning', 'critical'] })
    .notNull()
    .default('info'),
  planIds: text('plan_ids').array(),
  startsAt: ts('starts_at').notNull().defaultNow(),
  endsAt: ts('ends_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Pedidos de compra (F4-01). */
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  supplierId: uuid('supplier_id').notNull(),
  number: integer('number').notNull(),
  status: text('status', { enum: ['draft', 'sent', 'received', 'cancelled'] })
    .notNull()
    .default('draft'),
  expectedAt: date('expected_at', { mode: 'string' }),
  notes: text('notes'),
  totalCents: money('total_cents').notNull().default(0),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
  receivedAt: ts('received_at'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  tenantId: uuid('tenant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  line: integer('line').notNull(),
  productId: uuid('product_id').notNull(),
  quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull(),
  unitCostCents: money('unit_cost_cents').notNull(),
  totalCents: money('total_cents').notNull(),
  /** Quanto chegou na entrada (F4-02); nulo enquanto o pedido não foi recebido. */
  receivedMilli: bigint('received_milli', { mode: 'number' }),
});

/** Contas a pagar e a receber (F4-04): uma linha por parcela. */
export const financialEntries = pgTable('financial_entries', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  kind: text('kind', { enum: ['payable', 'receivable'] }).notNull(),
  status: text('status', { enum: ['open', 'paid', 'cancelled'] })
    .notNull()
    .default('open'),
  description: text('description').notNull(),
  category: text('category'),
  supplierId: uuid('supplier_id'),
  customerId: uuid('customer_id'),
  document: text('document'),
  amountCents: money('amount_cents').notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  groupId: uuid('group_id').notNull(),
  installment: integer('installment').notNull().default(1),
  installments: integer('installments').notNull().default(1),
  paidAt: date('paid_at', { mode: 'string' }),
  paidCents: money('paid_cents'),
  paymentMethod: text('payment_method'),
  cancelReason: text('cancel_reason'),
  notes: text('notes'),
  /** Venda no crediário que gerou a conta (F4-09). */
  saleId: uuid('sale_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Conciliação bancária (F4-07). */
export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  bankCode: text('bank_code'),
  accountNumber: text('account_number').notNull(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bankTransactions = pgTable('bank_transactions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  bankAccountId: uuid('bank_account_id').notNull(),
  fitId: text('fit_id').notNull(),
  postedOn: date('posted_on', { mode: 'string' }).notNull(),
  amountCents: money('amount_cents').notNull(),
  memo: text('memo').notNull().default(''),
  status: text('status', { enum: ['pending', 'matched', 'ignored'] })
    .notNull()
    .default('pending'),
  entryId: uuid('entry_id'),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: ts('resolved_at'),
  importedAt: ts('imported_at').notNull().defaultNow(),
});

/** Taxa e prazo de recebimento por forma de pagamento (F4-08). */
export const settlementRules = pgTable('settlement_rules', {
  tenantId: uuid('tenant_id').notNull(),
  method: text('method', { enum: ['credit', 'debit', 'pix', 'voucher'] }).notNull(),
  feeBp: integer('fee_bp').notNull(),
  days: integer('days').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Inventário pelo celular (F4-11). */
export const inventories = pgTable('inventories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['open', 'closed', 'cancelled'] })
    .notNull()
    .default('open'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedBy: uuid('closed_by'),
  closedAt: ts('closed_at'),
});

export const inventoryCounts = pgTable('inventory_counts', {
  tenantId: uuid('tenant_id').notNull(),
  inventoryId: uuid('inventory_id').notNull(),
  productId: uuid('product_id').notNull(),
  countedMilli: bigint('counted_milli', { mode: 'number' }).notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- transferências (0025)

/** Transferência entre lojas (F4-12). */
export const stockTransfers = pgTable('stock_transfers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  fromStoreId: uuid('from_store_id').notNull(),
  toStoreId: uuid('to_store_id').notNull(),
  status: text('status', { enum: ['in_transit', 'received', 'cancelled'] })
    .notNull()
    .default('in_transit'),
  note: text('note'),
  needsInvoice: boolean('needs_invoice').notNull().default(false),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  receivedBy: uuid('received_by'),
  receivedAt: ts('received_at'),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
});

export const stockTransferItems = pgTable(
  'stock_transfer_items',
  {
    tenantId: uuid('tenant_id').notNull(),
    transferId: uuid('transfer_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull(),
    receivedMilli: bigint('received_milli', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.transferId, t.productId] })],
);

// ---------------------------------------------------------------- promoções (0027)

/** Promoções do caixa (F5-02); a regra fica no formato do motor @bipae/promotions. */
export const promotions = pgTable('promotions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  rule: jsonb('rule').$type<PromotionRule>().notNull(),
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }),
  active: boolean('active').notNull().default(true),
  /** Só nesta loja (encarte do MercadoFlow, MF-11.b); sem loja, vale em todas. */
  storeId: uuid('store_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- lote e validade (0029)

/** Lote de um produto numa loja (F5-04), com validade e saldo. */
export const stockLots = pgTable('stock_lots', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  productId: uuid('product_id').notNull(),
  lotCode: text('lot_code').notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  manufacturedOn: date('manufactured_on', { mode: 'string' }),
  quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const stockLotMoves = pgTable('stock_lot_moves', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  lotId: uuid('lot_id').notNull(),
  deltaMilli: bigint('delta_milli', { mode: 'number' }).notNull(),
  reason: text('reason', {
    enum: ['entry', 'purchase', 'sale', 'sale_cancelled', 'return', 'discard'],
  }).notNull(),
  saleId: uuid('sale_id'),
  refId: uuid('ref_id'),
  actorId: uuid('actor_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- documentos fiscais (0030)

/** NFC-e (e depois NF-e) de cada venda, com a situação na SEFAZ (F3-14.b). */
export const fiscalDocuments = pgTable('fiscal_documents', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  saleId: uuid('sale_id').notNull(),
  companyId: uuid('company_id').notNull(),
  model: char('model', { length: 2 }).notNull().default('65'),
  series: integer('series'),
  number: integer('number'),
  accessKey: char('access_key', { length: 44 }),
  status: text('status', {
    enum: [
      'pending',
      'error',
      'not_configured',
      'authorized',
      'rejected',
      'denied',
      'cancelled',
      'voided',
    ],
  })
    .notNull()
    .default('pending'),
  pendingItems: jsonb('pending_items').$type<string[]>().notNull().default([]),
  cStat: text('c_stat'),
  xMotivo: text('x_motivo'),
  protocol: text('protocol'),
  signedXml: text('signed_xml'),
  nfeProc: text('nfe_proc'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  authorizedAt: ts('authorized_at'),
  /** Emitida em contingência off-line (tpEmis 9, F3-15). */
  contingency: boolean('contingency').notNull().default(false),
  /** Quem assinou: o servidor ou o caixa sem internet. */
  origin: text('origin', { enum: ['server', 'terminal'] })
    .notNull()
    .default('server'),
  /** A venda foi cancelada: a nota precisa ser cancelada ou deixada de emitir (F3-17). */
  cancelRequestedAt: ts('cancel_requested_at'),
  cancelReason: text('cancel_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Eventos da nota enviados à SEFAZ: o cancelamento (F3-17). */
export const fiscalEvents = pgTable('fiscal_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
  type: text('type', { enum: ['110111', '110112'] }).notNull(),
  status: text('status', { enum: ['pending', 'error', 'registered', 'rejected'] })
    .notNull()
    .default('pending'),
  reason: text('reason').notNull(),
  cStat: text('c_stat'),
  xMotivo: text('x_motivo'),
  protocol: text('protocol'),
  signedXml: text('signed_xml'),
  procXml: text('proc_xml'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  registeredAt: ts('registered_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Faixas de números inutilizadas na SEFAZ (F3-17). */
export const fiscalInutilizations = pgTable('fiscal_inutilizations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  model: char('model', { length: 2 }).notNull(),
  series: integer('series').notNull(),
  numberFrom: integer('number_from').notNull(),
  numberTo: integer('number_to').notNull(),
  year: char('year', { length: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['registered', 'rejected'] }).notNull(),
  cStat: text('c_stat').notNull(),
  xMotivo: text('x_motivo').notNull(),
  protocol: text('protocol'),
  procXml: text('proc_xml'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- comandas (0037)

/** Comanda do caixa (F5-07), guardada no servidor para o garçom e a cozinha. */
export const tabs = pgTable('tabs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  label: text('label').notNull(),
  status: text('status', { enum: ['open', 'paid', 'cancelled'] })
    .notNull()
    .default('open'),
  items: jsonb('items')
    .$type<
      {
        line: number;
        productId: string;
        name: string;
        unit: string;
        quantityMilli: number;
        unitPriceCents: number;
      }[]
    >()
    .notNull()
    .default([]),
  totalCents: money('total_cents').notNull().default(0),
  saleId: uuid('sale_id'),
  cancelReason: text('cancel_reason'),
  openedAt: ts('opened_at').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
});

// ---------------------------------------------------------------- cozinha (0038)

/** Pedido da cozinha (F5-09): um item preparado na cozinha lançado numa comanda. */
export const kitchenTickets = pgTable('kitchen_tickets', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  tabId: uuid('tab_id').notNull(),
  tabLabel: text('tab_label').notNull(),
  line: integer('line').notNull(),
  productId: uuid('product_id').notNull(),
  name: text('name').notNull(),
  quantityMilli: bigint('quantity_milli', { mode: 'number' }).notNull(),
  status: text('status', { enum: ['pending', 'ready', 'delivered', 'cancelled'] })
    .notNull()
    .default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
  readyAt: ts('ready_at'),
  deliveredAt: ts('delivered_at'),
});

// ---------------------------------------------------------------- pedidos do garçom (0039)

/** Pedido do garçom (F5-08), à espera de um caixa da loja para entrar na comanda. */
export const tabOrders = pgTable('tab_orders', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  label: text('label').notNull(),
  items: jsonb('items').$type<{ productId: string; quantityMilli: number }[]>().notNull(),
  waiterId: uuid('waiter_id').notNull(),
  waiterName: text('waiter_name').notNull(),
  status: text('status', { enum: ['pending', 'received', 'rejected'] })
    .notNull()
    .default('pending'),
  claimedBy: uuid('claimed_by'),
  claimedAt: ts('claimed_at'),
  tabId: uuid('tab_id'),
  reason: text('reason'),
  receivedAt: ts('received_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- delivery (0040)

/** Bairro atendido pela entrega da loja, com a taxa (F5-10). */
export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  feeCents: money('fee_cents').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
