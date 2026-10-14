import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F2-03: troca de operador no mesmo caixa, sem fechar a sessão. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function transport(auth: Record<string, string>, terminalId: string): SyncTransport {
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  return {
    async push(id, events: TerminalEvent[]) {
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      const res = await client.get(
        `/sync/pull?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      return res.json() as SyncPullResult;
    },
  };
}

describe('troca de operador (F2-03)', () => {
  it('confere a senha e a permissão de vender; a troca e as vendas seguintes ficam no nome de quem entrou', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const add = async (name: string, key: string) => {
      const email = `${name.toLowerCase()}-${Date.now()}@exemplo.com.br`;
      const role = roles.find((r) => r.systemKey === key)!;
      const res = await admin.post('/members', {
        name,
        email,
        password: 'senha-forte-123',
        roleId: role.id,
      });
      expect(res.statusCode).toBe(201);
      return email;
    };
    const juEmail = await add('Ju', 'cashier');
    const contadorEmail = await add('Contador', 'accountant');

    const errada = await admin.post('/auth/operator', { email: juEmail, password: 'errada-123' });
    expect(errada.statusCode).toBe(422);
    const semVenda = await admin.post('/auth/operator', {
      email: contadorEmail,
      password: 'senha-forte-123',
    });
    expect(semVenda.statusCode).toBe(403);
    expect(semVenda.json().message).toBe('Esta pessoa não pode vender no caixa desta empresa.');
    const ju = (
      await admin.post('/auth/operator', { email: juEmail, password: 'senha-forte-123' })
    ).json();
    expect(ju).toMatchObject({ name: 'Ju', permissions: expect.arrayContaining(['pos.sell']) });

    // No caixa: o dono abre, a Ju entra e vende.
    await admin.post('/products', { name: 'Pão', priceCents: 100, barcodes: ['78912342'] });
    const store = (await admin.get('/stores')).json()[0];
    const terminal = (
      await admin.post('/terminals', { storeId: store.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: terminal.id, operatorId: owner.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(owner.auth, terminal.id), terminal.id);
    await sync.sync();
    await pdv.openSession(0);
    await pdv.changeOperator(ju.userId);
    const item = (await pdv.findByCode('78912342'))!;
    const venda = await pdv.completeSale(
      addItem(EMPTY_CART, item, 1000),
      [{ method: 'cash', receivedCents: 100 }],
      {
        discountLimitPercent: 10,
      },
    );
    expect((await sync.sync()).lastError).toBeNull();

    const trilha = (await admin.get('/audit?action=pos.operator_changed')).json();
    expect(JSON.stringify(trilha)).toContain(ju.userId);
    const detalhe = (await admin.get(`/sales/${venda.id}`)).json();
    expect(detalhe.operatorId ?? detalhe.operator?.id).toBe(ju.userId);
  });
});
