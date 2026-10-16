import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrmService } from '../src/modules/crm/crm.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-08.a: CRM — histórico pelo CPF, segmentos e lista de ofertas com consentimento. */

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

describe('CRM (F6-08.a)', () => {
  it('junta as compras pelo CPF, segmenta e exporta só quem aceitou ofertas', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Café 500 g',
      priceCents: 1890,
      barcodes: ['7891000100103'],
    });
    await admin.post('/products', {
      name: 'Leite 1 L',
      priceCents: 599,
      barcodes: ['7891000053508'],
    });
    const ana = (
      await admin.post('/customers', {
        name: 'Ana Lima',
        taxId: '12345678909',
        email: 'ana@exemplo.com.br',
        marketingConsent: true,
      })
    ).json();
    await admin.post('/customers', {
      name: 'Bruno Reis',
      taxId: '52998224725',
      email: 'bruno@exemplo.com.br',
      marketingConsent: false,
    });
    const semCpf = (await admin.post('/customers', { name: 'Carla Sem CPF' })).json();

    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const cafe = (await pdv.findByCode('7891000100103'))!;
    const leite = (await pdv.findByCode('7891000053508'))!;
    const vender = (cart: Parameters<PdvService['completeSale']>[0], total: number) =>
      pdv.completeSale(cart, [{ method: 'cash', receivedCents: total }], {
        discountLimitPercent: 10,
      });
    await vender({ ...addItem(EMPTY_CART, cafe, 2000), customerTaxId: '12345678909' }, 3780);
    await vender(
      { ...addItem(addItem(EMPTY_CART, cafe, 1000), leite, 1000), customerTaxId: '12345678909' },
      2489,
    );
    await vender({ ...addItem(EMPTY_CART, leite, 3000), customerTaxId: '52998224725' }, 1797);
    await vender(addItem(EMPTY_CART, leite, 1000), 599);
    expect((await sync.sync()).lastError).toBeNull();

    // Ficha da Ana: duas compras, total, ticket médio e o que ela mais compra.
    const ficha = (await admin.get(`/crm/customers/${ana.id}/summary`)).json();
    expect(ficha).toMatchObject({
      hasTaxId: true,
      purchases: 2,
      totalCents: 3780 + 2489,
      averageTicketCents: Math.round((3780 + 2489) / 2),
      segment: 'novo',
    });
    expect(ficha.topProducts[0]).toMatchObject({ name: 'Café 500 g', quantityMilli: 3000 });
    expect(ficha.recentSales).toHaveLength(2);
    // Sem CPF no cadastro, não há como juntar as compras.
    expect((await admin.get(`/crm/customers/${semCpf.id}/summary`)).json()).toMatchObject({
      hasTaxId: false,
      purchases: 0,
      segment: null,
    });

    // Lista: os dois são novos; a venda sem CPF não entra.
    const lista = (await admin.get('/crm/customers')).json();
    expect(lista.counts).toEqual({ novo: 2, frequente: 0, sumido: 0, ativo: 0 });
    expect(lista.items.map((r: { name: string }) => r.name).sort()).toEqual([
      'Ana Lima',
      'Bruno Reis',
    ]);
    expect((await admin.get('/crm/customers?consent=true')).json().items).toHaveLength(1);

    // Daqui a 90 dias, sem comprar de novo, os dois somem.
    const crm = t.app.get(CrmService);
    const ctx = {
      tenantId: dono.me.tenant.id,
      userId: dono.me.user.id,
      permissions: ['parties.read'],
      terminalId: null,
      storeIds: null,
    };
    const depois = await crm.list(
      ctx,
      { segment: 'sumido' },
      new Date(Date.now() + 90 * 86_400_000),
    );
    expect(depois.counts.sumido).toBe(2);

    // Exportação: só quem aceitou ofertas, e fica na auditoria.
    const csv = await admin.get('/crm/export.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Ana Lima;ana@exemplo.com.br');
    expect(csv.body).not.toContain('Bruno');
    const auditoria = JSON.stringify((await admin.get('/audit?action=crm.exported')).json());
    expect(auditoria).toContain('"count":1');

    // O operador de caixa vê a ficha, mas não exporta a lista.
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const email = `caixa-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Caixa',
      email,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const operador = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await operador.get(`/crm/customers/${ana.id}/summary`)).statusCode).toBe(200);
    expect((await operador.get('/crm/export.csv')).statusCode).toBe(403);
  });
});
