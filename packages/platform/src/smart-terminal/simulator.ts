import { declined, type TefOperation, type TefReply, type TefStep } from '../tef/protocol';
import type { SmartAcquirerId } from './acquirers';
import type { SmartTerminalBridge, SmartTerminalStatus } from './bridge';

interface Session {
  operation: TefOperation;
  acquirer: SmartAcquirerId;
  stage: 'start' | 'wait';
}

/**
 * Maquininha Android de mentira (F8-12): cumpre o contrato do plugin sem SDK nem aparelho.
 * Regras de teste, pelos centavos: terminados em 13, negada; em 99, a maquininha fica fora do
 * ar. Registra as segundas fases para os testes conferirem.
 */
export class SimulatedSmartTerminalBridge implements SmartTerminalBridge {
  readonly finished: { transactionId: string; confirmed: boolean }[] = [];
  readonly configured: { acquirer: SmartAcquirerId; values: Record<string, string> }[] = [];
  private sessions = new Map<string, Session>();
  private counter = 0;

  constructor(private readonly options: Partial<SmartTerminalStatus> = {}) {}

  async status(): Promise<SmartTerminalStatus> {
    return { sdkPresent: true, secretsStored: true, deviceReady: true, ...this.options };
  }

  async configure(acquirer: SmartAcquirerId, values: Record<string, string>) {
    this.configured.push({ acquirer, values });
  }

  async begin(acquirer: SmartAcquirerId, operation: TefOperation) {
    const sessionId = `sim-${++this.counter}`;
    this.sessions.set(sessionId, { operation, acquirer, stage: 'start' });
    return { sessionId };
  }

  async next(sessionId: string, _reply?: TefReply): Promise<TefStep> {
    const session = this.sessions.get(sessionId);
    if (!session) return { kind: 'done', result: declined('Operação não encontrada.') };
    if (session.stage === 'start') {
      session.stage = 'wait';
      return { kind: 'wait', text: 'Aproxime, insira ou passe o cartão na maquininha' };
    }
    this.sessions.delete(sessionId);
    const cents = session.operation.amountCents;
    if (cents % 100 === 99)
      return {
        kind: 'done',
        result: declined('A maquininha não respondeu (simulador). Use outra forma de pagamento.'),
      };
    if (cents % 100 === 13)
      return { kind: 'done', result: declined('Transação negada pelo emissor (simulador).') };
    const nsu = String(this.counter).padStart(6, '0');
    return {
      kind: 'done',
      result: {
        approved: true,
        message: 'Aprovada (simulador)',
        transactionId: `T${nsu}`,
        nsu,
        authorizationCode: `SIM${nsu}`,
        acquirer: `Simulador ${session.acquirer}`,
        receipts: {
          customer: ['MERCADINHO DE TESTE', 'VIA CLIENTE', `NSU ${nsu}`],
          merchant: ['MERCADINHO DE TESTE', 'VIA ESTABELECIMENTO', `NSU ${nsu}`],
        },
      },
    };
  }

  async abort(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  async finish(_acquirer: SmartAcquirerId, transactionId: string, confirmed: boolean) {
    this.finished.push({ transactionId, confirmed });
  }
}
