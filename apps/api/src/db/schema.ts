import {
  bigint,
  boolean,
  char,
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  name: text('name').notNull(),
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
  active: boolean('active').notNull().default(true),
  fiscalProfileId: uuid('fiscal_profile_id'),
  parentId: uuid('parent_id'),
  attributes: jsonb('attributes').$type<Record<string, string>>(),
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
});

export const suppliers = pgTable('suppliers', partyColumns());

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
});

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
    enum: ['sale', 'sale_cancelled', 'return', 'adjustment', 'count'],
  }).notNull(),
  refId: uuid('ref_id'),
  note: text('note'),
  actorId: uuid('actor_id'),
  occurredAt: ts('occurred_at').notNull(),
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
