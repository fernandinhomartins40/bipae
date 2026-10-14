/// <reference lib="webworker" />
/**
 * Dedicated worker hosting SQLite WASM. Data is stored in the Origin Private File System
 * through the "opfs-sahpool" VFS, which does not need COOP/COEP headers.
 *
 * Sem OPFS (F2-05), o banco roda em memória e uma cópia inteira vai para o IndexedDB ao fim de
 * cada transação, antes de responder: quem grava só segue depois de a cópia estar salva. Ao
 * abrir, a cópia é carregada. Só sem IndexedDB o banco fica só na memória (`persistent: false`).
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { idbGet, idbPut } from './idb-snapshot';

type Mode = 'opfs' | 'idb';
type Request =
  | { id: number; op: 'open'; name: string; mode?: Mode }
  | { id: number; op: 'run'; sql: string; params: unknown[] }
  | { id: number; op: 'exec'; sql: string }
  | { id: number; op: 'close' };

interface Db {
  pointer: number;
  exec(options: {
    sql: string;
    bind?: unknown[];
    rowMode?: 'object';
    returnValue?: 'resultRows';
  }): unknown;
  close(): void;
}

let db: Db | null = null;
let persistent = false;
let storage: 'opfs' | 'idb' | 'memory' = 'memory';
let snapshotKey = '';
const ready = sqlite3InitModule();

/** Abre em memória e carrega a cópia guardada no IndexedDB, se houver. */
async function openFromIndexedDb(name: string) {
  const sqlite3 = await ready;
  const memory = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
  const saved = await idbGet(name);
  if (saved && saved.byteLength > 0) {
    const bytes = new Uint8Array(saved);
    const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      memory.pointer,
      'main',
      pointer,
      bytes.byteLength,
      bytes.byteLength,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) throw new Error(`Cópia do banco local ilegível (código ${rc}).`);
  }
  return memory;
}

/** Fim de transação: guarda a cópia inteira no IndexedDB. */
async function saveSnapshot() {
  if (storage !== 'idb' || !db) return;
  const sqlite3 = await ready;
  if (sqlite3.capi.sqlite3_get_autocommit(db.pointer) === 0) return;
  const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer);
  await idbPut(snapshotKey, bytes);
}

async function open(name: string, mode: Mode = 'opfs') {
  const sqlite3 = await ready;
  db = null;
  if (mode === 'opfs') {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'bipae', directory: '/bipae' });
      db = new pool.OpfsSAHPoolDb(`/${name}`) as unknown as Db;
      storage = 'opfs';
    } catch {
      db = null;
    }
  }
  if (!db) {
    try {
      db = await openFromIndexedDb(name);
      storage = 'idb';
      snapshotKey = name;
    } catch {
      db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
      storage = 'memory';
    }
  }
  persistent = storage !== 'memory';
  db.exec({ sql: 'PRAGMA foreign_keys = ON;' });
  return { persistent, storage };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    let result: unknown = null;
    if (req.op === 'open') result = await open(req.name, req.mode);
    else if (!db) throw new Error('Banco local não aberto.');
    else if (req.op === 'run') {
      result = db.exec({
        sql: req.sql,
        bind: req.params.length ? req.params : undefined,
        rowMode: 'object',
        returnValue: 'resultRows',
      });
      await saveSnapshot();
    } else if (req.op === 'exec') {
      db.exec({ sql: req.sql });
      await saveSnapshot();
    } else if (req.op === 'close') {
      db.close();
      db = null;
    }
    self.postMessage({ id: req.id, result });
  } catch (error) {
    self.postMessage({ id: req.id, error: (error as Error).message });
  }
};
