import { invoke } from '@tauri-apps/api/core';
import {
  missingSmartTerminalBridge,
  type SmartTerminalBridge,
  type SmartTerminalStatus,
} from '@bipae/platform';

/**
 * Ponte com o plugin Kotlin `bipae-terminal` das maquininhas (F8-12). O plugin ainda não está
 * registrado no app (ele depende de SDK de adquirente e de conta, E26): enquanto isso, cada
 * chamada que o Tauri recusa por "plugin não encontrado" vira "falta configurar", nunca erro.
 */
const PLUGIN = 'plugin:bipae-terminal';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(`${PLUGIN}|${command}`, args);
}

export const tauriSmartTerminalBridge: SmartTerminalBridge = {
  async status(acquirer) {
    try {
      return await call<SmartTerminalStatus>('status', { acquirer });
    } catch {
      return missingSmartTerminalBridge.status(acquirer);
    }
  },
  configure: (acquirer, values) => call('configure', { acquirer, values }),
  begin: (acquirer, operation) => call('begin', { acquirer, operation }),
  next: (sessionId, reply) => call('next', { sessionId, reply: reply ?? null }),
  abort: (sessionId) => call('abort', { sessionId }),
  finish: (acquirer, transactionId, confirmed) =>
    call('finish', { acquirer, transactionId, confirmed }),
};
