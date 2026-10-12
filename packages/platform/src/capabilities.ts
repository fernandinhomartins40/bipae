import type { CapabilityGap, CapabilityName, CapabilityStatus, PlatformKind } from './ports';

const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  storage: 'banco local',
  printer: 'impressora térmica',
  cashDrawer: 'gaveta de dinheiro',
  scale: 'balança',
  tef: 'TEF / pinpad',
  certificateA1: 'certificado digital A1',
  certificateA3: 'certificado digital A3 (token ou cartão)',
  updater: 'atualização automática',
  notifications: 'notificações',
};

export interface CapabilityExplanation {
  title: string;
  message: string;
  action?: { label: string; kind: 'install-connector' | 'open-settings' | 'retry' };
}

/**
 * User-facing explanation for a missing capability, in plain pt-BR with the fix
 * (Adendo 01 §4: "explique em linguagem simples e ofereça a solução").
 */
export function explainCapability(
  name: CapabilityName,
  status: CapabilityStatus,
  platform: PlatformKind,
): CapabilityExplanation | null {
  if (status.available) return null;
  const label = CAPABILITY_LABELS[name];
  return explainGap(label, status.reason, platform);
}

function explainGap(label: string, gap: CapabilityGap, platform: PlatformKind): CapabilityExplanation {
  switch (gap) {
    case 'needs-connector':
      return {
        title: `Use a ${label} no navegador`,
        message: `Para usar a ${label} no navegador, instale o Bipaê Conector. É 1 clique e você só faz isso uma vez neste computador.`,
        action: { label: 'Instalar o Bipaê Conector', kind: 'install-connector' },
      };
    case 'browser-unsupported':
      return {
        title: `Este navegador não acessa a ${label}`,
        message:
          platform === 'web'
            ? `Este navegador não consegue falar com a ${label}. Use o Google Chrome ou o Microsoft Edge atualizados, ou instale o Bipaê Conector.`
            : `Não foi possível acessar a ${label} neste computador.`,
        action: { label: 'Instalar o Bipaê Conector', kind: 'install-connector' },
      };
    case 'not-configured':
      return {
        title: `Falta configurar a ${label}`,
        message: `A ${label} ainda não foi configurada. Leva menos de um minuto.`,
        action: { label: 'Configurar agora', kind: 'open-settings' },
      };
    case 'offline':
      return {
        title: 'Sem internet no momento',
        message: `A ${label} precisa de internet. Você pode continuar vendendo; tentaremos de novo assim que a conexão voltar.`,
        action: { label: 'Tentar de novo', kind: 'retry' },
      };
  }
}

/** Baseline capability matrix from Adendo 01 §4, before probing devices. */
export function baselineCapabilities(
  platform: PlatformKind,
  options: { connectorPaired: boolean; webSerial: boolean },
): Record<CapabilityName, CapabilityStatus> {
  if (platform === 'desktop') {
    return {
      storage: { available: true, via: 'native' },
      printer: { available: true, via: 'native' },
      cashDrawer: { available: true, via: 'native' },
      scale: { available: true, via: 'native' },
      tef: { available: true, via: 'native' },
      certificateA1: { available: true, via: 'native' },
      certificateA3: { available: true, via: 'native' },
      updater: { available: true, via: 'native' },
      notifications: { available: true, via: 'native' },
    };
  }
  const viaConnector = (): CapabilityStatus =>
    options.connectorPaired
      ? { available: true, via: 'connector' }
      : { available: false, reason: 'needs-connector' };
  return {
    storage: { available: true, via: 'browser' },
    // Without the connector the browser print dialog still works.
    printer: options.connectorPaired
      ? { available: true, via: 'connector' }
      : { available: true, via: 'browser' },
    cashDrawer: viaConnector(),
    scale: options.connectorPaired
      ? { available: true, via: 'connector' }
      : options.webSerial
        ? { available: true, via: 'browser' }
        : { available: false, reason: 'needs-connector' },
    tef: viaConnector(),
    certificateA1: { available: true, via: 'server' },
    certificateA3: viaConnector(),
    updater: { available: true, via: 'browser' },
    notifications: { available: true, via: 'browser' },
  };
}
