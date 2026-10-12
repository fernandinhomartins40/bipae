import {
  baselineCapabilities,
  implementedCapabilities,
  SaleInProgressError,
  type NotificationPort,
  type Platform,
  type PreferencesPort,
  type PrinterPort,
  type PrintJob,
  type UpdaterPort,
} from '@bipae/platform';

/** Bipaê Online: implementations of the platform ports for the browser (ADR-0012). */

class LocalStoragePreferences implements PreferencesPort {
  async get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or blocked storage: session just won't survive a reload.
    }
  }
  async remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      // see set()
    }
  }
}

/** Without the Bipaê Conector, receipts go through the browser print dialog. */
class BrowserPrinter implements PrinterPort {
  async print(job: PrintJob) {
    if (job.kind !== 'text') {
      throw new Error('Impressão ESC/POS no navegador precisa do Bipaê Conector.');
    }
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const pre = doc.createElement('pre');
    pre.style.font = '12px/1.3 monospace';
    pre.style.width = '80mm';
    pre.textContent = (job.data as string[]).join('\n');
    doc.body.appendChild(pre);
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }
}

class BrowserNotifications implements NotificationPort {
  async notify(title: string, body: string) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body, icon: '/icon.svg' });
  }
}

/** New versions are applied on reload, and never during a sale. */
class ServiceWorkerUpdater implements UpdaterPort {
  constructor(
    private readonly applyUpdate: () => Promise<void>,
    private readonly waiting: () => boolean,
  ) {}
  async check() {
    return this.waiting() ? { version: 'nova', channel: 'stable' as const } : null;
  }
  async install(context: { saleInProgress: boolean }) {
    if (context.saleInProgress) throw new SaleInProgressError();
    await this.applyUpdate();
  }
}

export function createWebPlatform(updates: {
  applyUpdate: () => Promise<void>;
  waiting: () => boolean;
}): Platform {
  return {
    kind: 'web',
    version: __APP_VERSION__,
    preferences: new LocalStoragePreferences(),
    // Only what is built is reported as available (local SQLite, WebSerial scale and the
    // Conector arrive in Phase 2). The Conector is not paired yet, so peripherals ask for it.
    capabilities: async () =>
      implementedCapabilities(
        baselineCapabilities('web', {
          connectorPaired: false,
          webSerial: typeof navigator !== 'undefined' && 'serial' in navigator,
        }),
        ['printer', 'certificateA1', 'updater', 'notifications'],
      ),
    printer: new BrowserPrinter(),
    notifications: new BrowserNotifications(),
    updater: new ServiceWorkerUpdater(updates.applyUpdate, updates.waiting),
  };
}
