/**
 * Bipaê Conector protocol (ADR-0012 §3). The desktop app, in tray mode, listens on a local
 * WebSocket so the web register can use peripherals. This file is the specification:
 * the Rust server implements the same rules, and `ConnectorCore` is the reference
 * implementation used by the simulator and the tests.
 *
 * Security rules:
 * 1. Only the official origins may connect (checked on the WebSocket handshake).
 * 2. A browser must pair once by typing the 6-digit code shown by the Conector; it then
 *    gets a token (stored by the browser, revocable in the Conector).
 * 3. Only a closed list of commands exists; nothing reads files or runs programs.
 */

export const CONNECTOR_PORT = 47800;
export const CONNECTOR_URL = `ws://127.0.0.1:${CONNECTOR_PORT}`;
/** www.bipae.com.br/app is production today; app./homolog. are reserved for later. */
export const CONNECTOR_ORIGINS = [
  'https://www.bipae.com.br',
  'https://app.bipae.com.br',
  'https://homolog.bipae.com.br',
];
/** Development origins, accepted only by development builds of the Conector. */
export const CONNECTOR_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
];

export const CONNECTOR_COMMANDS = [
  'print',
  'drawer',
  'scale',
  'ports',
  'cert-info',
  'cert-certificate',
  'cert-sign',
  'tef-status',
  'tef-call',
] as const;
export type ConnectorCommand = (typeof CONNECTOR_COMMANDS)[number];

export type ConnectorRequest =
  | { id: number; type: 'pair'; code: string; clientName: string }
  | { id: number; type: 'auth'; token: string }
  | { id: number; type: 'print'; data: string /* base64 ESC/POS */ }
  | { id: number; type: 'drawer' }
  | { id: number; type: 'scale' }
  | { id: number; type: 'ports' }
  /** Certificado A3 (token ou cartão) ligado ao computador do Conector (F3-21.b). */
  | { id: number; type: 'cert-info' }
  | { id: number; type: 'cert-certificate' }
  | {
      id: number;
      type: 'cert-sign';
      data: string /* base64 do que será assinado */;
      algorithm: 'RSA-SHA1' | 'RSA-SHA256';
    }
  /** TEF (F8-11): quais bibliotecas existem neste computador e repasse de chamadas a elas. */
  | { id: number; type: 'tef-status' }
  | { id: number; type: 'tef-call'; lib: TefLibName; method: string; args: unknown };

export type ConnectorResponse =
  | { id: number; ok: true; result?: unknown }
  | {
      id: number;
      ok: false;
      error: string;
      code: 'unpaired' | 'bad_code' | 'unknown_command' | 'device' | 'locked';
    };

/** What the Conector does with the real hardware (Rust in the app; simulators in tests). */
export interface ConnectorDevices {
  print(bytes: Uint8Array): Promise<void>;
  openDrawer(): Promise<void>;
  /** Weight in grams; throws with a pt-BR message when the scale is not ready. */
  readScale(): Promise<number>;
  listPorts(): Promise<string[]>;
  /**
   * Certificado A3 do computador (PKCS#11). Ausente quando o token não está configurado.
   * A chave nunca sai do token e o PIN é pedido pelo próprio Conector/sistema: ele não
   * trafega pelo protocolo, nem é guardado ou registrado em log.
   */
  token?: A3Token;
  /** Bibliotecas de TEF (CliSiTef, PGWebLib) deste computador. Ausente quando não há nenhuma. */
  tef?: TefHost;
}

export type TefLibName = 'sitef' | 'paygo';

/**
 * Lista fechada de chamadas que o Conector repassa às bibliotecas de TEF. O Conector só move os
 * argumentos: a regra do fluxo mora em `CliSiTefDriver`/`PayGoDriver`, no navegador ou no Desktop.
 */
export const TEF_CALLS: Record<TefLibName, readonly string[]> = {
  sitef: ['configure', 'start', 'continue', 'finish'],
  paygo: ['init', 'begin', 'addParam', 'exec', 'result', 'confirm', 'abort'],
};

export interface TefHost {
  /** Quais bibliotecas estão instaladas neste computador. */
  status(): Promise<Record<TefLibName, boolean>>;
  call(lib: TefLibName, method: string, args: unknown): Promise<unknown>;
}

export const TEF_NOT_CONFIGURED =
  'O TEF ainda não foi configurado no Bipaê Conector. Falta instalar a biblioteca do SiTef ou da PayGo.';

export interface A3Token {
  /** Dados do certificado do token, ou null quando não há token inserido. */
  info(): Promise<{ subject: string; taxId: string; notAfter: string } | null>;
  /** Certificado do titular em base64 (DER). */
  certificate(): Promise<string | null>;
  /** Assina dentro do token e devolve a assinatura em base64. */
  sign(data: Uint8Array, algorithm: 'RSA-SHA1' | 'RSA-SHA256'): Promise<string>;
}

export const A3_NOT_CONFIGURED =
  'O certificado A3 ainda não foi configurado no Bipaê Conector. Falta configurar o leitor ou o token.';

export function isAllowedOrigin(origin: string | undefined, dev: boolean): boolean {
  if (!origin) return false;
  return CONNECTOR_ORIGINS.includes(origin) || (dev && CONNECTOR_DEV_ORIGINS.includes(origin));
}

export function randomPairingCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/**
 * Per-connection state machine of the Conector. Wrong pairing codes are limited
 * (5 attempts, then the code must be regenerated on the Conector) to stop guessing.
 */
export class ConnectorCore {
  private attempts = 0;
  readonly tokens = new Map<string, string>(); // token → client name

  constructor(
    private pairingCode: string,
    private readonly devices: ConnectorDevices,
    private readonly newToken: () => string = () => crypto.randomUUID(),
  ) {}

  regenerateCode(code: string) {
    this.pairingCode = code;
    this.attempts = 0;
  }

  revoke(token: string) {
    this.tokens.delete(token);
  }

  private token(): A3Token {
    if (!this.devices.token) throw new Error(A3_NOT_CONFIGURED);
    return this.devices.token;
  }

  /** Handles one request; `session.authed` is per WebSocket connection. */
  async handle(
    session: { authed: boolean },
    request: ConnectorRequest,
  ): Promise<ConnectorResponse> {
    const { id } = request;
    try {
      switch (request.type) {
        case 'pair': {
          if (this.attempts >= 5) {
            return {
              id,
              ok: false,
              code: 'locked',
              error: 'Muitas tentativas. Gere um novo código no Bipaê Conector.',
            };
          }
          if (request.code !== this.pairingCode) {
            this.attempts++;
            return {
              id,
              ok: false,
              code: 'bad_code',
              error: 'Código incorreto. Confira o código mostrado no Bipaê Conector.',
            };
          }
          const token = this.newToken();
          this.tokens.set(token, request.clientName.slice(0, 60));
          session.authed = true;
          return { id, ok: true, result: { token } };
        }
        case 'auth':
          if (!this.tokens.has(request.token)) {
            return {
              id,
              ok: false,
              code: 'unpaired',
              error: 'Este navegador precisa ser pareado de novo com o Bipaê Conector.',
            };
          }
          session.authed = true;
          return { id, ok: true };
        default:
          break;
      }
      if (!session.authed) {
        return {
          id,
          ok: false,
          code: 'unpaired',
          error: 'Pareie este navegador com o Bipaê Conector primeiro.',
        };
      }
      switch (request.type) {
        case 'print':
          await this.devices.print(fromBase64(request.data));
          return { id, ok: true };
        case 'drawer':
          await this.devices.openDrawer();
          return { id, ok: true };
        case 'scale':
          return { id, ok: true, result: { grams: await this.devices.readScale() } };
        case 'ports':
          return { id, ok: true, result: { ports: await this.devices.listPorts() } };
        case 'cert-info': {
          const info = await this.token().info();
          return { id, ok: true, result: { info } };
        }
        case 'cert-certificate':
          return { id, ok: true, result: { certificate: await this.token().certificate() } };
        case 'cert-sign': {
          if (request.algorithm !== 'RSA-SHA1' && request.algorithm !== 'RSA-SHA256') {
            return {
              id,
              ok: false,
              code: 'device',
              error: 'Algoritmo de assinatura não permitido.',
            };
          }
          const signature = await this.token().sign(fromBase64(request.data), request.algorithm);
          return { id, ok: true, result: { signature } };
        }
        case 'tef-status': {
          const libs = this.devices.tef
            ? await this.devices.tef.status()
            : { sitef: false, paygo: false };
          return { id, ok: true, result: { libs } };
        }
        case 'tef-call': {
          const allowed = TEF_CALLS[request.lib];
          if (!allowed || !allowed.includes(request.method)) {
            return { id, ok: false, code: 'device', error: 'Chamada de TEF não permitida.' };
          }
          if (!this.devices.tef) throw new Error(TEF_NOT_CONFIGURED);
          const result = await this.devices.tef.call(request.lib, request.method, request.args);
          return { id, ok: true, result: { value: result ?? null } };
        }
        default:
          return { id, ok: false, code: 'unknown_command', error: 'Comando não permitido.' };
      }
    } catch (error) {
      return { id, ok: false, code: 'device', error: (error as Error).message };
    }
  }
}
