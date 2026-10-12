import { isTauri } from '@tauri-apps/api/core';
import { openWasmDatabase } from '@bipae/local-db/wasm';
import { openNativeDatabase } from './sqlite';
import {
  baselineCapabilities,
  implementedCapabilities,
  type NotificationPort,
  type Platform,
  type PreferencesPort,
} from '@bipae/platform';

/**
 * Bipaê Desktop: implementations of the platform ports for the Tauri shell (ADR-0012).
 * Native drivers (ESC/POS printer, scale, drawer, TEF, A1/A3 signing, signed auto-update)
 * arrive in Phases 2–3 as Tauri commands; until then they are reported as "coming soon".
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

export async function createDesktopPlatform(): Promise<Platform> {
  let version = __APP_VERSION__;
  if (isTauri()) {
    const { getVersion } = await import('@tauri-apps/api/app');
    version = await getVersion();
  }
  return {
    kind: 'desktop',
    version,
    preferences: new WebViewPreferences(),
    // Native SQLite inside the app; the WASM driver only when the UI runs outside Tauri (dev/E2E).
    openLocalDatabase: isTauri() ? openNativeDatabase : openWasmDatabase,
    capabilities: async () =>
      implementedCapabilities(
        baselineCapabilities('desktop', { connectorPaired: false, webSerial: false }),
        ['storage', 'notifications'],
      ),
    notifications: new WebViewNotifications(),
  };
}
