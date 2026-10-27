import type { TefConfig } from './tef/config';

/**
 * Peripheral configuration for a register, stored per device in preferences.
 * Thermal printers are reached by serial port or network (raw TCP, usually port 9100);
 * scales by serial port. USB printers usually expose a virtual serial port.
 */
export type PrinterConfig =
  | { transport: 'serial'; port: string; baudRate: number; columns: 32 | 42 | 48; codePage: number }
  | { transport: 'tcp'; host: string; port: number; columns: 32 | 42 | 48; codePage: number }
  /** Impressora instalada no Windows (USB), pelo spooler em modo RAW (F2-07). */
  | { transport: 'spooler'; printerName: string; columns: 32 | 42 | 48; codePage: number };

export interface ScaleConfig {
  port: string;
  baudRate: number;
}

export interface DeviceConfig {
  printer?: PrinterConfig;
  scale?: ScaleConfig;
  /** TEF com pinpad neste computador (F8-11). */
  tef?: TefConfig;
  /** Kick the cash drawer through the printer after cash sales. */
  drawerViaPrinter?: boolean;
}

export const DEVICES_KEY = 'bipae.devices';

export function parseDeviceConfig(raw: string | null): DeviceConfig {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as DeviceConfig;
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

/** Device management a shell may offer (desktop natively; web through the Conector). */
export interface DeviceManager {
  listSerialPorts(): Promise<string[]>;
  /** Impressoras instaladas no Windows (F2-07); ausente onde não há spooler. */
  listPrinters?(): Promise<string[]>;
  getConfig(): Promise<DeviceConfig>;
  setConfig(config: DeviceConfig): Promise<void>;
}
