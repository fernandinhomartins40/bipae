import type { KeyValueStore } from './certificate-store';

/**
 * Guarda as chaves no IndexedDB do aparelho (navegador e desktop). O IndexedDB guarda a chave da
 * WebCrypto como objeto, sem expor o conteúdo dela.
 */
export function indexedDbStore(dbName = 'bipae-certificados', storeName = 'kv'): KeyValueStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = action(db.transaction(storeName, mode).objectStore(storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (key) => run('readonly', (store) => store.get(key)),
    set: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key));
    },
    delete: async (key) => {
      await run('readwrite', (store) => store.delete(key));
    },
  };
}
