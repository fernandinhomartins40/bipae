import type { CapabilityGap, CapabilityName, CapabilityStatus, PlatformKind } from './ports';

/** Labels with their article, so sentences read naturally in pt-BR. */
const CAPABILITY_LABELS: Record<CapabilityName, { name: string; article: 'o' | 'a' | 'as' }> = {
  storage: { name: 'banco local', article: 'o' },
  printer: { name: 'impressora térmica', article: 'a' },
  cashDrawer: { name: 'gaveta de dinheiro', article: 'a' },
  scale: { name: 'balança', article: 'a' },
  tef: { name: 'TEF / pinpad', article: 'o' },
  certificateA1: { name: 'certificado digital A1', article: 'o' },
  certificateA3: { name: 'certificado digital A3 (token ou cartão)', article: 'o' },
  updater: { name: 'atualização automática', article: 'a' },
  notifications: { name: 'notificações', article: 'as' },
};

export interface CapabilityExplanation {
  /** Short status for a badge. */
  title: string;
  /** Plain-language explanation with the fix. */
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
  const { name: label, article } = CAPABILITY_LABELS[name];
  return explainGap(`${article} ${label}`, status.reason, platform);
}

function explainGap(
  subject: string,
  gap: CapabilityGap,
  platform: PlatformKind,
): CapabilityExplanation {
  switch (gap) {
    case 'needs-connector':
      return {
        title: 'Precisa do Bipaê Conector',
        message: `Para usar ${subject} no navegador, instale o Bipaê Conector. É 1 clique e você só faz isso uma vez neste computador.`,
        action: { label: 'Instalar o Bipaê Conector', kind: 'install-connector' },
      };
    case 'browser-unsupported':
      return platform === 'web'
        ? {
            title: 'Navegador sem suporte',
            message: `Este navegador não consegue usar ${subject}. Use o Google Chrome ou o Microsoft Edge atualizados, ou instale o Bipaê Conector.`,
            action: { label: 'Instalar o Bipaê Conector', kind: 'install-connector' },
          }
        : { title: 'Indisponível', message: `Não foi possível usar ${subject} neste computador.` };
    case 'not-configured':
      return {
        title: 'Falta configurar',
        message: `Falta configurar ${subject}. Leva menos de um minuto.`,
        action: { label: 'Configurar agora', kind: 'open-settings' },
      };
    case 'offline':
      return {
        title: 'Sem internet',
        message: `No momento não dá para usar ${subject} porque estamos sem internet. Você pode continuar vendendo; tentamos de novo assim que a conexão voltar.`,
        action: { label: 'Tentar de novo', kind: 'retry' },
      };
    case 'coming-soon':
      return {
        title: 'Chega em breve',
        message: `O suporte para ${subject} chega numa próxima atualização do Bipaê.`,
      };
  }
}

/** Capability matrix from Adendo 01 §4: what each platform supports by design. */
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

/**
 * Baseline matrix minus what is not built yet. Shells list the capabilities they actually
 * implement; anything else the platform would support is reported as "coming-soon".
 */
export function implementedCapabilities(
  baseline: Record<CapabilityName, CapabilityStatus>,
  implemented: readonly CapabilityName[],
): Record<CapabilityName, CapabilityStatus> {
  const result = { ...baseline };
  for (const name of Object.keys(result) as CapabilityName[]) {
    if (result[name].available && !implemented.includes(name)) {
      result[name] = { available: false, reason: 'coming-soon' };
    }
  }
  return result;
}
