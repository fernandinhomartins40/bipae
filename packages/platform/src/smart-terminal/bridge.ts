import type { TefOperation, TefReply, TefStep } from '../tef/protocol';
import { SMART_ACQUIRERS, type SmartAcquirerId, type SmartTerminalConfig } from './acquirers';

/**
 * Contrato entre o TypeScript e o plugin Kotlin (`bipae-terminal`, no Tauri Android). O Kotlin
 * só move chamadas e bytes para o SDK da adquirente: o fluxo (passos, duas fases, cancelamento)
 * é o do TEF de `../tef/protocol`, igual para todas. As maquininhas smart, que mostram a tela
 * delas, devolvem poucos passos (`wait` e `done`); o m-SiTef e o PayGo devolvem menus e campos.
 */
export interface SmartTerminalStatus {
  /** O plugin está no app e o SDK da adquirente foi incluído no build. */
  sdkPresent: boolean;
  /** O plugin já guarda os campos secretos (Android Keystore); o Bipaê nunca os guarda. */
  secretsStored?: boolean;
  /** O aparelho é uma maquininha (smart) ou há pinpad pareado (TEF). */
  deviceReady: boolean;
  /** Motivo em português quando algo falta, vindo do plugin. */
  note?: string;
}

export interface SmartTerminalBridge {
  status(acquirer: SmartAcquirerId): Promise<SmartTerminalStatus>;
  /** Configura o SDK com os valores da loja; devolve erro em português se a adquirente recusar. */
  configure(acquirer: SmartAcquirerId, values: Record<string, string>): Promise<void>;
  /** Abre uma operação e devolve o identificador da sessão. */
  begin(acquirer: SmartAcquirerId, operation: TefOperation): Promise<{ sessionId: string }>;
  /** Passo seguinte, depois da resposta ao anterior. */
  next(sessionId: string, reply?: TefReply): Promise<TefStep>;
  abort(sessionId: string): Promise<void>;
  /** Segunda fase: confirma a transação gravada ou a desfaz. */
  finish(acquirer: SmartAcquirerId, transactionId: string, confirmed: boolean): Promise<void>;
}

/** Campos obrigatórios (não secretos) que a loja ainda não preencheu, em português. */
export function missingFields(config: SmartTerminalConfig): string[] {
  if (config.acquirer === 'none') return [];
  return SMART_ACQUIRERS[config.acquirer].fields
    .filter((f) => !f.secret && !config.values?.[f.key]?.trim())
    .map((f) => f.label);
}

/** Campos secretos que o plugin ainda não guardou (o Bipaê não os guarda, regra 10). */
export function missingSecrets(acquirer: SmartAcquirerId, status: SmartTerminalStatus): string[] {
  if (status.secretsStored === true) return [];
  return SMART_ACQUIRERS[acquirer].fields.filter((f) => f.secret).map((f) => f.label);
}

/**
 * O que falta para a maquininha funcionar neste aparelho, em português; vazio quando está
 * pronta. `status` é a resposta do plugin (ou `null` se o plugin nem existe no app).
 */
export function smartTerminalMissing(
  config: SmartTerminalConfig | undefined,
  status: SmartTerminalStatus | null,
): string[] {
  if (!config || config.acquirer === 'none') return [];
  const info = SMART_ACQUIRERS[config.acquirer];
  const missing = missingFields(config);
  if (!status?.sdkPresent) missing.push(`SDK ${info.sdk} dentro do app`);
  else {
    missing.push(...missingSecrets(config.acquirer, status));
    if (!status.deviceReady)
      missing.push(info.kind === 'smart' ? 'Maquininha smart da adquirente' : 'Pinpad pareado');
  }
  return missing;
}
