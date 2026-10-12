import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7, type SyncPushResult, type TerminalEvent } from '@bipae/domain';
import { createStorage, LOCAL_MIGRATIONS, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SaleInProgressError } from '@bipae/platform';
import { SimulatedUpdater } from '@bipae/platform/simulators';
import { describe, expect, it } from 'vitest';
import { SyncClient } from './index';

/**
 * Adendo 01 §8: updating the desktop app with sales waiting in the queue loses nothing.
 * The local database is a file outside the app bundle; an update closes it, the new version
 * reopens it and applies its own migrations on top of the existing data.
 */
describe('app update with pending sales', () => {
  const product = { id: uuidv7(), name: 'Café', unit: 'UN', priceCents: 1890, isWeighable: false };

  it('keeps every pending sale across an update that adds a migration, then syncs them', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bipae-update-')), 'pdv.db');
    const terminalId = uuidv7();
    const operatorId = uuidv7();

    // Version N: sells offline, three sales pending.
    const before = createStorage(nodeSqliteDriver(file));
    await migrateLocal(before);
    const pdvBefore = new PdvService(before, { terminalId, operatorId });
    await pdvBefore.openSession(0);
    for (let i = 0; i < 3; i++) {
      await pdvBefore.completeSale(addItem(EMPTY_CART, product), [{ method: 'cash', receivedCents: 2000 }], {
        discountLimitPercent: 10,
      });
    }
    const pendingIds = (await pdvBefore.pendingEvents()).map((e) => e.id);
    expect(pendingIds).toHaveLength(4);

    // The updater refuses while a sale is in progress, then installs (app closes the database).
    const updater = new SimulatedUpdater({ version: '0.3.0', channel: 'stable' });
    await expect(updater.install({ saleInProgress: true })).rejects.toBeInstanceOf(SaleInProgressError);
    await updater.install({ saleInProgress: false });
    await before.close();

    // Version N+1: one more local migration.
    const nextMigrations = [...LOCAL_MIGRATIONS, 'ALTER TABLE sales ADD COLUMN fiscal_key TEXT;'];
    const after = createStorage(nodeSqliteDriver(file));
    expect(await migrateLocal(after, nextMigrations)).toBe(LOCAL_MIGRATIONS.length + 1);
    const pdvAfter = new PdvService(after, { terminalId, operatorId });
    expect((await pdvAfter.pendingEvents()).map((e) => e.id)).toEqual(pendingIds);
    expect(await pdvAfter.currentSession()).not.toBeNull();

    // New sales keep numbering after the old ones.
    const next = await pdvAfter.completeSale(addItem(EMPTY_CART, product), [{ method: 'pix', receivedCents: 1890 }], {
      discountLimitPercent: 10,
    });
    expect(next.terminalSeq).toBe(4);

    const received: TerminalEvent[] = [];
    const sync = new SyncClient(after, pdvAfter, {
      push: async (_t, events): Promise<SyncPushResult> => {
        received.push(...events);
        return { accepted: events.map((e) => e.id), rejected: [] };
      },
      pull: async () => ({ cursor: '', products: [], hasMore: false }),
    }, terminalId);
    expect((await sync.sync()).pending).toBe(0);
    expect(received.map((e) => e.deviceSeq)).toEqual([1, 2, 3, 4, 5]);
    await after.close();
  });

  it('an older app refuses a database from a newer version instead of corrupting it', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'bipae-downgrade-')), 'pdv.db');
    const newer = createStorage(nodeSqliteDriver(file));
    await migrateLocal(newer, [...LOCAL_MIGRATIONS, 'SELECT 1;']);
    await newer.close();
    const older = createStorage(nodeSqliteDriver(file));
    await expect(migrateLocal(older)).rejects.toThrow('versão mais nova');
    await older.close();
  });
});
