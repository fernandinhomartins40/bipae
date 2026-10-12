import { baselineCapabilities } from './capabilities';
import {
  SaleInProgressError,
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
} {
  return {
    kind,
    version: '0.0.0-sim',
    preferences: new MemoryPreferences(),
    capabilities: async () =>
      baselineCapabilities(kind, { connectorPaired: kind === 'web', webSerial: false }),
    printer: new SimulatedPrinter(),
    cashDrawer: new SimulatedCashDrawer(),
    scale: new SimulatedScale(),
    tef: new SimulatedTef(),
    updater: new SimulatedUpdater(),
    notifications: new SimulatedNotifications(),
  };
}
