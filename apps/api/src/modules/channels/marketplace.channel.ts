import type { ChannelAction, ChannelProvider, NormalizedOrder } from '@bipae/domain';
import {
  ChannelNotReadyError,
  ChannelRejectedError,
  reaisToCents,
  type AvailabilityItem,
  type ChannelEvent,
  type OrderChannel,
} from './channel.port';

/**
 * Marketplaces (Mercado Livre, Shopee e Amazon) por porta (F6-06.b). Em 27/10/2026 as
 * documentações oficiais não puderam ser lidas (o portal do Mercado Livre devolveu HTTP 403 à
 * leitura automática; os outros dois não foram alcançados), então NENHUM endereço, caminho ou
 * formato de corpo foi suposto: o adaptador só diz, com clareza, o que falta. A base da API é
 * configurável por integração (outboundUrl) e o mapeamento do pedido é configurável
 * (mapMarketplaceOrder). Quando a API oficial for confirmada, entra aqui o código que fala com
 * ela. Pendências em docs/canais-e-boletos.md.
 */
export type MarketplaceProvider = Extract<ChannelProvider, 'mercadolivre' | 'shopee' | 'amazon'>;

export const MARKETPLACE_PROVIDERS: readonly MarketplaceProvider[] = [
  'mercadolivre',
  'shopee',
  'amazon',
];

export function isMarketplace(provider: string): provider is MarketplaceProvider {
  return (MARKETPLACE_PROVIDERS as readonly string[]).includes(provider);
}

const NAMES: Record<MarketplaceProvider, string> = {
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  amazon: 'Amazon',
};

/** O que falta para o marketplace rodar, na ordem em que o lojista resolve. */
export function marketplaceMissing(
  provider: MarketplaceProvider,
  row: { outboundUrl: string | null; hasCredentials: boolean },
): string {
  const name = NAMES[provider];
  if (!row.outboundUrl) return `Falta o endereço da API do ${name} (configure em Integrações).`;
  if (!row.hasCredentials)
    return `Falta o acesso de integrador do ${name} (clientId e clientSecret).`;
  return `O adaptador do ${name} chega em breve: a API oficial ainda não foi confirmada na documentação.`;
}

export class MarketplaceChannel implements OrderChannel {
  readonly polling = false;
  constructor(private readonly reason: string) {}
  pollEvents(): Promise<ChannelEvent[]> {
    return Promise.resolve([]);
  }
  acknowledge(): Promise<void> {
    return Promise.resolve();
  }
  fetchOrder(): Promise<NormalizedOrder> {
    return Promise.reject(new ChannelNotReadyError(this.reason));
  }
  act(_orderId: string, _action: ChannelAction): Promise<void> {
    return Promise.reject(new ChannelNotReadyError(this.reason));
  }
  pushAvailability(_items: AvailabilityItem[]): Promise<void> {
    return Promise.reject(new ChannelNotReadyError(this.reason));
  }
}

// ---------------------------------------------------------------------------- mapeamento

/** Caminhos (com ponto, ex. "buyer.name") de cada campo no JSON do marketplace. */
export interface OrderMapping {
  externalId: string;
  displayId?: string;
  createdAt: string;
  customerName: string;
  customerPhone?: string;
  address?: string;
  /** Lista de itens do pedido. */
  items: string;
  itemSku: string;
  itemName: string;
  itemQuantity: string;
  itemUnitPrice: string;
  total: string;
  shipping?: string;
  discount?: string;
  /** Campo booleano "pago pelo canal"; ausente = pago (marketplace costuma receber e repassar). */
  prepaid?: string;
  /** Valores em reais (decimal, padrão) ou já em centavos inteiros. */
  priceUnit?: 'reais' | 'cents';
}

function at(raw: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  let cur: unknown = raw;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** Valor monetário do JSON para centavos inteiros; texto com vírgula decimal também vale. */
function toCents(value: unknown, unit: 'reais' | 'cents'): number {
  if (value === undefined || value === null || value === '') return 0;
  if (unit === 'cents') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new ChannelRejectedError('Valor inválido no pedido.');
    return n;
  }
  return reaisToCents(typeof value === 'string' ? value.replace(',', '.') : value);
}

/** Traduz o pedido do marketplace para o formato único, pelo mapeamento configurado. */
export function mapMarketplaceOrder(raw: unknown, map: OrderMapping): NormalizedOrder {
  const unit = map.priceUnit ?? 'reais';
  const list = at(raw, map.items);
  if (!Array.isArray(list) || list.length === 0) {
    throw new ChannelRejectedError('O pedido do marketplace veio sem itens.');
  }
  const externalId = text(at(raw, map.externalId));
  if (!externalId)
    throw new ChannelRejectedError('O pedido do marketplace veio sem identificador.');
  const items = list.map((item) => {
    const quantity = Math.max(1, Math.round(Number(at(item, map.itemQuantity) ?? 1)));
    const unitPriceCents = toCents(at(item, map.itemUnitPrice), unit);
    return {
      sku: text(at(item, map.itemSku)),
      name: text(at(item, map.itemName)) || 'Item',
      quantity,
      unitPriceCents,
      totalCents: unitPriceCents * quantity,
    };
  });
  if (items.some((i) => !i.sku)) {
    throw new ChannelRejectedError('Um item do pedido veio sem código (SKU).');
  }
  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  const deliveryFeeCents = toCents(at(raw, map.shipping), unit);
  const discountCents = toCents(at(raw, map.discount), unit);
  const phone = text(at(raw, map.customerPhone));
  const address = text(at(raw, map.address));
  const prepaidRaw = at(raw, map.prepaid);
  const prepaid = prepaidRaw === undefined ? true : prepaidRaw === true || prepaidRaw === 'true';
  return {
    externalId,
    displayId: (text(at(raw, map.displayId)) || externalId).slice(0, 30),
    createdAt: text(at(raw, map.createdAt)) || new Date().toISOString(),
    type: 'delivery',
    customer: { name: text(at(raw, map.customerName)) || 'Cliente', ...(phone && { phone }) },
    ...(address && { address }),
    items,
    subtotalCents,
    deliveryFeeCents,
    discountCents,
    // O total vem do marketplace; se não bater com os itens, a validação do pedido recusa.
    totalCents: toCents(at(raw, map.total), unit),
    payment: { method: prepaid ? 'online' : 'other', prepaid },
  };
}
