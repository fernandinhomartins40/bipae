import { baselineCapabilities } from './capabilities';
import { toBase64, type A3Token } from './connector';
import {
  SaleInProgressError,
  type BarcodeCameraPort,
  type CameraVideo,
  type CashDrawerPort,
  type NotificationPort,
  type Platform,
  type PlatformKind,
  type PreferencesPort,
  type PrinterPort,
  type PrintJob,
  type ScalePort,
  type ScaleReading,
  type TefPort,
  type TefRequest,
  type TefResult,
  type UpdateInfo,
  type UpdaterPort,
} from './ports';

/** Simulators for development, tests and demos. Never used in production builds. */

export class MemoryPreferences implements PreferencesPort {
  private readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

/**
 * Token A3 de teste (F3-21.b): chave RSA gerada na memória, que assina de verdade mas nunca
 * sai daqui, como num token. Não vale como certificado: serve ao Conector simulado e aos testes.
 */
export class SimulatedA3Token implements A3Token {
  inserted = true;
  /** Quantas assinaturas foram feitas (a chave de verdade nunca é exposta). */
  signed = 0;

  constructor(
    private readonly holder = {
      subject: 'EMPRESA SIMULADA LTDA:00000000000191',
      taxId: '00000000000191',
    },
    private readonly notAfter = '2099-12-31T23:59:59Z',
  ) {}

  private pair(hash: 'SHA-1' | 'SHA-256') {
    // uma chave por hash: no WebCrypto o hash faz parte da chave
    return crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash,
      },
      false,
      ['sign', 'verify'],
    );
  }
  private readonly byHash = new Map<string, Promise<CryptoKeyPair>>();
  keyPair(hash: 'SHA-1' | 'SHA-256') {
    let pair = this.byHash.get(hash);
    if (!pair) {
      pair = this.pair(hash) as Promise<CryptoKeyPair>;
      this.byHash.set(hash, pair);
    }
    return pair;
  }

  async info() {
    return this.inserted ? { ...this.holder, notAfter: this.notAfter } : null;
  }
  async certificate() {
    return this.inserted ? toBase64(new TextEncoder().encode('certificado-simulado')) : null;
  }
  async sign(data: Uint8Array, algorithm: 'RSA-SHA1' | 'RSA-SHA256') {
    if (!this.inserted) throw new Error('Insira o token ou o cartão A3 no leitor.');
    const { privateKey } = await this.keyPair(algorithm === 'RSA-SHA1' ? 'SHA-1' : 'SHA-256');
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      data as BufferSource,
    );
    this.signed++;
    return toBase64(new Uint8Array(signature));
  }
}

export class SimulatedPrinter implements PrinterPort {
  readonly jobs: PrintJob[] = [];
  async print(job: PrintJob) {
    this.jobs.push(job);
  }
}

export class SimulatedCashDrawer implements CashDrawerPort {
  opened = 0;
  async open() {
    this.opened++;
  }
}

export class SimulatedScale implements ScalePort {
  constructor(private reading: ScaleReading = { grams: 0, stable: true }) {}
  place(grams: number, stable = true) {
    if (!Number.isInteger(grams) || grams < 0) throw new RangeError('Peso inválido');
    this.reading = { grams, stable };
  }
  async read() {
    return this.reading;
  }
}

/** Approves everything except amounts ending in 13 cents, which are declined (test hook). */
export class SimulatedTef implements TefPort {
  private nsuCounter = 0;
  async pay(request: TefRequest): Promise<TefResult> {
    if (request.amountCents % 100 === 13) {
      return { approved: false, message: 'Transação negada pelo emissor (simulador)' };
    }
    const nsu = String(++this.nsuCounter).padStart(6, '0');
    return {
      approved: true,
      nsu,
      authorizationCode: `SIM${nsu}`,
      acquirer: 'Simulador',
      message: 'Aprovada',
    };
  }
  async cancel(nsu: string): Promise<TefResult> {
    return { approved: true, nsu, message: 'Cancelada' };
  }
}

export class SimulatedUpdater implements UpdaterPort {
  installed: UpdateInfo | null = null;
  constructor(private pending: UpdateInfo | null = null) {}
  async check() {
    return this.pending;
  }
  async install(context: { saleInProgress: boolean }) {
    if (context.saleInProgress) throw new SaleInProgressError();
    this.installed = this.pending;
    this.pending = null;
  }
}

/** Câmera de teste: `show(code)` faz de conta que a câmera leu o código. */
export class SimulatedBarcodeCamera implements BarcodeCameraPort {
  private listener: ((code: string) => void) | null = null;
  active = false;
  async start(_video: CameraVideo, onCode: (code: string) => void) {
    this.listener = onCode;
    this.active = true;
    return () => {
      this.listener = null;
      this.active = false;
    };
  }
  show(code: string) {
    this.listener?.(code);
  }
}

export class SimulatedNotifications implements NotificationPort {
  readonly sent: { title: string; body: string }[] = [];
  async notify(title: string, body: string) {
    this.sent.push({ title, body });
  }
}

export function createSimulatedPlatform(kind: PlatformKind = 'web'): Platform & {
  printer: SimulatedPrinter;
  cashDrawer: SimulatedCashDrawer;
  scale: SimulatedScale;
  tef: SimulatedTef;
  updater: SimulatedUpdater;
  notifications: SimulatedNotifications;
  barcodeCamera: SimulatedBarcodeCamera;
} {
  return {
    kind,
    version: '0.0.0-sim',
    preferences: new MemoryPreferences(),
    capabilities: async () =>
      baselineCapabilities(kind, {
        connectorPaired: kind === 'web',
        webSerial: false,
        camera: true,
      }),
    printer: new SimulatedPrinter(),
    cashDrawer: new SimulatedCashDrawer(),
    scale: new SimulatedScale(),
    tef: new SimulatedTef(),
    updater: new SimulatedUpdater(),
    notifications: new SimulatedNotifications(),
    barcodeCamera: new SimulatedBarcodeCamera(),
  };
}
