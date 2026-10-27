import type { PayGoConfig } from './paygo';
import type { TefMethod } from './protocol';

/**
 * Configuração do TEF neste computador (F8-11), guardada junto dos outros periféricos
 * (`DeviceConfig.tef`). Nada aqui é segredo: a senha do SiTef, se houver, fica no contrato da
 * loja e nunca passa pelo Bipaê.
 */
export type TefProvider = 'none' | 'sitef' | 'paygo' | 'simulator';

export interface TefConfig {
  provider: TefProvider;
  sitef?: {
    host: string;
    storeCode: string;
    terminalId: string;
    /** Número da modalidade de cada forma de pagamento, como o contrato da loja define. */
    modalities?: Partial<Record<TefMethod | 'cancel', number>>;
    extra?: string;
  };
  paygo?: PayGoConfig;
}

export const TEF_PROVIDER_INFO: Record<
  TefProvider,
  { name: string; status: 'ready' | 'needs-library' | 'coming-soon'; note: string }
> = {
  none: {
    name: 'Sem TEF',
    status: 'ready',
    note: 'O cartão é passado na maquininha à parte e confirmado no caixa.',
  },
  simulator: {
    name: 'Pinpad simulado (teste)',
    status: 'ready',
    note: 'Só para treinar o fluxo: nenhum cartão é cobrado.',
  },
  sitef: {
    name: 'SiTef (CliSiTef)',
    status: 'needs-library',
    note: 'O protocolo está pronto e testado com simulador. Falta configurar a biblioteca CliSiTef, o pinpad e o contrato da loja com a Software Express/Fiserv (item E10).',
  },
  paygo: {
    name: 'PayGo (PGWebLib)',
    status: 'needs-library',
    note: 'O protocolo está pronto e testado com simulador. Falta configurar a biblioteca PGWebLib, o pinpad homologado e o contrato da loja com a PayGo (item E10).',
  },
};

export const TEF_PROVIDERS = Object.keys(TEF_PROVIDER_INFO) as TefProvider[];

/** O que falta para o TEF funcionar neste computador, em português; vazio quando está pronto. */
export function tefMissing(config: TefConfig | undefined, libraryInstalled: boolean): string[] {
  const provider = config?.provider ?? 'none';
  if (provider === 'none' || provider === 'simulator') return [];
  const missing: string[] = [];
  if (provider === 'paygo') {
    const g = config?.paygo;
    if (!g?.automationName?.trim()) missing.push('Nome da automação na PayGo');
    if (!g?.automationVersion?.trim()) missing.push('Versão da automação na PayGo');
    if (!g?.captureTerminal?.trim()) missing.push('Ponto de captura da PayGo');
    if (!libraryInstalled) missing.push('Biblioteca PGWebLib neste computador');
    return missing;
  }
  const s = config?.sitef;
  if (!s?.host?.trim()) missing.push('Servidor do SiTef');
  if (!s?.storeCode?.trim()) missing.push('Código da loja no SiTef');
  if (!s?.terminalId?.trim()) missing.push('Número do terminal no SiTef');
  if (!libraryInstalled) missing.push('Biblioteca CliSiTef neste computador');
  return missing;
}
