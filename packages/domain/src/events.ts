import { z } from 'zod';
import { PAYMENT_METHODS } from './payment-methods';

export { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from './payment-methods';

/**
 * Events produced by terminals (ADR-0004). Immutable facts with an id generated on the device
 * (UUIDv7), applied by the server exactly once. Validated on both sides with these schemas.
 * Quantities are integer thousandths (`quantityMilli`), money is integer cents.
 */

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const iso = z.string().datetime({ offset: true });

export const saleItemSchema = z.object({
  line: z.number().int().positive(),
  productId: uuid,
  name: z.string().min(1).max(120),
  unit: z.string().min(1).max(6),
  quantityMilli: z.number().int().positive(),
  unitPriceCents: cents,
  grossCents: cents,
  discountCents: cents,
  totalCents: cents,
});
export type SaleItem = z.infer<typeof saleItemSchema>;

export const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountCents: cents,
  /** Change given back (cash only). amountCents is what the sale received net of change. */
  changeCents: cents.default(0),
  nsu: z.string().max(40).nullish(),
  authorizationCode: z.string().max(40).nullish(),
  provider: z.string().max(40).nullish(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

const base = {
  id: uuid,
  occurredAt: iso,
  terminalId: uuid,
  operatorId: uuid,
  /** Monotonic per terminal, for ordering and gap detection. */
  deviceSeq: z.number().int().positive(),
};

export const saleCompletedEvent = z.object({
  ...base,
  type: z.literal('sale.completed'),
  payload: z.object({
    saleId: uuid,
    terminalSeq: z.number().int().positive(),
    sessionId: uuid,
    items: z.array(saleItemSchema).min(1).max(1000),
    subtotalCents: cents,
    discountCents: cents,
    totalCents: cents,
    payments: z.array(salePaymentSchema).min(1).max(20),
    customerTaxId: z
      .string()
      .regex(/^[0-9A-Z]{11,14}$/)
      .nullish(),
    discountAuthorizedBy: uuid.nullish(),
    quoteId: uuid.nullish(),
  }),
});

export const saleCancelledEvent = z.object({
  ...base,
  type: z.literal('sale.cancelled'),
  payload: z.object({
    saleId: uuid,
    reason: z.string().min(3).max(200),
    authorizedBy: uuid.nullish(),
  }),
});

export const saleReturnedEvent = z.object({
  ...base,
  type: z.literal('sale.returned'),
  payload: z.object({
    returnId: uuid,
    originalSaleId: uuid,
    terminalSeq: z.number().int().positive(),
    sessionId: uuid,
    items: z
      .array(
        z.object({
          line: z.number().int().positive(),
          productId: uuid,
          quantityMilli: z.number().int().positive(),
          refundCents: cents,
        }),
      )
      .min(1),
    refundCents: cents,
    refundMethod: z.enum(PAYMENT_METHODS),
    reason: z.string().min(3).max(200),
  }),
});

export const cashSessionOpenedEvent = z.object({
  ...base,
  type: z.literal('cash_session.opened'),
  payload: z.object({ sessionId: uuid, openingCents: cents }),
});

export const cashMovementEvent = z.object({
  ...base,
  type: z.literal('cash_session.movement'),
  payload: z.object({
    sessionId: uuid,
    movementId: uuid,
    kind: z.enum(['withdrawal', 'supply']),
    amountCents: cents.refine((v) => v > 0, 'Valor deve ser maior que zero'),
    reason: z.string().max(200).nullish(),
    authorizedBy: uuid.nullish(),
  }),
});

const byMethod = z.record(z.enum(PAYMENT_METHODS), z.number().int());

export const cashSessionClosedEvent = z.object({
  ...base,
  type: z.literal('cash_session.closed'),
  payload: z.object({
    sessionId: uuid,
    declared: byMethod,
    expected: byMethod,
    differenceCents: z.number().int(),
  }),
});

export const terminalEvent = z.discriminatedUnion('type', [
  saleCompletedEvent,
  saleCancelledEvent,
  saleReturnedEvent,
  cashSessionOpenedEvent,
  cashMovementEvent,
  cashSessionClosedEvent,
]);
export type TerminalEvent = z.infer<typeof terminalEvent>;
export type TerminalEventType = TerminalEvent['type'];

export const syncPushInput = z.object({
  terminalId: uuid,
  events: z.array(z.unknown()).min(1).max(200),
});

export interface SyncPushResult {
  /** Accepted now or previously (idempotent). */
  accepted: string[];
  /** Rejected permanently, with a pt-BR reason; the terminal keeps them for support. */
  rejected: { id: string; reason: string }[];
}

/** Catalog snapshot for terminals (pull). Cursor is an opaque ISO timestamp. */
export interface SyncPullResult {
  cursor: string;
  products: {
    id: string;
    name: string;
    sku: string | null;
    unit: string;
    priceCents: number;
    isWeighable: boolean;
    active: boolean;
    ncm: string | null;
    cest: string | null;
    fiscalProfileId: string | null;
    barcodes: string[];
    updatedAt: string;
  }[];
  hasMore: boolean;
}
