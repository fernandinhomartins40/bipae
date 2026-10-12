/**
 * Platform ports (ADR-0012). Everything that differs between Bipaê Online (web) and
 * Bipaê Desktop lives behind these interfaces. Screens and business rules only see the ports.
 */

export type PlatformKind = 'web' | 'desktop';

/** How a capability is provided on the current platform. */
export type CapabilityStatus =
  | { available: true; via: 'native' | 'browser' | 'connector' | 'server' }
  | { available: false; reason: CapabilityGap };

/** Why a capability is missing — maps to a user-facing explanation and fix. */
export type CapabilityGap = 'needs-connector' | 'browser-unsupported' | 'not-configured' | 'offline';

export type CapabilityName =
  | 'storage'
  | 'printer'
  | 'cashDrawer'
  | 'scale'
  | 'tef'
  | 'certificateA1'
  | 'certificateA3'
  | 'updater'
  | 'notifications';

/** Local SQL storage (SQLite native on desktop, SQLite WASM on web — ADR-0004). */
export interface StoragePort {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Omit<StoragePort, 'transaction'>) => Promise<T>): Promise<T>;
}

/** Small persistent preferences (session, last store, theme). Not for business data. */
export interface PreferencesPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PrintJob {
  /** Raw ESC/POS bytes, or plain text lines for browser printing. */
  kind: 'escpos' | 'text';
  data: Uint8Array | string[];
}

export interface PrinterPort {
  print(job: PrintJob): Promise<void>;
}

export interface CashDrawerPort {
  open(): Promise<void>;
}

export interface ScaleReading {
  /** Weight in grams, integer. */
  grams: number;
  stable: boolean;
}

export interface ScalePort {
  read(): Promise<ScaleReading>;
}

export interface TefRequest {
  amountCents: number;
  method: 'credit' | 'debit' | 'voucher' | 'pix';
  installments?: number;
  saleId: string;
}

export interface TefResult {
  approved: boolean;
  nsu?: string;
  authorizationCode?: string;
  acquirer?: string;
  message: string;
}

export interface TefPort {
  pay(request: TefRequest): Promise<TefResult>;
  cancel(nsu: string): Promise<TefResult>;
}

export interface CertificateInfo {
  subject: string;
  taxId: string;
  notAfter: string;
  kind: 'A1' | 'A3';
}

export interface CertificatePort {
  info(): Promise<CertificateInfo | null>;
  /** Signs the SHA-1/SHA-256 digest input per the fiscal manual; returns base64 signature. */
  sign(data: Uint8Array, algorithm: 'RSA-SHA1' | 'RSA-SHA256'): Promise<string>;
}

export interface UpdateInfo {
  version: string;
  channel: 'stable' | 'beta';
  notes?: string;
}

export interface UpdaterPort {
  check(): Promise<UpdateInfo | null>;
  /**
   * Installs a pending update. Implementations MUST refuse while a sale is in progress;
   * callers pass the current state so the rule is enforced in one place.
   */
  install(context: { saleInProgress: boolean }): Promise<void>;
}

export interface NotificationPort {
  notify(title: string, body: string): Promise<void>;
}

export interface Platform {
  kind: PlatformKind;
  version: string;
  preferences: PreferencesPort;
  capabilities(): Promise<Record<CapabilityName, CapabilityStatus>>;
  storage?: StoragePort;
  printer?: PrinterPort;
  cashDrawer?: CashDrawerPort;
  scale?: ScalePort;
  tef?: TefPort;
  certificate?: CertificatePort;
  updater?: UpdaterPort;
  notifications?: NotificationPort;
}

export class SaleInProgressError extends Error {
  constructor() {
    super('A atualização será instalada quando não houver venda em andamento.');
    this.name = 'SaleInProgressError';
  }
}
