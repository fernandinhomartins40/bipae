import { invoke, isTauri } from '@tauri-apps/api/core';
import { openWasmDatabase } from '@bipae/local-db/wasm';
import {
  baselineCapabilities,
  browserBarcodeCamera,
  supportsBarcodeCamera,
  implementedCapabilities,
  LocalCertificateStore,
  SaleInProgressError,
  type CapabilityName,
  type CapabilityStatus,
  type DeviceConfig,
  type DeviceManager,
  type NotificationPort,
  type Platform,
  type PreferencesPort,
  type PrintJob,
  type UpdateInfo,
  type UpdaterPort,
} from '@bipae/platform';
import { indexedDbStore } from '@bipae/platform/indexeddb';
import { openNativeDatabase } from './sqlite';

/**
 * Bipaê Desktop: implementations of the platform ports for the Tauri shell (ADR-0012).
 * Outside Tauri (dev server, E2E in Chromium) native features report "coming soon" honestly
 * and the local database falls back to SQLite WASM.
 */

/** WebView storage persists inside the app's data folder, separate from any browser. */
class WebViewPreferences implements PreferencesPort {
  async get(key: string) {
    return localStorage.getItem(key);
  }
  async set(key: string, value: string) {
    localStorage.setItem(key, value);
  }
  async remove(key: string) {
    localStorage.removeItem(key);
  }
}

class WebViewNotifications implements NotificationPort {
  async notify(title: string, body: string) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body });
  }
}

/** Config lives in the app data folder (Rust), so the Conector uses the same devices. */
const nativeDevices: DeviceManager = {
  listSerialPorts: () => invoke<string[]>('devices_list_ports'),
  listPrinters: () => invoke<string[]>('devices_list_printers'),
  getConfig: () => invoke<DeviceConfig>('devices_get_config'),
  setConfig: (config) => invoke<void>('devices_set_config', { config }),
};

/**
 * Signed auto-update (only in release builds compiled with the updater feature).
 * Never installs during a sale; pending sales stay in the local database, which lives
 * outside the app bundle, so an update never loses them.
 */
class TauriUpdater implements UpdaterPort {
  private pending: { version: string; downloadAndInstall: () => Promise<void> } | null = null;
  async check(): Promise<UpdateInfo | null> {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      this.pending = update;
      return update
        ? { version: update.version, channel: 'stable', ...(update.body && { notes: update.body }) }
        : null;
    } catch {
      return null; // offline or no release server yet
    }
  }
  async install(context: { saleInProgress: boolean }) {
    if (context.saleInProgress) throw new SaleInProgressError();
    if (!this.pending) return;
    await this.pending.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  }
}

export async function createDesktopPlatform(): Promise<Platform> {
  const native = isTauri();
  let version = __APP_VERSION__;
  let updaterBuilt = false;
  if (native) {
    const { getVersion } = await import('@tauri-apps/api/app');
    version = await getVersion();
    updaterBuilt = (await invoke<{ updater: boolean }>('platform_info')).updater;
  }

  // Certificado A1 instalado neste computador, para assinar sem internet (F3-21).
  const certificate = new LocalCertificateStore(indexedDbStore());

  const capabilities = async (): Promise<Record<CapabilityName, CapabilityStatus>> => {
    const implemented: CapabilityName[] = ['storage', 'notifications', 'certificateA1'];
    if (native) implemented.push('printer', 'cashDrawer', 'scale');
    if (updaterBuilt) implemented.push('updater');
    // No Android (ADR-0017) o WebView lê código pela câmera; no Windows, ainda não.
    const camera = supportsBarcodeCamera();
    if (camera) implemented.push('barcodeCamera');
    const caps = implementedCapabilities(
      baselineCapabilities('desktop', { connectorPaired: false, webSerial: false, camera }),
      implemented,
    );
    if (!(await certificate.info()))
      caps.certificateA1 = { available: false, reason: 'not-configured' };
    if (native) {
      const config = await nativeDevices.getConfig();
      const notConfigured: CapabilityStatus = { available: false, reason: 'not-configured' };
      if (!config.printer) caps.printer = notConfigured;
      if (!config.printer || config.drawerViaPrinter === false) caps.cashDrawer = notConfigured;
      if (!config.scale) caps.scale = notConfigured;
    }
    return caps;
  };

  return {
    kind: 'desktop',
    version,
    preferences: new WebViewPreferences(),
    // Native SQLite inside the app; the WASM driver only when the UI runs outside Tauri (dev/E2E).
    openLocalDatabase: native ? openNativeDatabase : openWasmDatabase,
    capabilities,
    certificate,
    notifications: new WebViewNotifications(),
    barcodeCamera: browserBarcodeCamera(),
    ...(native && {
      // Abre no navegador do sistema (plugin opener do Tauri, liberado só para https).
      openExternal: async (url: string) => {
        if (!/^https:\/\//i.test(url)) throw new Error('Só abrimos links seguros (https).');
        await invoke('plugin:opener|open_url', { url });
      },
      devices: nativeDevices,
      printer: {
        print: async (job: PrintJob) => {
          if (job.kind !== 'escpos') throw new Error('A impressora térmica imprime ESC/POS.');
          await invoke('devices_print', { data: Array.from(job.data as Uint8Array) });
        },
      },
      cashDrawer: { open: () => invoke<void>('devices_open_drawer') },
      scale: {
        read: async () => ({ grams: await invoke<number>('devices_read_scale'), stable: true }),
      },
      connectorHost: {
        status: () =>
          invoke<{
            running: boolean;
            port: number;
            code: string;
            clients: { id: string; name: string }[];
          }>('connector_status'),
        newCode: () => invoke<string>('connector_new_code'),
        revoke: (id: string) => invoke<void>('connector_revoke', { id }),
        autostart: {
          isEnabled: () => invoke<boolean>('plugin:autostart|is_enabled'),
          setEnabled: (enabled: boolean) =>
            invoke<void>(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable'),
        },
      },
    }),
    ...(updaterBuilt && { updater: new TauriUpdater() }),
  };
}
