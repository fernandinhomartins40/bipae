import { invoke } from '@tauri-apps/api/core';
import type { SqlDriver } from '@bipae/platform';

/** Native SQLite (rusqlite) through Tauri commands; the file lives in the app data folder. */
export async function openNativeDatabase(name: string): Promise<SqlDriver> {
  await invoke('db_open', { name });
  return {
    persistent: true,
    run: (sql, params = []) => invoke<Record<string, unknown>[]>('db_run', { sql, params }),
    exec: (sql) => invoke<void>('db_exec', { sql }),
    close: () => invoke<void>('db_close'),
  };
}
