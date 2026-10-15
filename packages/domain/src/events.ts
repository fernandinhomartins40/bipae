import { z } from 'zod';
import { PAYMENT_METHODS } from './payment-methods';
import type { PromotionRule } from './contracts';

export { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from './payment-methods';

/**
 * Events produced by terminals (ADR-0004). Immutable facts with an id generated on the device
 * (UUIDv7), applied by the server exactly once. Validated on both sides with these schemas.
 * Quantities are integer thousandths (`quantityMilli`), money is integer cents.
 */

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const iso = z.string().datetime({ offset: true });

/**
 * Resumo dos impostos de um item, calculado pelo caixa no fechamento da venda (F3-06). Valor nulo
 * quer dizer "sem valor destacado": o tributo não se aplica ao regime ou não pôde ser calculado,
 * e nesse caso o motivo vem em `pending`. É o mesmo formato de `SaleItemTaxSummary` do motor.
 */
const taxCents = cents.nullable();
export const saleItemTaxesSchema = z.object({
  crt: z.number().int().min(1).max(4).nullable(),
  cfop: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  icmsCents: taxCents,
  icmsStCents: taxCents,
  fcpCents: taxCents,
  pisCents: taxCents,
  cofinsCents: taxCents,
  ibsCents: taxCents,
  cbsCents: taxCents,
  complete: z.boolean(),
  pending: z.array(z.string().max(400)).max(10),
});
export type SaleItemTaxes = z.infer<typeof saleItemTaxesSchema>;

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
  /** Ausente em vendas de caixas antigos e de empresas sem UF e regime configurados. */
  taxes: saleItemTaxesSchema.optional(),
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
    /** Promoções aplicadas (F5-02); o desconto de cada uma já está nos itens. */
    promotions: z
      .array(z.object({ promotionId: uuid, name: z.string().max(80), discountCents: cents }))
      .max(50)
      .optional(),
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

/** Troca de operador no mesmo caixa (F2-03): a sessão continua; o evento já vem no nome de quem entra. */
export const operatorChangedEvent = z.object({
  ...base,
  type: z.literal('cash_session.operator_changed'),
  payload: z.object({ sessionId: uuid, fromOperatorId: uuid, toOperatorId: uuid }),
});

export const terminalEvent = z.discriminatedUnion('type', [
  saleCompletedEvent,
  saleCancelledEvent,
  saleReturnedEvent,
  cashSessionOpenedEvent,
  cashMovementEvent,
  cashSessionClosedEvent,
  operatorChangedEvent,
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
    /** Modelo desta variação (F1-04); null para produtos comuns. */
    parentId: string | null;
    barcodes: string[];
    updatedAt: string;
  }[];
  hasMore: boolean;
  /** Só vem quando os preços mudaram desde a `pricingVersion` que o caixa enviou (F1-03). */
  pricing?: PricingSnapshot;
  /** Só vem quando os dados fiscais mudaram desde a `fiscalVersion` que o caixa enviou (F3-06). */
  fiscal?: FiscalSnapshot;
}

/**
 * O que o caixa sem internet precisa para calcular os impostos de uma venda: a UF e o regime da
 * empresa do caixa e os perfis fiscais dos produtos. Vai inteiro, como o retrato de preços.
 */
export interface FiscalSnapshot {
  version: string;
  company: { uf: string | null; taxRegime: string | null };
  profiles: {
    id: string;
    cfopInterna: string;
    cfopInterestadual: string;
    csosn: string | null;
    cstIcms: string | null;
    cstPisCofins: string | null;
    cClassTrib: string | null;
  }[];
  /** Regras de ICMS próprias da empresa do caixa (F3-06.e), no formato do motor fiscal. */
  icmsRules?: {
    id: string;
    name: string;
    ncm: string[];
    validity: { start: string; end?: string };
    effect: {
      rate?: string;
      baseReduction?: string;
      fcpRate?: string;
      st?: { mva: string; rate: string; baseReduction?: string };
    };
    source: string;
  }[];
}

/**
 * Tudo o que o caixa sem internet precisa para dar preço aos itens: a tabela padrão da loja,
 * os itens das tabelas e quais clientes (por CPF/CNPJ) têm tabela própria. Vai inteiro, não
 * aos pedaços: é pequeno, e trocar tudo de uma vez evita preço velho.
 */
export interface PricingSnapshot {
  version: string;
  storePriceTableId: string | null;
  tables: { id: string; name: string; items: { productId: string; priceCents: number }[] }[];
  customers: { taxId: string; priceTableId: string }[];
  /**
   * Crediário (F2-02): limite e saldo devedor de cada cliente com crediário, no momento do
   * retrato. O caixa soma as vendas no crediário que ainda não subiram.
   */
  credit?: {
    taxId: string;
    limitCents: number;
    balanceCents: number;
    /** Parcela vencida há mais do que a tolerância (F4-09): sem nova compra no crediário. */
    blocked?: boolean;
  }[];
  /** Promoções ativas (F5-02), no formato do motor @bipae/promotions. */
  promotions?: {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string | null;
    rule: PromotionRule;
  }[];
}
