import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver } from './storage';

/** node:sqlite driver, used by tests and Node tooling. `path` may be ':memory:'. */
export function nodeSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    async run(sql, params = []) {
      const statement = db.prepare(sql);
      return statement.all(...(params as never[])) as Record<string, unknown>[];
    },
    async exec(script) {
      db.exec(script);
    },
    async close() {
      db.close();
    },
  };
}
