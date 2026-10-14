/**
 * Cópia do banco local no IndexedDB (F2-05), para navegadores sem OPFS. Um registro por banco,
 * com o arquivo SQLite inteiro.
 */
const DB_NAME = 'bipae-local-db';
const STORE = 'snapshots';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB não abriu.'));
  });
}

let opened: Promise<IDBDatabase> | null = null;
const database = () => (opened ??= openStore());

export async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => resolve((request.result as ArrayBuffer | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Leitura no IndexedDB falhou.'));
  });
}

/** Grava e só resolve quando a transação do IndexedDB terminou (dado salvo). */
export async function idbPut(key: string, bytes: Uint8Array): Promise<void> {
  const db = await database();
  const copy = bytes.slice().buffer;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(copy, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gravação no IndexedDB falhou.'));
    tx.onabort = () => reject(tx.error ?? new Error('Gravação no IndexedDB cancelada.'));
  });
}
