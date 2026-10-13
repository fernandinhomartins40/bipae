import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createStorage,
  getMeta,
  LOCAL_MIGRATIONS,
  migrateLocal,
  searchKey,
  setMeta,
} from './index';
import { nodeSqliteDriver } from './node-driver';

async function open(path?: string) {
  const storage = createStorage(nodeSqliteDriver(path));
  await migrateLocal(storage);
  return storage;
}

describe('local database', () => {
  it('aplica todas as migrações uma vez e repetir não muda nada', async () => {
    const storage = await open();
    expect(await migrateLocal(storage)).toBe(LOCAL_MIGRATIONS.length);
    const [row] = await storage.query<{ user_version: number }>('PRAGMA user_version');
    expect(Number(row?.user_version)).toBe(LOCAL_MIGRATIONS.length);
    await storage.close();
  });

  it('commits and rolls back transactions', async () => {
    const storage = await open();
    await storage.transaction(async (tx) => {
      await tx.execute('INSERT INTO meta (key, value) VALUES (?, ?)', ['a', '1']);
    });
    await expect(
      storage.transaction(async (tx) => {
        await tx.execute('INSERT INTO meta (key, value) VALUES (?, ?)', ['b', '2']);
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    expect(await getMeta(storage, 'a')).toBe('1');
    expect(await getMeta(storage, 'b')).toBeNull();
  });

  it('serializes concurrent work so transactions never interleave', async () => {
    const storage = await open();
    await setMeta(storage, 'counter', '0');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.transaction(async (tx) => {
          const [row] = await tx.query<{ value: string }>(
            "SELECT value FROM meta WHERE key = 'counter'",
          );
          await new Promise((r) => setTimeout(r, 1));
          await tx.execute("UPDATE meta SET value = ? WHERE key = 'counter'", [
            String(Number(row!.value) + 1),
          ]);
        }),
      ),
    );
    expect(await getMeta(storage, 'counter')).toBe('20');
  });

  it('persists to disk and survives reopening (e.g. after an app update)', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bipae-local-')), 'pdv.db');
    const first = await open(path);
    await setMeta(first, 'terminal', 'abc');
    await first.close();
    const second = await open(path);
    expect(await getMeta(second, 'terminal')).toBe('abc');
    await second.close();
  });

  it('refuses a database created by a newer app version', async () => {
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage, ['CREATE TABLE a (x)', 'CREATE TABLE b (x)']);
    await expect(migrateLocal(storage, ['CREATE TABLE a (x)'])).rejects.toThrow('versão mais nova');
  });

  it('builds accent-insensitive search keys', () => {
    expect(searchKey('  Café com AÇÚCAR ')).toBe('cafe com acucar');
  });
});
