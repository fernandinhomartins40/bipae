import { randomUUID } from 'node:crypto';
import { PixRejectedError, PixUnavailableError, type PixTransport } from './pix-api';

/**
 * Mercado Pago Point pela Orders API (F8-10, ADR-0018): o caixa manda o valor para a maquininha
 * pela internet e acompanha até aprovar ou recusar. Referência oficial:
 * https://www.mercadopago.com.br/developers/en/reference/in-person-payments/point/orders/create-order/post
 * O token de acesso nunca vai para log.
 */

const BASE = 'https://api.mercadopago.com';

/** Ordem como a Orders API devolve (só o que usamos). */
export interface MpOrder {
  id: string;
  status: 'created' | 'at_terminal' | 'processed' | 'failed' | 'canceled' | 'refunded' | 'expired';
  status_detail?: string;
  transactions?: { payments?: { id: string; status: string; amount: string }[] };
}

/** Situação da ordem como o caixa entende. */
export function orderOutcome(
  order: MpOrder,
): 'pending' | 'paid' | 'failed' | 'canceled' | 'expired' {
  switch (order.status) {
    case 'processed':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'refunded':
      return 'canceled';
    case 'expired':
      return 'expired';
    default:
      return 'pending';
  }
}

export class MercadoPagoPointClient {
  constructor(
    private readonly accessToken: string,
    private readonly transport: PixTransport,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.transport.send(
      {
        method,
        url: `${BASE}${path}`,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          ...(method === 'POST' && {
            'Content-Type': 'application/json',
            // Obrigatória nas escritas: a mesma chave nunca cria duas ordens.
            'X-Idempotency-Key': randomUUID(),
          }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      },
      null,
    );
    if (res.status >= 500) throw new PixUnavailableError(`O Mercado Pago respondeu ${res.status}.`);
    let json: unknown;
    try {
      json = JSON.parse(res.body || '{}');
    } catch {
      throw new PixUnavailableError('O Mercado Pago respondeu algo que não é JSON.');
    }
    if (res.status === 401) {
      throw new PixRejectedError(
        'O Mercado Pago recusou o token de acesso. Confira em Meios de pagamento.',
      );
    }
    if (res.status >= 400) {
      const e = json as { message?: string; errors?: { code?: string; message?: string }[] };
      const code = e.errors?.[0]?.code;
      const known: Record<string, string> = {
        already_queued_order_for_terminal:
          'A maquininha já tem uma cobrança esperando. Conclua ou cancele nela e tente de novo.',
        forbidden_checking_terminal_owner:
          'Essa maquininha não está ligada à conta do Mercado Pago informada.',
      };
      throw new PixRejectedError(
        (code && known[code]) ??
          `O Mercado Pago recusou: ${e.errors?.[0]?.message ?? e.message ?? `status ${res.status}`}.`,
      );
    }
    return json as T;
  }

  /** Manda o valor à maquininha: crédito à vista ou débito. */
  createOrder(input: {
    externalReference: string;
    amountCents: number;
    terminalId: string;
    method: 'credit' | 'debit';
    description: string;
  }): Promise<MpOrder> {
    return this.call<MpOrder>('POST', '/v1/orders', {
      type: 'point',
      external_reference: input.externalReference,
      expiration_time: 'PT3M',
      transactions: { payments: [{ amount: (input.amountCents / 100).toFixed(2) }] },
      config: {
        point: { terminal_id: input.terminalId, print_on_terminal: 'no_ticket' },
        payment_method: {
          default_type: input.method === 'credit' ? 'credit_card' : 'debit_card',
          ...(input.method === 'credit' && {
            default_installments: 1,
            installments_cost: 'seller',
          }),
        },
      },
      description: input.description.slice(0, 150),
    });
  }

  getOrder(id: string): Promise<MpOrder> {
    return this.call<MpOrder>('GET', `/v1/orders/${encodeURIComponent(id)}`);
  }

  cancelOrder(id: string): Promise<MpOrder> {
    return this.call<MpOrder>('POST', `/v1/orders/${encodeURIComponent(id)}/cancel`);
  }
}
