import {
  CONNECTOR_URL,
  toBase64,
  type ConnectorRequest,
  type ConnectorResponse,
} from './connector';
import type {
  CashDrawerPort,
  CertificateInfo,
  CertificatePort,
  PreferencesPort,
  PrinterPort,
  PrintJob,
  ScalePort,
} from './ports';

/** Minimal socket surface (browser WebSocket or a test double). */
export interface ConnectorSocket {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => Promise<ConnectorSocket>;

/** Opens a browser WebSocket, rejecting when nothing is listening (Conector not installed). */
export const browserSocket: SocketFactory = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws as unknown as ConnectorSocket);
    ws.onerror = () => reject(new Error('O Bipaê Conector não está aberto neste computador.'));
  });

const TOKEN_KEY = 'bipae.connectorToken';

type Request = ConnectorRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, 'id'>
    : never
  : never;

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Talks to the Bipaê Conector from the web register. Reconnects on demand and
 * authenticates with the stored pairing token.
 */
export class ConnectorClient implements PrinterPort, CashDrawerPort, ScalePort, CertificatePort {
  private socket: ConnectorSocket | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, (r: ConnectorResponse) => void>();

  constructor(
    private readonly preferences: PreferencesPort,
    private readonly connect: SocketFactory = browserSocket,
    private readonly url = CONNECTOR_URL,
    private readonly timeoutMs = 8000,
  ) {}

  async isPaired(): Promise<boolean> {
    return (await this.preferences.get(TOKEN_KEY)) !== null;
  }

  async pair(code: string, clientName: string): Promise<void> {
    const response = await this.call({ type: 'pair', code: code.trim(), clientName }, false);
    await this.preferences.set(TOKEN_KEY, (response as { token: string }).token);
  }

  async unpair() {
    await this.preferences.remove(TOKEN_KEY);
    this.socket?.close();
    this.socket = null;
  }

  async print(job: PrintJob): Promise<void> {
    if (job.kind !== 'escpos') throw new Error('O Conector imprime ESC/POS.');
    await this.call({ type: 'print', data: toBase64(job.data as Uint8Array) });
  }

  async open(): Promise<void> {
    await this.call({ type: 'drawer' });
  }

  async read() {
    const { grams } = (await this.call({ type: 'scale' })) as { grams: number };
    return { grams, stable: true };
  }

  async listPorts(): Promise<string[]> {
    return ((await this.call({ type: 'ports' })) as { ports: string[] }).ports;
  }

  /** Certificado A3 do computador do Conector (F3-21.b); null quando não há token inserido. */
  async info(): Promise<CertificateInfo | null> {
    const { info } = (await this.call({ type: 'cert-info' })) as {
      info: Omit<CertificateInfo, 'kind'> | null;
    };
    return info ? { ...info, kind: 'A3' } : null;
  }

  async certificate(): Promise<string | null> {
    const { certificate } = (await this.call({ type: 'cert-certificate' })) as {
      certificate: string | null;
    };
    return certificate;
  }

  async sign(data: Uint8Array, algorithm: 'RSA-SHA1' | 'RSA-SHA256'): Promise<string> {
    const { signature } = (await this.call({
      type: 'cert-sign',
      data: toBase64(data),
      algorithm,
    })) as { signature: string };
    return signature;
  }

  private async ensureSocket(authenticate: boolean): Promise<ConnectorSocket> {
    if (this.socket) return this.socket;
    const socket = await this.connect(this.url);
    socket.onmessage = (event) => {
      const response = JSON.parse(event.data) as ConnectorResponse;
      this.pending.get(response.id)?.(response);
      this.pending.delete(response.id);
    };
    socket.onclose = () => {
      this.socket = null;
      for (const [id, resolve] of this.pending) {
        resolve({ id, ok: false, code: 'device', error: 'A conexão com o Bipaê Conector caiu.' });
      }
      this.pending.clear();
    };
    this.socket = socket;
    if (authenticate) {
      const token = await this.preferences.get(TOKEN_KEY);
      if (!token)
        throw new ConnectorError(
          'Pareie este navegador com o Bipaê Conector primeiro.',
          'unpaired',
        );
      await this.send({ type: 'auth', token });
    }
    return socket;
  }

  private async call(request: Request, authenticate = true): Promise<unknown> {
    await this.ensureSocket(authenticate);
    return this.send(request);
  }

  private send(request: Request): Promise<unknown> {
    const socket = this.socket!;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new ConnectorError('O Bipaê Conector não respondeu.', 'timeout'));
        },
        request.type === 'cert-sign' ? Math.max(this.timeoutMs, 60_000) : this.timeoutMs,
      ); // dá tempo de digitar o PIN
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.ok) resolve(response.result);
        else {
          if (response.code === 'unpaired') void this.preferences.remove(TOKEN_KEY);
          reject(new ConnectorError(response.error, response.code));
        }
      });
      socket.send(JSON.stringify({ ...request, id }));
    });
  }
}
