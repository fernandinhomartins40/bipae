import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { getMeta, setMeta, type LocalStorage } from '@bipae/local-db';
import type { PdvService } from '@bipae/pdv-core';

/**
 * Terminal ↔ server synchronization (ADR-0004). Same code on web and desktop;
 * only the transport (HTTP client) is injected.
 */
export interface SyncTransport {
  push(terminalId: string, events: TerminalEvent[]): Promise<SyncPushResult>;
  /** `pricingVersion`: o retrato de preços que o caixa tem; o servidor só reenvia quando muda. */
  pull(
    cursor: string | null,
    limit: number,
    pricingVersion: string | null,
    /** `fiscalVersion`: o retrato fiscal que o caixa tem (F3-06). */
    fiscalVersion?: string | null,
  ): Promise<SyncPullResult>;
}

export interface SyncStatus {
  pending: number;
  rejected: number;
  lastSyncAt: string | null;
  lastError: string | null;
  syncing: boolean;
}

const CURSOR_KEY = 'catalog_cursor';
const PRICING_KEY = 'pricing_version';
const FISCAL_KEY = 'fiscal_version';
const LAST_SYNC_KEY = 'last_sync_at';
const BATCH = 100;

/** O servidor recebeu o lote mas parou num evento: a conexão está boa, o problema é o dado. */
class PartialPushError extends Error {}

export class SyncClient {
  private running: Promise<SyncStatus> | null = null;
  private lastError: string | null = null;
  private listeners = new Set<(status: SyncStatus) => void>();

  constructor(
    private readonly storage: LocalStorage,
    private readonly pdv: PdvService,
    private readonly transport: SyncTransport,
    private readonly terminalId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onChange(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async status(): Promise<SyncStatus> {
    return {
      pending: await this.pdv.pendingCount(),
      rejected: (await this.pdv.rejectedEvents()).length,
      lastSyncAt: await getMeta(this.storage, LAST_SYNC_KEY),
      lastError: this.lastError,
      syncing: this.running !== null,
    };
  }

  /** Push pending events, then pull catalog changes. Concurrent calls share one run. */
  sync(): Promise<SyncStatus> {
    this.running ??= (async () => {
      this.emit(await this.status());
      try {
        // Um envio que o servidor processou só em parte (evento travado) não pode deixar o caixa
        // sem preços e catálogo novos (PIE R3-01): recebe mesmo assim e depois avisa. Sem rede, o
        // envio falha antes de chegar ao servidor e nada muda: sai na hora, como sempre.
        let pushError: unknown = null;
        try {
          await this.pushAll();
        } catch (error) {
          if (!(error instanceof PartialPushError)) throw error;
          pushError = error;
        }
        try {
          await this.pullAll();
        } catch (error) {
          throw pushError ?? error;
        }
        if (pushError) throw pushError;
        this.lastError = null;
        await setMeta(this.storage, LAST_SYNC_KEY, this.now().toISOString());
      } catch (error) {
        this.lastError = (error as Error).message;
      } finally {
        this.running = null;
      }
      const status = await this.status();
      this.emit(status);
      return status;
    })();
    return this.running;
  }

  private emit(status: SyncStatus) {
    for (const l of this.listeners) l(status);
  }

  private async pushAll() {
    for (;;) {
      const events = await this.pdv.pendingEvents(BATCH);
      if (events.length === 0) return;
      const result = await this.transport.push(this.terminalId, events);
      await this.pdv.markSent(result.accepted);
      await this.pdv.markRejected(result.rejected);
      const handled = result.accepted.length + result.rejected.length;
      // The server stops at the first transient failure; retry later instead of looping.
      if (handled < events.length) {
        throw new PartialPushError(
          'O servidor não conseguiu processar todas as vendas agora. Tentaremos de novo.',
        );
      }
    }
  }

  private async pullAll() {
    let cursor = await getMeta(this.storage, CURSOR_KEY);
    let pricingVersion = await getMeta(this.storage, PRICING_KEY);
    let fiscalVersion = await getMeta(this.storage, FISCAL_KEY);
    for (;;) {
      const page = await this.transport.pull(cursor, 500, pricingVersion, fiscalVersion);
      if (page.products.length > 0) await this.pdv.applyCatalog(page.products);
      if (page.pricing) {
        await this.pdv.applyPricing(page.pricing);
        pricingVersion = page.pricing.version;
        await setMeta(this.storage, PRICING_KEY, pricingVersion);
      }
      if (page.fiscal) {
        await this.pdv.applyFiscal(page.fiscal);
        fiscalVersion = page.fiscal.version;
        await setMeta(this.storage, FISCAL_KEY, fiscalVersion);
      }
      // Pedidos do garçom (F5-08): entram nas comandas deste caixa.
      if (page.tabOrders?.length) await this.pdv.applyTabOrders(page.tabOrders);
      if (page.cursor) {
        cursor = page.cursor;
        await setMeta(this.storage, CURSOR_KEY, cursor);
      }
      if (!page.hasMore) return;
    }
  }
}

/** "há 3 min", "agora" — for the register's sync indicator. */
export function describeLastSync(lastSyncAt: string | null, now: Date = new Date()): string {
  if (!lastSyncAt) return 'ainda não sincronizado';
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(lastSyncAt).getTime()) / 1000));
  if (seconds < 60) return 'sincronizado agora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `sincronizado há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `sincronizado há ${hours} h`;
  return `sincronizado há ${Math.round(hours / 24)} dias`;
}
