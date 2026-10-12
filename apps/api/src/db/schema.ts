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
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
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
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
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
