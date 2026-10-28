import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatform } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { api, createTestApp, signup, type TestApp } from './helpers';

// Limites baixos para o teste: duas falhas seguidas já levam o evento para a quarentena.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ SYNC_QUARANTINE_ATTEMPTS: '2', SYNC_QUARANTINE_MINUTES: '0' });
});
afterAll(async () => {
  await t.close();
});

function caixa(auth: Record<string, string>, terminalId: string, operatorId: string) {
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  const transport: SyncTransport = {
    async push(id, events: TerminalEvent[]) {
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, limit, pricingVersion, fiscalVersion) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      if (pricingVersion) query.set('pricingVersion', pricingVersion);
      if (fiscalVersion) query.set('fiscalVersion', fiscalVersion);
      return (await client.get(`/sync/pull?${query}`)).json() as SyncPullResult;
    },
  };
  return async () => {
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId, operatorId });
    return { pdv, sync: new SyncClient(storage, pdv, transport, terminalId) };
  };
}

describe('quarentena de eventos do caixa (PIE ACH-04)', () => {
  it('evento que falha sempre vai para a quarentena, o caixa segue e o dono processa de novo', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    await admin.post('/products', { name: 'Água', priceCents: 300, barcodes: ['78912342'] });
    const loja = (await admin.get('/stores')).json()[0];
    const terminal = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa 1', platform: 'web' })
    ).json();
    const make = caixa(dono.auth, terminal.id, dono.me.user.id);
    const vender = async (pdv: PdvService) =>
      pdv.completeSale(
        addItem(EMPTY_CART, (await pdv.findByCode('78912342'))!),
        [{ method: 'cash', receivedCents: 300 }],
        { discountLimitPercent: 10 },
      );

    const primeiro = await make();
    await primeiro.sync.sync();
    await primeiro.pdv.openSession(0);
    await vender(primeiro.pdv);
    expect((await primeiro.sync.sync()).pending).toBe(0);

    // Aparelho novo do mesmo caixa sem alinhar a numeração: repete a venda nº 1.
    const segundo = await make();
    await segundo.sync.sync();
    await segundo.pdv.openSession(0);
    const repetida = await vender(segundo.pdv);
    await segundo.pdv.addMovement('supply', 500, 'Troco');

    // 1ª tentativa: ainda pode ser instabilidade, o caixa espera.
    expect((await segundo.sync.sync()).pending).toBeGreaterThan(0);
    const tentando = (await admin.get('/sync/quarantine')).json();
    expect(tentando).toHaveLength(1);
    expect(tentando[0]).toMatchObject({ terminalName: 'Caixa 1', quarantinedAt: null });

    // 2ª tentativa: quarentena. O servidor guarda a venda e o caixa envia o que vem depois.
    const estado = await segundo.sync.sync();
    expect(estado.pending).toBe(0);
    expect(estado.rejected).toBe(0);
    expect(estado.lastError).toBeNull();
    const [travado] = (await admin.get('/sync/quarantine')).json();
    expect(travado.quarantinedAt).not.toBeNull();
    expect(travado.type).toBe('sale.completed');
    expect(travado.error).not.toContain('Água');
    const trilha = (await admin.get('/audit?limit=50')).json().items as { action: string }[];
    expect(trilha.some((e) => e.action === 'sync.event.quarantined')).toBe(true);

    // Processar de novo com a causa ainda presente: continua guardado.
    const ainda = await admin.post(`/sync/quarantine/${travado.id}/retry`, {});
    expect(ainda.statusCode).toBe(409);
    expect((await admin.get('/sync/quarantine')).json()).toHaveLength(1);

    // O suporte resolve a causa (renumera a venda antiga); agora a venda guardada entra.
    await asPlatform(t.database.db, (tx) =>
      tx.execute(
        sql`update sales set terminal_seq = 900 where terminal_id = ${terminal.id} and id <> ${repetida.id}`,
      ),
    );
    const ok = await admin.post(`/sync/quarantine/${travado.id}/retry`, {});
    expect(ok.statusCode).toBe(200);
    expect((await admin.get('/sync/quarantine')).json()).toHaveLength(0);
    const [venda] = rowsOf<{ n: number }>(
      await asPlatform(t.database.db, (tx) =>
        tx.execute(sql`select count(*)::int as n from sales where id = ${repetida.id}`),
      ),
    );
    expect(venda!.n).toBe(1);
    // Reenviar o mesmo evento não duplica nada.
    expect((await admin.post(`/sync/quarantine/${travado.id}/retry`, {})).statusCode).toBe(404);
  });

  it('só quem gerencia caixas vê e reprocessa a quarentena', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const papeis = (await admin.get('/roles')).json() as { id: string; systemKey: string }[];
    const email = `bia-${Date.now()}@exemplo.com.br`;
    const operador = await admin.post('/members', {
      name: 'Bia Caixa',
      email,
      password: 'senha-forte-123',
      roleId: papeis.find((p) => p.systemKey === 'cashier')!.id,
    });
    expect(operador.statusCode).toBeLessThan(300);
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const bia = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await bia.get('/sync/quarantine')).statusCode).toBe(403);
  });
});
