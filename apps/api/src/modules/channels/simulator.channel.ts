import { uuidv7, type ChannelAction, type NormalizedOrder } from '@bipae/domain';
import {
  ChannelNotReadyError,
  ChannelRejectedError,
  type AvailabilityItem,
  type ChannelEvent,
  type OrderChannel,
} from './channel.port';

/**
 * Canal de mentira para treinar e testar o fluxo inteiro sem credencial (E14). Guarda tudo em
 * memória, por integração: o que o "canal" tem de pedidos, os eventos ainda não confirmados e as
 * ações que o Bipaê mandou. Não existe em produção (o serviço recusa).
 */
interface SimState {
  orders: Map<string, NormalizedOrder>;
  events: ChannelEvent[];
  acked: Set<string>;
  actions: { orderId: string; action: ChannelAction; reason?: string }[];
  pushed: AvailabilityItem[][];
  closed: Set<string>;
  failNext: number;
}

export class SimulatorHub {
  private readonly states = new Map<string, SimState>();

  state(integrationId: string): SimState {
    let s = this.states.get(integrationId);
    if (!s) {
      s = {
        orders: new Map(),
        events: [],
        acked: new Set(),
        actions: [],
        pushed: [],
        closed: new Set(),
        failNext: 0,
      };
      this.states.set(integrationId, s);
    }
    return s;
  }

  /** O cliente "faz um pedido" no canal: aparece o pedido e o evento de novo pedido. */
  place(integrationId: string, order: NormalizedOrder): NormalizedOrder {
    const s = this.state(integrationId);
    s.orders.set(order.externalId, order);
    s.events.push({ id: uuidv7(), kind: 'placed', code: 'PLC', orderId: order.externalId });
    return order;
  }

  /** O cliente cancela no canal. */
  cancel(integrationId: string, externalId: string) {
    const s = this.state(integrationId);
    s.closed.add(externalId);
    s.events.push({ id: uuidv7(), kind: 'cancelled', code: 'CAN', orderId: externalId });
  }

  forget(integrationId: string) {
    this.states.delete(integrationId);
  }

  channel(integrationId: string): OrderChannel {
    return {
      polling: true,
      pollEvents: () => {
        const s = this.state(integrationId);
        return Promise.resolve(s.events.filter((e) => !s.acked.has(e.id)));
      },
      acknowledge: (ids) => {
        const s = this.state(integrationId);
        ids.forEach((id) => s.acked.add(id));
        return Promise.resolve();
      },
      fetchOrder: (orderId) => {
        const o = this.state(integrationId).orders.get(orderId);
        return o
          ? Promise.resolve(o)
          : Promise.reject(new ChannelRejectedError('Pedido não existe no simulador.'));
      },
      act: (orderId, action, reason) => {
        const s = this.state(integrationId);
        if (s.failNext > 0) {
          s.failNext -= 1;
          return Promise.reject(new Error('Falha simulada do canal.'));
        }
        if (s.closed.has(orderId)) {
          return Promise.reject(new ChannelRejectedError('O pedido já foi cancelado no canal.'));
        }
        s.actions.push({ orderId, action, ...(reason && { reason }) });
        return Promise.resolve();
      },
      pushAvailability: (items) => {
        this.state(integrationId).pushed.push(items);
        return Promise.resolve();
      },
    };
  }
}

/** Canal de conector genérico: o pedido chega por empurrão; não há o que buscar no canal. */
export class GenericChannel implements OrderChannel {
  readonly polling = false;
  pollEvents() {
    return Promise.resolve([]);
  }
  acknowledge() {
    return Promise.resolve();
  }
  fetchOrder(): Promise<NormalizedOrder> {
    return Promise.reject(new ChannelNotReadyError('Este canal manda o pedido inteiro.'));
  }
  // O conector é avisado pelo histórico de status; o aviso ativo (webhook) chega em breve.
  act() {
    return Promise.resolve();
  }
  pushAvailability(): Promise<void> {
    return Promise.reject(
      new ChannelNotReadyError('Cardápio e estoque no marketplace chegam em breve.'),
    );
  }
}
