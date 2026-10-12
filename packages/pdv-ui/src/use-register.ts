import { createStorage, getMeta, migrateLocal, setMeta, type LocalStorage } from '@bipae/local-db';
import { PdvService, type Session } from '@bipae/pdv-core';
import type { Platform } from '@bipae/platform';
import { SyncClient, type SyncStatus } from '@bipae/sync';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosBackend, PosUser, TerminalContext } from './backend';

export const TERMINAL_KEY = 'bipae.terminalId';
const CONTEXT_META = 'terminal_context';
const SYNC_INTERVAL_MS = 30_000;

let dbLock: Promise<void> = Promise.resolve();

export interface RegisterHandle {
  pdv: PdvService;
  sync: SyncClient;
  storage: LocalStorage;
  context: TerminalContext;
  persistent: boolean;
}

type State =
  | { phase: 'loading' }
  | { phase: 'needs-terminal' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; handle: RegisterHandle };

/**
 * Boots the register for this device: linked terminal → local database → cached context
 * (so receipts print offline) → background sync every 30 s and whenever the network returns.
 */
export function useRegister(platform: Platform, backend: PosBackend, user: PosUser) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const handleRef = useRef<RegisterHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stopSync = () => {};
    let opened: LocalStorage | null = null;
    // Only one open connection per device at a time: the browser's OPFS files allow a single
    // owner, and React may mount twice (StrictMode) or the terminal may be re-linked.
    let release!: () => void;
    const previous = dbLock;
    dbLock = new Promise<void>((resolve) => (release = resolve));
    const closeAndRelease = () => {
      const storage = opened;
      opened = null;
      void (storage ? storage.close().catch(() => undefined) : Promise.resolve()).finally(release);
    };

    (async () => {
      await previous;
      if (cancelled) return closeAndRelease();
      const terminalId = await platform.preferences.get(TERMINAL_KEY);
      if (!terminalId) {
        closeAndRelease();
        return setState({ phase: 'needs-terminal' });
      }
      if (!platform.openLocalDatabase) {
        closeAndRelease();
        return setState({ phase: 'error', message: 'Este aparelho não tem banco local para o caixa.' });
      }
      const driver = await platform.openLocalDatabase(`pdv-${user.tenantId}-${terminalId}.db`);
      const storage = createStorage(driver);
      opened = storage;
      if (cancelled) return closeAndRelease();
      await migrateLocal(storage);

      let context: TerminalContext;
      try {
        context = await backend.terminalContext(terminalId);
        await setMeta(storage, CONTEXT_META, JSON.stringify(context));
      } catch (error) {
        const cached = await getMeta(storage, CONTEXT_META);
        if (!cached) throw error;
        context = JSON.parse(cached) as TerminalContext;
      }
      if (context.terminal.status === 'revoked') {
        await platform.preferences.remove(TERMINAL_KEY);
        return setState({ phase: 'needs-terminal' });
      }

      const pdv = new PdvService(storage, { terminalId, operatorId: user.id });
      const sync = new SyncClient(storage, pdv, backend, terminalId);
      const handle = { pdv, sync, storage, context, persistent: driver.persistent };
      handleRef.current = handle;
      const off = sync.onChange(setSyncStatus);
      const run = () => void sync.sync();
      const timer = setInterval(run, SYNC_INTERVAL_MS);
      window.addEventListener('online', run);
      stopSync = () => {
        off();
        clearInterval(timer);
        window.removeEventListener('online', run);
      };
      // First boot on this device: download the catalog before the first scan.
      if ((await pdv.catalogSize()) === 0) await sync.sync();
      if (cancelled) return stopSync();
      setSession(await pdv.currentSession());
      setSyncStatus(await sync.status());
      setState({ phase: 'ready', handle });
      run();
    })().catch((error: Error) => {
      closeAndRelease();
      if (!cancelled) setState({ phase: 'error', message: error.message });
    });
    return () => {
      cancelled = true;
      stopSync();
      handleRef.current = null;
      // If still opening, the async flow closes it as soon as it notices `cancelled`.
      if (opened) closeAndRelease();
    };
  }, [platform, backend, user.id, user.tenantId, attempt]);

  const linkTerminal = useCallback(
    async (terminalId: string) => {
      await platform.preferences.set(TERMINAL_KEY, terminalId);
      setState({ phase: 'loading' });
      setAttempt((a) => a + 1);
    },
    [platform],
  );

  const refreshSession = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) setSession(await handle.pdv.currentSession());
  }, []);

  const syncNow = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) await handle.sync.sync();
  }, []);

  return { state, session, syncStatus, linkTerminal, refreshSession, syncNow, retry: () => setAttempt((a) => a + 1) };
}
