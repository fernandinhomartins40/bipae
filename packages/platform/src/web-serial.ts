import type { PreferencesPort, ScalePort, ScaleReading } from './ports';

/**
 * Balança direto no navegador pela Web Serial (F2-06), sem o Bipaê Conector. Funciona no Chrome
 * e no Edge do computador; a pessoa escolhe a porta uma vez (o navegador lembra a permissão).
 * Este arquivo só move bytes: o pedido e a leitura do peso vêm do protocolo em @bipae/pdv-core.
 */

/** O mínimo da Web Serial que o Bipaê usa (os tipos completos não vêm no TypeScript padrão). */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: object): Promise<SerialPortLike>;
}

export interface WebSerialScaleOptions {
  /** Bytes enviados para pedir o peso (ENQ nas balanças Toledo e Filizola). */
  request: Uint8Array;
  /** Lê a resposta; lança erro com mensagem em português quando não há peso válido. */
  parse: (bytes: Uint8Array) => ScaleReading;
  /** A resposta terminou? (ETX depois do STX, por exemplo.) */
  complete: (bytes: Uint8Array) => boolean;
  timeoutMs?: number;
  serial?: SerialLike | null;
}

export const WEB_SERIAL_SCALE_KEY = 'bipae.webSerialScale';

const browserSerial = (): SerialLike | null =>
  typeof navigator !== 'undefined' && 'serial' in navigator
    ? ((navigator as unknown as { serial: SerialLike }).serial ?? null)
    : null;

export class WebSerialScale implements ScalePort {
  private readonly serial: SerialLike | null;

  constructor(
    private readonly preferences: PreferencesPort,
    private readonly options: WebSerialScaleOptions,
  ) {
    this.serial = options.serial === undefined ? browserSerial() : options.serial;
  }

  /** O navegador tem Web Serial? */
  get supported(): boolean {
    return this.serial !== null;
  }

  private async config(): Promise<{ baudRate: number } | null> {
    const raw = await this.preferences.get(WEB_SERIAL_SCALE_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as { baudRate?: unknown };
      return typeof value.baudRate === 'number' ? { baudRate: value.baudRate } : null;
    } catch {
      return null;
    }
  }

  /** Já tem porta autorizada e velocidade guardada? */
  async isPaired(): Promise<boolean> {
    if (!this.serial || !(await this.config())) return false;
    return (await this.serial.getPorts()).length > 0;
  }

  /** Abre a janela do navegador para escolher a porta (precisa ser num clique). */
  async pair(baudRate: number): Promise<void> {
    if (!this.serial)
      throw new Error('Este navegador não acessa portas seriais. Use o Chrome ou o Edge.');
    await this.serial.requestPort();
    await this.preferences.set(WEB_SERIAL_SCALE_KEY, JSON.stringify({ baudRate }));
  }

  async forget(): Promise<void> {
    await this.preferences.remove(WEB_SERIAL_SCALE_KEY);
  }

  async read(): Promise<ScaleReading> {
    const config = await this.config();
    const [port] = this.serial ? await this.serial.getPorts() : [];
    if (!config || !port) {
      throw new Error('Escolha a porta da balança em Configurações → Periféricos.');
    }
    await port.open({ baudRate: config.baudRate });
    try {
      const writer = port.writable!.getWriter();
      await writer.write(this.options.request);
      writer.releaseLock();
      const bytes = await this.readUntilComplete(port);
      return this.options.parse(bytes);
    } finally {
      await port.close().catch(() => undefined);
    }
  }

  private async readUntilComplete(port: SerialPortLike): Promise<Uint8Array> {
    const reader = port.readable!.getReader();
    const chunks: number[] = [];
    const timeout = this.options.timeoutMs ?? 2000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeout);
    });
    try {
      for (;;) {
        const next = await Promise.race([reader.read(), expired]);
        if (next === 'timeout') {
          await reader.cancel().catch(() => undefined);
          throw new Error('A balança não respondeu. Confira o cabo, a porta e a velocidade.');
        }
        if (next.done) break;
        chunks.push(...next.value);
        const bytes = Uint8Array.from(chunks);
        if (this.options.complete(bytes)) return bytes;
      }
      return Uint8Array.from(chunks);
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
}
