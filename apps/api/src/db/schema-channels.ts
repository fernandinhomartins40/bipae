import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BoletoProvider,
  BoletoStatus,
  ChannelOrderStatus,
  ChannelProvider,
} from '@bipae/domain';

/**
 * Espelho tipado de migrations/*.sql dos canais de pedido (F6-05, F6-06) e dos boletos (F4-15).
 * Fica em arquivo próprio; o SQL é a fonte da verdade.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });

export interface ChannelOrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  notes?: string;
  productId: string | null;
}

export const channelIntegrations = pgTable('channel_integrations', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').$type<ChannelProvider>().notNull(),
  name: text('name').notNull(),
  storeId: uuid('store_id').notNull(),
  merchantId: text('merchant_id'),
  /** JSON { clientId, clientSecret } selado. */
  credentialsSealed: text('credentials_sealed'),
  /** Segredo que assina os pedidos do conector genérico, selado. */
  inboundSecretSealed: text('inbound_secret_sealed'),
  /** Identificador público do endereço de entrada (não é segredo, só localiza). */
  inboundKey: text('inbound_key'),
  autoAccept: boolean('auto_accept').notNull().default(false),
  settlementDays: integer('settlement_days').notNull().default(30),
  commissionBps: integer('commission_bps').notNull().default(0),
  active: boolean('active').notNull().default(true),
  lastPollAt: ts('last_poll_at'),
  lastError: text('last_error'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const channelOrders = pgTable('channel_orders', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  externalId: text('external_id').notNull(),
  displayId: text('display_id').notNull(),
  status: text('status').$type<ChannelOrderStatus>().notNull(),
  type: text('type').$type<'delivery' | 'takeout'>().notNull().default('delivery'),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone'),
  address: text('address'),
  items: jsonb('items').$type<ChannelOrderItem[]>().notNull(),
  subtotalCents: money('subtotal_cents').notNull(),
  deliveryFeeCents: money('delivery_fee_cents').notNull().default(0),
  discountCents: money('discount_cents').notNull().default(0),
  totalCents: money('total_cents').notNull(),
  prepaid: boolean('prepaid').notNull().default(false),
  paymentMethod: text('payment_method').notNull(),
  notes: text('notes'),
  tabOrderId: uuid('tab_order_id'),
  financialEntryId: uuid('financial_entry_id'),
  cancelReason: text('cancel_reason'),
  placedAt: ts('placed_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Cada evento do canal, uma vez só (idempotência pelo id que o canal deu ao evento). */
export const channelEvents = pgTable('channel_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  externalEventId: text('external_event_id').notNull(),
  code: text('code').notNull(),
  orderExternalId: text('order_external_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Ações a mandar ao canal (aceitar, preparar...), com nova tentativa; cada uma sai uma vez. */
export const channelActions = pgTable('channel_actions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  orderId: uuid('order_id').notNull(),
  action: text('action').notNull(),
  reason: text('reason'),
  status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const channelProductLinks = pgTable('channel_product_links', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  integrationId: uuid('integration_id').notNull(),
  sku: text('sku').notNull(),
  productId: uuid('product_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const boletoCharges = pgTable('boleto_charges', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  provider: text('provider').$type<BoletoProvider>().notNull(),
  status: text('status').$type<BoletoStatus>().notNull().default('pending'),
  externalId: text('external_id'),
  payerName: text('payer_name').notNull(),
  payerTaxId: text('payer_tax_id').notNull(),
  amountCents: money('amount_cents').notNull(),
  paidCents: money('paid_cents'),
  dueDate: text('due_date').notNull(),
  description: text('description').notNull(),
  digitableLine: text('digitable_line'),
  barcode: text('barcode'),
  pdfUrl: text('pdf_url'),
  financialEntryId: uuid('financial_entry_id'),
  failure: text('failure'),
  paidAt: ts('paid_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
