import type { SqlDriver, StoragePort } from '@bipae/platform';

export type { SqlDriver };

/** FIFO mutex so a transaction never interleaves with other statements on the one connection. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export type Tx = Omit<StoragePort, 'transaction'>;

export interface LocalStorage extends StoragePort {
  driver: SqlDriver;
  close(): Promise<void>;
}

export function createStorage(driver: SqlDriver): LocalStorage {
  const mutex = new Mutex();
  const direct: Tx = {
    execute: async (sql, params) => {
      await driver.run(sql, params);
    },
    query: async <T>(sql: string, params?: unknown[]) =>
      (await driver.run(sql, params)) as unknown as T[],
  };

  return {
    driver,
    execute: (sql, params) => mutex.lock(() => direct.execute(sql, params)),
    query: <T>(sql: string, params?: unknown[]) => mutex.lock(() => direct.query<T>(sql, params)),
    transaction: <T>(fn: (tx: Tx) => Promise<T>) =>
      mutex.lock(async () => {
        await driver.run('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          await driver.run('COMMIT');
          return result;
        } catch (error) {
          await driver.run('ROLLBACK');
          throw error;
        }
      }),
    close: () => mutex.lock(() => driver.close()),
  };
}
