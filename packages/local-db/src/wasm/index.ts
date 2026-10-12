import type { SqlDriver } from '@bipae/platform';

/**
 * Browser driver: talks to the SQLite WASM worker. One worker per open database.
 * Used by Bipaê Online, and by the desktop UI when it runs outside Tauri (dev/E2E).
 */
export async function openWasmDatabase(name: string): Promise<SqlDriver> {
  const worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), { type: 'module' });
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(event.data.id);
    if (!p) return;
    pending.delete(event.data.id);
    if (event.data.error !== undefined) p.reject(new Error(event.data.error));
    else p.resolve(event.data.result);
  };
  const call = <T>(message: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...message, id });
    });

  const { persistent } = await call<{ persistent: boolean }>({ op: 'open', name });
  return {
    persistent,
    run: (sql, params = []) => call<Record<string, unknown>[]>({ op: 'run', sql, params }),
    exec: (sql) => call<void>({ op: 'exec', sql }),
    close: async () => {
      await call({ op: 'close' });
      worker.terminate();
    },
  };
}
