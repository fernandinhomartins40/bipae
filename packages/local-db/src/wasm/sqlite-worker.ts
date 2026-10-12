/// <reference lib="webworker" />
/**
 * Dedicated worker hosting SQLite WASM. Data is stored in the Origin Private File System
 * through the "opfs-sahpool" VFS, which does not need COOP/COEP headers. Without OPFS the
 * database falls back to memory and reports `persistent: false`.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Request =
  | { id: number; op: 'open'; name: string }
  | { id: number; op: 'run'; sql: string; params: unknown[] }
  | { id: number; op: 'exec'; sql: string }
  | { id: number; op: 'close' };

interface Db {
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
const ready = sqlite3InitModule();

async function open(name: string) {
  const sqlite3 = await ready;
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'bipae', directory: '/bipae' });
    db = new pool.OpfsSAHPoolDb(`/${name}`) as unknown as Db;
    persistent = true;
  } catch {
    db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
    persistent = false;
  }
  db.exec({ sql: 'PRAGMA foreign_keys = ON;' });
  return { persistent };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    let result: unknown = null;
    if (req.op === 'open') result = await open(req.name);
    else if (!db) throw new Error('Banco local não aberto.');
    else if (req.op === 'run') {
      result = db.exec({
        sql: req.sql,
        bind: req.params.length ? req.params : undefined,
        rowMode: 'object',
        returnValue: 'resultRows',
      });
    } else if (req.op === 'exec') db.exec({ sql: req.sql });
    else if (req.op === 'close') {
      db.close();
      db = null;
    }
    self.postMessage({ id: req.id, result });
  } catch (error) {
    self.postMessage({ id: req.id, error: (error as Error).message });
  }
};
