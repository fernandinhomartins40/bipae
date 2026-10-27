import type { ChannelAction, ChannelEventKind, NormalizedOrder } from '@bipae/domain';

/** Evento que o canal avisa (já traduzido). */
export interface ChannelEvent {
  /** Identificador do evento no canal: cada um é tratado uma vez só. */
  id: string;
  kind: ChannelEventKind;
  /** Código original do canal, para a trilha. */
  code: string;
  orderId: string;
}

export interface AvailabilityItem {
  sku: string;
  priceCents: number;
  available: boolean;
  stockUnits: number;
}

/** O canal não está pronto: falta credencial ou a função ainda não existe ("falta configurar"). */
export class ChannelNotReadyError extends Error {}
/** Falha de rede ou do canal: vale tentar de novo. */
export class ChannelUnavailableError extends Error {}
/** O canal recusou de vez (pedido já cancelado, ação fora de hora): não adianta repetir. */
export class ChannelRejectedError extends Error {}

/**
 * A porta de um canal de pedidos (F6-05/F6-06). O Bipaê só conversa com o canal por aqui; o
 * iFood, o simulador e os conectores genéricos são adaptadores desta interface.
 */
export interface OrderChannel {
  /** O canal entrega eventos por consulta periódica (iFood) ou o pedido chega por empurrão. */
  readonly polling: boolean;
  pollEvents(): Promise<ChannelEvent[]>;
  acknowledge(eventIds: string[]): Promise<void>;
  fetchOrder(orderId: string): Promise<NormalizedOrder>;
  act(orderId: string, action: ChannelAction, reason?: string): Promise<void>;
  /** Cardápio e estoque no canal; lança ChannelNotReadyError quando o canal ainda não aceita. */
  pushAvailability(items: AvailabilityItem[]): Promise<void>;
}

/** Reais em número decimal (o que o iFood manda) para centavos inteiros, sem acumular erro. */
export function reaisToCents(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ChannelRejectedError('Valor inválido no pedido.');
  return Number(n.toFixed(2).replace('.', ''));
}
