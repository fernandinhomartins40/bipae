import { CliSiTefDriver, MissingCliSiTefLib, type CliSiTefLib } from './cli-sitef';
import type { TefConfig } from './config';
import { SimulatedCliSiTefLib } from './simulator';
import { MissingPayGoLib, PayGoDriver, type PayGoLib } from './paygo';
import type { TefDriver } from './protocol';

/** Bibliotecas nativas que este computador tem (Desktop direto ou Conector); ausente = não instalada. */
export interface TefLibs {
  sitef?: CliSiTefLib;
  paygo?: PayGoLib;
}

/**
 * Escolhe o driver certo para a configuração (F8-11). `none` devolve `null`: o caixa segue com a
 * maquininha à parte. Sem a biblioteca, o driver existe mas responde "falta configurar" ao
 * primeiro uso, e o caixa mostra a mensagem em vez de travar a venda.
 */
export function createTefDriver(config: TefConfig | undefined, libs: TefLibs): TefDriver | null {
  switch (config?.provider ?? 'none') {
    case 'simulator':
      return new CliSiTefDriver(new SimulatedCliSiTefLib(), {
        host: 'simulador',
        storeCode: '00000000',
        terminalId: 'SE000001',
      });
    case 'sitef': {
      const s = config?.sitef;
      return new CliSiTefDriver(libs.sitef ?? new MissingCliSiTefLib(), {
        host: s?.host ?? '',
        storeCode: s?.storeCode ?? '',
        terminalId: s?.terminalId ?? '',
        ...(s?.modalities && { modalities: s.modalities }),
        ...(s?.extra && { extra: s.extra }),
      });
    }
    case 'paygo':
      return new PayGoDriver(libs.paygo ?? new MissingPayGoLib(), {
        automationName: config?.paygo?.automationName ?? '',
        automationVersion: config?.paygo?.automationVersion ?? '',
        captureTerminal: config?.paygo?.captureTerminal ?? '',
        ...(config?.paygo?.host && { host: config.paygo.host }),
      });
    default:
      return null;
  }
}

export const TEF_CONFIG_KEY = 'bipae.tef.config';

/** Lê a configuração do TEF guardada neste aparelho (preferências); vazio quando não há. */
export async function loadTefConfig(preferences: {
  get(key: string): Promise<string | null>;
}): Promise<TefConfig> {
  try {
    const raw = await preferences.get(TEF_CONFIG_KEY);
    const value = raw ? (JSON.parse(raw) as TefConfig) : null;
    return value && typeof value === 'object' && typeof value.provider === 'string'
      ? value
      : { provider: 'none' };
  } catch {
    return { provider: 'none' };
  }
}

export async function saveTefConfig(
  preferences: { set(key: string, value: string): Promise<void> },
  config: TefConfig,
): Promise<void> {
  await preferences.set(TEF_CONFIG_KEY, JSON.stringify(config));
}
