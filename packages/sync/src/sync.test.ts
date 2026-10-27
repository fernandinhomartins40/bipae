import {
  uuidv7,
  type SyncPullResult,
  type SyncPushResult,
  type TerminalEvent,
} from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { describe, expect, it } from 'vitest';
import { describeLastSync, SyncClient, type SyncTransport } from './index';

const product = {
  id: uuidv7(),
  name: 'Água 1,5L',
  sku: null,
  unit: 'UN',
  priceCents: 299,
  isWeighable: false,
  active: true,
  ncm: null,
  cest: null,
  fiscalProfileId: null,
  parentId: null,
  barcodes: ['78912342'],
  updatedAt: '2026-10-12T10:00:00.000Z',
};

async function setup(transport: SyncTransport) {
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  const terminalId = uuidv7();
  const pdv = new PdvService(storage, { terminalId, operatorId: uuidv7() });
  return { storage, pdv, client: new SyncClient(storage, pdv, transport, terminalId) };
}

class FakeServer implements SyncTransport {
  received: TerminalEvent[] = [];
  offline = false;
  rejectTypes = new Set<string>();
  pages: SyncPullResult[] = [];
  pullCursors: (string | null)[] = [];
  async push(_terminalId: string, events: TerminalEvent[]): Promise<SyncPushResult> {
    if (this.offline) throw new Error('Sem conexão');
    const result: SyncPushResult = { accepted: [], rejected: [] };
    for (const e of events) {
      if (this.rejectTypes.has(e.type)) result.rejected.push({ id: e.id, reason: 'Não pode' });
      else {
        if (!this.received.some((r) => r.id === e.id)) this.received.push(e);
        result.accepted.push(e.id);
      }
    }
    return result;
  }
  async pull(cursor: string | null): Promise<SyncPullResult> {
    if (this.offline) throw new Error('Sem conexão');
    this.pullCursors.push(cursor);
    return this.pages.shift() ?? { cursor: cursor ?? '', products: [], hasMore: false };
  }
}

describe('sync client', () => {
  it('pushes pending events in order, pulls catalog pages and remembers the cursor', async () => {
    const server = new FakeServer();
    server.pages = [
      { cursor: 'c1', products: [product], hasMore: true },
      {
        cursor: 'c2',
        products: [{ ...product, id: uuidv7(), name: 'Pão', barcodes: [] }],
        hasMore: false,
      },
    ];
    const { pdv, client } = await setup(server);
    await pdv.openSession(0);
    await pdv.completeSale(addItem(EMPTY_CART, product), [{ method: 'cash', receivedCents: 299 }], {
      discountLimitPercent: 10,
    });

    const status = await client.sync();
    expect(status).toMatchObject({ pending: 0, rejected: 0, lastError: null });
    expect(server.received.map((e) => e.deviceSeq)).toEqual([1, 2]);
    expect(await pdv.catalogSize()).toBe(2);
    await client.sync();
    expect(server.pullCursors).toEqual([null, 'c1', 'c2']);
  });

  it('keeps selling offline and sends everything when the connection returns', async () => {
    const server = new FakeServer();
    server.offline = true;
    const { pdv, client } = await setup(server);
    await pdv.applyCatalog([product]);
    await pdv.openSession(0);
    for (let i = 0; i < 3; i++) {
      await pdv.completeSale(
        addItem(EMPTY_CART, product),
        [{ method: 'cash', receivedCents: 299 }],
        { discountLimitPercent: 10 },
      );
    }
    const offline = await client.sync();
    expect(offline.pending).toBe(4);
    expect(offline.lastError).toBe('Sem conexão');
    expect(offline.lastSyncAt).toBeNull();

    server.offline = false;
    const online = await client.sync();
    expect(online).toMatchObject({ pending: 0, lastError: null });
    expect(server.received).toHaveLength(4);
  });

  it('stops retrying rejected events but keeps them for support', async () => {
    const server = new FakeServer();
    server.rejectTypes.add('cash_session.opened');
    const { pdv, client } = await setup(server);
    await pdv.openSession(0);
    const status = await client.sync();
    expect(status).toMatchObject({ pending: 0, rejected: 1 });
    expect(await pdv.rejectedEvents()).toMatchObject([
      { type: 'cash_session.opened', reason: 'Não pode' },
    ]);
  });

  it('reports a partial push as an error so it retries later', async () => {
    let pulls = 0;
    const server: SyncTransport = {
      push: async (_t, events) => ({ accepted: [events[0]!.id], rejected: [] }),
      pull: async () => {
        pulls++;
        return { cursor: '', products: [], hasMore: false };
      },
    };
    const { pdv, client } = await setup(server);
    await pdv.openSession(0);
    await pdv.addMovement('supply', 100, null);
    const status = await client.sync();
    expect(status.pending).toBe(1);
    expect(status.lastError).toContain('Tentaremos de novo');
    // Envio parcial não impede o caixa de receber preços e catálogo (PIE R3-01).
    expect(pulls).toBe(1);
  });

  it('concurrent sync calls share one run and notify listeners', async () => {
    const server = new FakeServer();
    const { client } = await setup(server);
    const seen: boolean[] = [];
    const off = client.onChange((s) => seen.push(s.syncing));
    const [a, b] = await Promise.all([client.sync(), client.sync()]);
    expect(a).toBe(b);
    expect(seen).toEqual([true, false]);
    off();
  });

  it('describes the last sync in plain Portuguese', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(describeLastSync(null, now)).toBe('ainda não sincronizado');
    expect(describeLastSync('2026-10-12T11:59:30Z', now)).toBe('sincronizado agora');
    expect(describeLastSync('2026-10-12T11:57:00Z', now)).toBe('sincronizado há 3 min');
    expect(describeLastSync('2026-10-12T09:00:00Z', now)).toBe('sincronizado há 3 h');
    expect(describeLastSync('2026-10-09T12:00:00Z', now)).toBe('sincronizado há 3 dias');
  });
});
