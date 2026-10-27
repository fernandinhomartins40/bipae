import { openWasmDatabase } from '@bipae/local-db/wasm';
import {
  baselineCapabilities,
  browserBarcodeCamera,
  supportsBarcodeCamera,
  implementedCapabilities,
  LocalCertificateStore,
  ConnectorClient,
  CONNECTOR_URL,
  type CapabilityName,
  SaleInProgressError,
  type NotificationPort,
  type Platform,
  type PreferencesPort,
  type PrinterPort,
  type PrintJob,
  type UpdaterPort,
  WebSerialScale,
} from '@bipae/platform';
import { indexedDbStore } from '@bipae/platform/indexeddb';
import { parseScaleResponse, SCALE_MESSAGES, SCALE_REQUEST } from '@bipae/pdv-core';

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
    if (job.kind === 'escpos') {
      throw new Error('Impressão ESC/POS no navegador precisa do Bipaê Conector.');
    }
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    if (job.kind === 'html') {
      // HTML gerado pelo próprio Bipaê (receiptToHtml), com o texto já escapado.
      doc.body.style.margin = '0';
      doc.body.innerHTML = job.data as string;
    } else {
      const pre = doc.createElement('pre');
      pre.style.font = '12px/1.3 monospace';
      pre.style.width = '80mm';
      pre.textContent = (job.data as string[]).join('\n');
      doc.body.appendChild(pre);
    }
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }
}

class BrowserNotifications implements NotificationPort {
  async notify(title: string, body: string) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted')
      new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icon.svg` });
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
  const preferences = new LocalStoragePreferences();
  const connector = new ConnectorClient(
    preferences,
    undefined,
    import.meta.env.VITE_CONNECTOR_URL ?? CONNECTOR_URL,
  );
  const browserPrinter = new BrowserPrinter();
  // Balança direto pela Web Serial (F2-06): o protocolo é o mesmo do desktop e do Conector.
  const serialScale = new WebSerialScale(preferences, {
    request: SCALE_REQUEST,
    complete: (bytes) => {
      const stx = bytes.indexOf(0x02);
      return stx >= 0 && bytes.indexOf(0x03, stx + 1) > stx;
    },
    parse: (bytes) => {
      const result = parseScaleResponse(bytes);
      if (result.status !== 'ok') throw new Error(SCALE_MESSAGES[result.status]);
      return { grams: result.grams, stable: true };
    },
  });
  // Com o Conector pareado, a balança vai por ele; senão, pela Web Serial.
  const scale = {
    read: async () => ((await connector.isPaired()) ? connector.read() : serialScale.read()),
  };
  // Certificado A1 instalado no aparelho, para assinar sem internet (F3-21).
  const certificate = new LocalCertificateStore(indexedDbStore());

  return {
    kind: 'web',
    version: __APP_VERSION__,
    preferences,
    // Only what is built is reported as available. Printer and drawer go through the Bipaê
    // Conector; the scale also works directly through Web Serial once a port is chosen.
    capabilities: async () => {
      const paired = await connector.isPaired();
      const serialPaired = await serialScale.isPaired();
      const implemented: CapabilityName[] = [
        'storage',
        'printer',
        'certificateA1',
        'updater',
        'notifications',
      ];
      if (paired) implemented.push('cashDrawer', 'scale');
      else if (serialPaired) implemented.push('scale');
      const camera = supportsBarcodeCamera();
      if (camera) implemented.push('barcodeCamera');
      return implementedCapabilities(
        baselineCapabilities('web', { connectorPaired: paired, webSerial: serialPaired, camera }),
        implemented,
      );
    },
    openLocalDatabase: openWasmDatabase,
    certificate,
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener');
    },
    // ESC/POS goes to the thermal printer through the Conector; text uses the print dialog.
    printer: {
      print: (job: PrintJob) =>
        job.kind === 'escpos' ? connector.print(job) : browserPrinter.print(job),
    },
    cashDrawer: connector,
    scale,
    serialScale,
    connector,
    // TEF: as bibliotecas ficam no Conector pareado; sem ele, só o simulador.
    tefLibs: {
      status: async () =>
        (await connector.isPaired()) ? connector.tefStatus() : { sitef: false, paygo: false },
      libs: async () => ((await connector.isPaired()) ? connector.tefLibs() : {}),
    },
    notifications: new BrowserNotifications(),
    barcodeCamera: browserBarcodeCamera(),
    updater: new ServiceWorkerUpdater(updates.applyUpdate, updates.waiting),
  };
}
