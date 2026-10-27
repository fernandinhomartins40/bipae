import type { ChannelAction, NormalizedOrder } from '@bipae/domain';
import { PixUnavailableError, type PixTransport } from '../payments/pix-api';
import {
  ChannelNotReadyError,
  ChannelRejectedError,
  ChannelUnavailableError,
  reaisToCents,
  type AvailabilityItem,
  type ChannelEvent,
  type OrderChannel,
} from './channel.port';

/**
 * iFood, pela API de pedidos do integrador (Merchant API). Os caminhos abaixo são os da
 * documentação pública do iFood como o projeto os conhece; em 27/10/2026 o portal
 * developer.ifood.com.br recusou a leitura automática (HTTP 403), então NADA aqui foi conferido
 * com o iFood de verdade. Por isso o endereço-base é configurável (IFOOD_API_URL) e o adaptador
 * só roda com o clientId e o clientSecret do integrador (E14). Pendências em docs/TAREFAS.md.
 *
 * - Token: POST /authentication/v1.0/oauth/token (grantType=client_credentials).
 * - Eventos: GET /events/v1.0/events:polling e POST /events/v1.0/events/acknowledgment.
 * - Pedido: GET /order/v1.0/orders/{id}; ações: /confirm, /startPreparation, /readyToPickup,
 *   /dispatch e /requestCancellation.
 */
export const IFOOD_DEFAULT_URL = 'https://merchant-api.ifood.com.br';

export interface IfoodCredentials {
  clientId: string;
  clientSecret: string;
  merchantId: string;
}

const KIND: Record<string, ChannelEvent['kind']> = {
  PLC: 'placed',
  CFM: 'confirmed',
  DSP: 'dispatched',
  CON: 'concluded',
  CAN: 'cancelled',
};

const ACTION_PATH: Partial<Record<ChannelAction, string>> = {
  accept: 'confirm',
  start_preparation: 'startPreparation',
  ready: 'readyToPickup',
  dispatch: 'dispatch',
};

interface IfoodOrder {
  id?: string;
  displayId?: string | number;
  createdAt?: string;
  orderType?: string;
  customer?: { name?: string; phone?: { number?: string } };
  delivery?: { deliveryAddress?: { formattedAddress?: string } };
  items?: {
    id?: string;
    externalCode?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    observations?: string;
  }[];
  total?: { subTotal?: number; deliveryFee?: number; benefits?: number; orderAmount?: number };
  payments?: {
    prepaid?: number;
    methods?: { type?: string; method?: string; cash?: { changeFor?: number } }[];
  };
  extraInfo?: string;
}

export function mapIfoodOrder(o: IfoodOrder): NormalizedOrder {
  const items = (o.items ?? []).map((i) => ({
    sku: String(i.externalCode ?? i.id ?? ''),
    name: i.name ?? 'Item',
    quantity: Math.max(1, Math.round(i.quantity ?? 1)),
    unitPriceCents: reaisToCents(i.unitPrice ?? 0),
    totalCents: reaisToCents(i.totalPrice ?? 0),
    ...(i.observations && { notes: i.observations }),
  }));
  const method = o.payments?.methods?.[0];
  const prepaidCents = reaisToCents(o.payments?.prepaid ?? 0);
  const orderAmount = reaisToCents(o.total?.orderAmount ?? 0);
  const prepaid = method?.type === 'ONLINE' || (prepaidCents > 0 && prepaidCents >= orderAmount);
  return {
    externalId: String(o.id ?? ''),
    displayId: String(o.displayId ?? o.id ?? '').slice(0, 30),
    createdAt: o.createdAt ?? new Date().toISOString(),
    type: o.orderType === 'TAKEOUT' ? 'takeout' : 'delivery',
    customer: {
      name: o.customer?.name ?? 'Cliente iFood',
      ...(o.customer?.phone?.number && { phone: o.customer.phone.number }),
    },
    ...(o.delivery?.deliveryAddress?.formattedAddress && {
      address: o.delivery.deliveryAddress.formattedAddress,
    }),
    items,
    subtotalCents: reaisToCents(o.total?.subTotal ?? 0),
    deliveryFeeCents: reaisToCents(o.total?.deliveryFee ?? 0),
    discountCents: reaisToCents(o.total?.benefits ?? 0),
    totalCents: orderAmount,
    payment: {
      method: prepaid ? 'online' : method?.method === 'CASH' ? 'cash' : 'card_on_delivery',
      prepaid,
      ...(method?.cash?.changeFor && { changeForCents: reaisToCents(method.cash.changeFor) }),
    },
    ...(o.extraInfo && { notes: o.extraInfo.slice(0, 500) }),
  };
}

export class IfoodChannel implements OrderChannel {
  readonly polling = true;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: IfoodCredentials,
    private readonly transport: PixTransport,
    private readonly baseUrl = IFOOD_DEFAULT_URL,
    private readonly now: () => number = Date.now,
  ) {}

  private async raw(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
    headers: Record<string, string> = {},
  ) {
    try {
      return await this.transport.send(
        {
          method,
          url: `${this.baseUrl}${path}`,
          headers: { Accept: 'application/json', ...headers },
          ...(body !== undefined && { body }),
        },
        null,
      );
    } catch (error) {
      if (error instanceof PixUnavailableError) throw new ChannelUnavailableError(error.message);
      throw error;
    }
  }

  private json(text: string): unknown {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new ChannelUnavailableError('O iFood respondeu algo que não é JSON.');
    }
  }

  private async authorize(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 30_000) return this.token.value;
    const body = new URLSearchParams({
      grantType: 'client_credentials',
      clientId: this.creds.clientId,
      clientSecret: this.creds.clientSecret,
    }).toString();
    const res = await this.raw('POST', '/authentication/v1.0/oauth/token', body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new ChannelNotReadyError('O iFood recusou o clientId ou o clientSecret.');
    }
    if (res.status >= 500) throw new ChannelUnavailableError(`O iFood respondeu ${res.status}.`);
    const json = this.json(res.body) as { accessToken?: string; expiresIn?: number };
    if (!json.accessToken) throw new ChannelUnavailableError('O iFood não devolveu o token.');
    this.token = {
      value: json.accessToken,
      expiresAt: this.now() + (json.expiresIn ?? 3600) * 1000,
    };
    return json.accessToken;
  }

  private async call(method: 'GET' | 'POST', path: string, payload?: unknown) {
    const token = await this.authorize();
    const res = await this.raw(
      method,
      path,
      payload === undefined ? undefined : JSON.stringify(payload),
      {
        Authorization: `Bearer ${token}`,
        ...(payload !== undefined && { 'Content-Type': 'application/json' }),
        'x-polling-merchants': this.creds.merchantId,
      },
    );
    if (res.status === 401) {
      this.token = null;
      throw new ChannelUnavailableError('O iFood pediu um novo token.');
    }
    if (res.status >= 500 || res.status === 429) {
      throw new ChannelUnavailableError(`O iFood respondeu ${res.status}.`);
    }
    if (res.status >= 400) {
      const text = (this.json(res.body) as { error?: { message?: string } }).error?.message;
      throw new ChannelRejectedError(text ?? `O iFood recusou (${res.status}).`);
    }
    return res;
  }

  async pollEvents(): Promise<ChannelEvent[]> {
    const res = await this.call('GET', '/events/v1.0/events:polling');
    if (res.status === 204) return [];
    const list = this.json(res.body);
    if (!Array.isArray(list)) return [];
    return list
      .filter((e): e is { id: string; code: string; orderId: string } => !!e?.id && !!e?.orderId)
      .map((e) => ({
        id: String(e.id),
        code: String(e.code),
        kind: KIND[String(e.code)] ?? 'other',
        orderId: String(e.orderId),
      }));
  }

  async acknowledge(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.call(
      'POST',
      '/events/v1.0/events/acknowledgment',
      eventIds.map((id) => ({ id })),
    );
  }

  async fetchOrder(orderId: string): Promise<NormalizedOrder> {
    const res = await this.call('GET', `/order/v1.0/orders/${encodeURIComponent(orderId)}`);
    return mapIfoodOrder(this.json(res.body) as IfoodOrder);
  }

  async act(orderId: string, action: ChannelAction, reason?: string): Promise<void> {
    const id = encodeURIComponent(orderId);
    const path = ACTION_PATH[action];
    if (path) {
      await this.call('POST', `/order/v1.0/orders/${id}/${path}`, {});
      return;
    }
    // Recusar = pedir o cancelamento com um dos códigos que o iFood aceita para este pedido.
    const reasons = this.json(
      (await this.call('GET', `/order/v1.0/orders/${id}/cancellationReasons`)).body,
    );
    const first = Array.isArray(reasons)
      ? (reasons[0] as { cancelCodeId?: string; cancellationCode?: string } | undefined)
      : undefined;
    const cancellationCode = first?.cancelCodeId ?? first?.cancellationCode;
    if (!cancellationCode) {
      throw new ChannelRejectedError('O iFood não ofereceu um motivo de cancelamento.');
    }
    await this.call('POST', `/order/v1.0/orders/${id}/requestCancellation`, {
      reason: reason ?? 'Loja não consegue atender',
      cancellationCode,
    });
  }

  pushAvailability(_items: AvailabilityItem[]): Promise<void> {
    return Promise.reject(
      new ChannelNotReadyError(
        'Enviar cardápio e estoque ao iFood chega em breve: o catálogo do iFood ainda não foi conferido na documentação oficial.',
      ),
    );
  }
}
