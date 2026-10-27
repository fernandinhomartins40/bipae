import { DriverTefPort } from '../tef/port';
import {
  TefError,
  type TefDriver,
  type TefOperation,
  type TefSession,
  type TefUi,
} from '../tef/protocol';
import { SMART_ACQUIRERS, type SmartAcquirerId, type SmartTerminalConfig } from './acquirers';
import { missingFields, missingSecrets, type SmartTerminalBridge } from './bridge';

/**
 * Liga o plugin Kotlin ao protocolo do TEF: a mesma `runTef` e a mesma `TefPort` do SiTef do
 * computador servem às maquininhas do Android. Falta de configuração vira `TefError` em
 * português (o caixa segue com outra forma de pagamento, o TEF nunca derruba a venda).
 */
export class BridgeTefDriver implements TefDriver {
  readonly id: string;

  constructor(
    private readonly bridge: SmartTerminalBridge,
    private readonly acquirer: SmartAcquirerId,
    private readonly values: Record<string, string> = {},
  ) {
    this.id = `smart:${acquirer}`;
  }

  async begin(operation: TefOperation): Promise<TefSession> {
    const info = SMART_ACQUIRERS[this.acquirer];
    const missing = missingFields({ acquirer: this.acquirer, values: this.values });
    if (missing.length)
      throw new TefError(`Falta configurar ${info.name}: ${missing.join(', ')}.`, 'not_configured');
    if (operation.kind === 'sale' && !info.methods.includes(operation.method))
      throw new TefError(`${info.name} não faz essa forma de pagamento.`, 'rejected');
    const status = await this.bridge.status(this.acquirer);
    if (!status.sdkPresent)
      throw new TefError(
        status.note ?? `O app ainda não traz o SDK de ${info.name}.`,
        'not_configured',
      );
    const secrets = missingSecrets(this.acquirer, status);
    if (secrets.length)
      throw new TefError(`Falta configurar ${info.name}: ${secrets.join(', ')}.`, 'not_configured');
    if (!status.deviceReady)
      throw new TefError(
        status.note ??
          (info.kind === 'smart' ? 'Este aparelho não é a maquininha.' : 'Nenhum pinpad pareado.'),
        'unavailable',
      );
    await this.bridge.configure(this.acquirer, this.values);
    const { sessionId } = await this.bridge.begin(this.acquirer, operation);
    return {
      next: (reply) => this.bridge.next(sessionId, reply),
      abort: () => this.bridge.abort(sessionId),
    };
  }

  finish(transactionId: string, confirmed: boolean): Promise<void> {
    return this.bridge.finish(this.acquirer, transactionId, confirmed);
  }
}

/** A `TefPort` do caixa para a adquirente escolhida; `undefined` quando não há escolha. */
export function createSmartTerminalTef(
  bridge: SmartTerminalBridge,
  ui: TefUi,
  config: SmartTerminalConfig | undefined,
): DriverTefPort | undefined {
  if (!config || config.acquirer === 'none') return undefined;
  return new DriverTefPort(
    new BridgeTefDriver(bridge, config.acquirer, config.values),
    ui,
    SMART_ACQUIRERS[config.acquirer].name,
  );
}

/** Ponte de um app sem o plugin (navegador, computador, build sem SDK): tudo "falta configurar". */
export const missingSmartTerminalBridge: SmartTerminalBridge = {
  status: async () => ({
    sdkPresent: false,
    deviceReady: false,
    note: 'Este app ainda não traz o plugin das maquininhas.',
  }),
  configure: async () => undefined,
  begin: async () => {
    throw new TefError('Este app ainda não traz o plugin das maquininhas.', 'not_configured');
  },
  next: async () => {
    throw new TefError('Não há operação aberta.', 'protocol');
  },
  abort: async () => undefined,
  finish: async () => undefined,
};
