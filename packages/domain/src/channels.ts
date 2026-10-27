import { z } from 'zod';

/**
 * Pedidos que chegam de fora (F6-05 iFood e F6-06 marketplaces). O Bipaê fala com cada canal por
 * uma porta (poll de eventos, busca do pedido, ações de status); o pedido vira o formato único
 * abaixo, sempre com dinheiro em centavos inteiros.
 */

export const CHANNEL_PROVIDERS = ['ifood', 'generic', 'simulator'] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export const CHANNEL_PROVIDER_INFO: Record<
  ChannelProvider,
  { name: string; description: string; needsCredentials: boolean }
> = {
  ifood: {
    name: 'iFood',
    description:
      'Pedidos do iFood, buscados a cada poucos segundos. Pede o acesso de integrador do iFood.',
    needsCredentials: true,
  },
  generic: {
    name: 'Marketplace (por conector)',
    description:
      'Qualquer marketplace ou loja virtual: um conector manda o pedido ao Bipaê, assinado com o segredo da integração.',
    needsCredentials: false,
  },
  simulator: {
    name: 'Simulador (teste)',
    description: 'Gera pedidos de mentira para você treinar o fluxo. Não existe em produção.',
    needsCredentials: false,
  },
};

export const CHANNEL_ORDER_STATUSES = [
  'received',
  'needs_mapping',
  'accepted',
  'preparing',
  'ready',
  'dispatched',
  'concluded',
  'cancelled',
  'rejected',
] as const;
export type ChannelOrderStatus = (typeof CHANNEL_ORDER_STATUSES)[number];

export const CHANNEL_ORDER_STATUS_LABELS: Record<ChannelOrderStatus, string> = {
  received: 'Novo',
  needs_mapping: 'Falta ligar produtos',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  dispatched: 'Saiu para entrega',
  concluded: 'Concluído',
  cancelled: 'Cancelado',
  rejected: 'Recusado',
};

/** Ações do lojista sobre o pedido. */
export const CHANNEL_ACTIONS = [
  'accept',
  'start_preparation',
  'ready',
  'dispatch',
  'reject',
] as const;
export type ChannelAction = (typeof CHANNEL_ACTIONS)[number];

export const CHANNEL_ACTION_LABELS: Record<ChannelAction, string> = {
  accept: 'Aceitar',
  start_preparation: 'Começar o preparo',
  ready: 'Pronto',
  dispatch: 'Saiu para entrega',
  reject: 'Recusar',
};

const ACTION_FROM: Record<ChannelAction, readonly ChannelOrderStatus[]> = {
  accept: ['received', 'needs_mapping'],
  start_preparation: ['accepted'],
  ready: ['preparing', 'accepted'],
  dispatch: ['ready', 'preparing'],
  reject: ['received', 'needs_mapping'],
};

const ACTION_TO: Record<ChannelAction, ChannelOrderStatus> = {
  accept: 'accepted',
  start_preparation: 'preparing',
  ready: 'ready',
  dispatch: 'dispatched',
  reject: 'rejected',
};

/** Ações que o pedido aceita agora. Pedido fechado não aceita nenhuma. */
export function availableChannelActions(status: ChannelOrderStatus): ChannelAction[] {
  return CHANNEL_ACTIONS.filter((a) => ACTION_FROM[a].includes(status));
}

export function channelStatusAfter(
  status: ChannelOrderStatus,
  action: ChannelAction,
): ChannelOrderStatus | null {
  return ACTION_FROM[action].includes(status) ? ACTION_TO[action] : null;
}

// ---------- Pedido normalizado ----------

export const normalizedOrderSchema = z
  .object({
    externalId: z.string().trim().min(1).max(80),
    /** Número curto que o cliente e o entregador veem. */
    displayId: z.string().trim().min(1).max(30),
    createdAt: z.string().datetime({ offset: true }),
    type: z.enum(['delivery', 'takeout']).default('delivery'),
    customer: z.object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(30).optional(),
    }),
    address: z.string().trim().max(300).optional(),
    items: z
      .array(
        z.object({
          /** Código do item no canal (id do menu no iFood, SKU no marketplace). */
          sku: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(200),
          quantity: z.number().int().positive().max(10_000),
          unitPriceCents: z.number().int().min(0),
          totalCents: z.number().int().min(0),
          notes: z.string().trim().max(300).optional(),
        }),
      )
      .min(1)
      .max(200),
    subtotalCents: z.number().int().min(0),
    deliveryFeeCents: z.number().int().min(0).default(0),
    discountCents: z.number().int().min(0).default(0),
    totalCents: z.number().int().min(0),
    payment: z.object({
      method: z.enum(['online', 'cash', 'card_on_delivery', 'other']),
      /** Pago pelo canal (o dinheiro chega pelo repasse); falso = o cliente paga na entrega. */
      prepaid: z.boolean(),
      changeForCents: z.number().int().min(0).optional(),
    }),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((o, ctx) => {
    if (o.subtotalCents + o.deliveryFeeCents - o.discountCents !== o.totalCents) {
      ctx.addIssue({
        code: 'custom',
        message: 'O total do pedido não bate com itens, taxa de entrega e desconto.',
        path: ['totalCents'],
      });
    }
    const sum = o.items.reduce((s, i) => s + i.totalCents, 0);
    if (sum !== o.subtotalCents) {
      ctx.addIssue({
        code: 'custom',
        message: 'A soma dos itens não bate com o subtotal.',
        path: ['subtotalCents'],
      });
    }
  });
export type NormalizedOrder = z.output<typeof normalizedOrderSchema>;

/** Evento de status que o canal avisa (já traduzido para o vocabulário do Bipaê). */
export type ChannelEventKind =
  'placed' | 'confirmed' | 'dispatched' | 'concluded' | 'cancelled' | 'other';

// ---------- Cadastro da integração ----------

export const channelIntegrationInput = z.object({
  provider: z.enum(CHANNEL_PROVIDERS),
  name: z.string().trim().min(2, 'Dê um nome à integração').max(60),
  storeId: z.string().uuid('Escolha a loja'),
  /** iFood: o identificador da loja no iFood (merchant id). */
  merchantId: z.string().trim().max(80).optional(),
  clientId: z.string().trim().max(200).optional(),
  clientSecret: z.string().trim().max(500).optional(),
  autoAccept: z.boolean().default(false),
  /** Dias até o repasse do canal cair, para a conta a receber (padrão do contrato, não da lei). */
  settlementDays: z.number().int().min(0).max(120).default(30),
  /** Comissão do canal, em pontos-base (1200 = 12%), descontada da conta a receber. */
  commissionBps: z.number().int().min(0).max(5000).default(0),
  active: z.boolean().default(true),
});
export type ChannelIntegrationInput = z.input<typeof channelIntegrationInput>;

export interface ChannelIntegrationView {
  id: string;
  provider: ChannelProvider;
  name: string;
  storeId: string;
  merchantId: string | null;
  autoAccept: boolean;
  settlementDays: number;
  commissionBps: number;
  active: boolean;
  /** Há credencial guardada (o valor nunca volta). */
  hasCredentials: boolean;
  /** "Falta configurar" com o motivo, ou null quando está pronta. */
  missing: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  openOrders: number;
}

/** Na criação de um conector genérico: o segredo que assina os pedidos, mostrado uma vez. */
export interface ChannelIntegrationCreated extends ChannelIntegrationView {
  inboundSecret: string | null;
  inboundPath: string | null;
}

export interface ChannelOrderView {
  id: string;
  integrationId: string;
  integrationName: string;
  provider: ChannelProvider;
  externalId: string;
  displayId: string;
  status: ChannelOrderStatus;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  type: 'delivery' | 'takeout';
  items: {
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    productId: string | null;
  }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  totalCents: number;
  prepaid: boolean;
  paymentMethod: string;
  notes: string | null;
  tabOrderId: string | null;
  financialEntryId: string | null;
  cancelReason: string | null;
  actions: ChannelAction[];
  /** Ações que o canal ainda não recebeu (fila de envio). */
  pendingActions: number;
  failedActions: number;
  placedAt: string;
}

export const channelLinkInput = z.object({
  sku: z.string().trim().min(1).max(80),
  productId: z.string().uuid('Escolha o produto'),
});
export type ChannelLinkInput = z.input<typeof channelLinkInput>;

export interface ChannelLinkView {
  /** O mesmo código do canal (a tabela da tela pede um id). */
  id: string;
  sku: string;
  productId: string;
  productName: string;
}

export const channelRejectInput = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo').max(200),
});

/** Resultado do envio do cardápio e do estoque ao canal. */
export interface ChannelCatalogSyncResult {
  sent: number;
  skipped: number;
  /** Motivo quando o canal ainda não aceita o envio ("chega em breve"). */
  unavailable: string | null;
}

// ---------- Boletos via PSP (F4-15) ----------

export const BOLETO_STATUSES = [
  'pending',
  'registered',
  'paid',
  'overdue',
  'canceled',
  'failed',
] as const;
export type BoletoStatus = (typeof BOLETO_STATUSES)[number];

export const BOLETO_STATUS_LABELS: Record<BoletoStatus, string> = {
  pending: 'Registrando',
  registered: 'A receber',
  paid: 'Pago',
  overdue: 'Vencido',
  canceled: 'Cancelado',
  failed: 'Não registrou',
};

export const BOLETO_PROVIDERS = ['asaas', 'simulator'] as const;
export type BoletoProvider = (typeof BOLETO_PROVIDERS)[number];

export const boletoInput = z.object({
  /** ID gerado no aparelho: o mesmo pedido mandado de novo devolve o mesmo boleto. */
  id: z.string().uuid().optional(),
  payerName: z.string().trim().min(2, 'Informe o nome do pagador').max(120),
  payerTaxId: z.string().trim().min(11, 'Informe o CPF ou CNPJ').max(18),
  amountCents: z.number().int().min(500, 'O boleto precisa de pelo menos R$ 5,00').max(100_000_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de vencimento inválida'),
  description: z.string().trim().min(3, 'Descreva a cobrança').max(200),
  /** Conta a receber do Bipaê que este boleto cobra; ao pagar, ela é baixada. */
  financialEntryId: z.string().uuid().optional(),
});
export type BoletoInput = z.input<typeof boletoInput>;

export interface BoletoView {
  id: string;
  provider: BoletoProvider;
  status: BoletoStatus;
  payerName: string;
  payerTaxId: string;
  amountCents: number;
  paidCents: number | null;
  dueDate: string;
  description: string;
  digitableLine: string | null;
  barcode: string | null;
  pdfUrl: string | null;
  financialEntryId: string | null;
  failure: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ---- linha digitável (FEBRABAN) ----

/** Módulo 10 de um campo da linha digitável (pesos 2, 1, 2, 1... da direita para a esquerda). */
export function boletoMod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight;
    sum += p > 9 ? p - 9 : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/** Confere os três dígitos verificadores de campo e o tamanho de uma linha digitável bancária. */
export function isValidBoletoLine(line: string): boolean {
  const d = line.replace(/\D/g, '');
  if (d.length !== 47) return false;
  const fields: [number, number][] = [
    [0, 9],
    [10, 20],
    [21, 31],
  ];
  return fields.every(([start, end]) => boletoMod10(d.slice(start, end)) === Number(d[end]));
}

/** Fator de vencimento: dias desde 07/10/1997, recomeçando em 1000 depois de 9999 (22/02/2025). */
export function boletoDueFactor(isoDate: string): number {
  const [y, m, day] = isoDate.split('-').map(Number) as [number, number, number];
  const days = Math.round((Date.UTC(y, m - 1, day) - Date.UTC(1997, 9, 7)) / 86_400_000);
  let factor = days;
  while (factor > 9999) factor -= 9000;
  return factor;
}
