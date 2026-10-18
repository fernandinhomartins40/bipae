import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService, type MailMessage } from '../src/modules/mail/mail.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-08.c: campanhas por e-mail só para quem aceitou ofertas, com descadastro. */

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
const sent: (MailMessage & { from: string })[] = [];
const ligarEmail = () =>
  Object.assign(t.app.get(MailService), {
    transport: { send: async (m: MailMessage & { from: string }) => void sent.push(m) },
  });
const desligarEmail = () => Object.assign(t.app.get(MailService), { transport: null });

async function esperar(cond: () => boolean) {
  for (let i = 0; i < 60 && !cond(); i++) await new Promise((ok) => setTimeout(ok, 50));
}

describe('campanhas por e-mail (F6-08.c)', () => {
  it('manda só para quem aceitou; o link descadastra sem login; tudo fica na auditoria', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    await admin.post('/products', {
      name: 'Café 500 g',
      priceCents: 1890,
      barcodes: ['7891000100103'],
    });
    const ana = (
      await admin.post('/customers', {
        name: 'Ana Lima',
        taxId: '12345678909',
        email: 'ana.campanha@exemplo.com.br',
        marketingConsent: true,
      })
    ).json();
    await admin.post('/customers', {
      name: 'Bruno Reis',
      taxId: '52998224725',
      email: 'bruno.campanha@exemplo.com.br',
      marketingConsent: false,
    });
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
    for (const taxId of ['12345678909', '52998224725']) {
      await pdv.completeSale(
        { ...addItem(EMPTY_CART, cafe, 1000), customerTaxId: taxId },
        [{ method: 'cash', receivedCents: 1890 }],
        { discountLimitPercent: 10 },
      );
    }
    expect((await sync.sync()).lastError).toBeNull();

    const campanha = {
      name: 'Café da semana',
      subject: 'Café com 10% de desconto',
      body: 'Nesta semana o café está mais barato.\n\nVenha conferir!',
      segment: null,
    };
    // Sem o provedor de e-mail: "falta configurar".
    desligarEmail();
    expect((await admin.get('/crm/campaigns')).json().emailEnabled).toBe(false);
    const sem = await admin.post('/crm/campaigns', campanha);
    expect(sem.statusCode).toBe(503);
    expect(sem.json().message).toContain('Falta configurar');

    ligarEmail();
    expect((await admin.post('/crm/campaigns', { ...campanha, subject: '' })).statusCode).toBe(400);
    // Segmento sem ninguém que aceitou: explica.
    const vazio = await admin.post('/crm/campaigns', { ...campanha, segment: 'sumido' });
    expect(vazio.statusCode).toBe(400);
    expect(vazio.json().message).toContain('Ninguém deste segmento');

    const enviada = await admin.post('/crm/campaigns', campanha);
    expect(enviada.statusCode).toBe(201);
    expect(enviada.json().recipients).toBe(1);
    await esperar(() => sent.some((m) => m.to === 'ana.campanha@exemplo.com.br'));
    const email = sent.find((m) => m.to === 'ana.campanha@exemplo.com.br')!;
    expect(sent.some((m) => m.to === 'bruno.campanha@exemplo.com.br')).toBe(false);
    expect(email.subject).toBe('Café com 10% de desconto');
    expect(email.text).toContain('Olá, Ana!');
    expect(email.text).toContain('Venha conferir!');
    expect(email.headers?.['List-Unsubscribe']).toMatch(/descadastro\?codigo=/);
    const token = /descadastro\?codigo=([\w-]+)/.exec(email.text)![1]!;

    // Descadastrar não pede login e responde igual se usar de novo.
    const anon = api(t.app, {});
    const sair = await anon.post('/crm/campaigns/unsubscribe', { token });
    expect(sair.statusCode).toBe(201);
    expect(sair.json().message).toContain('não recebe mais ofertas');
    expect((await anon.post('/crm/campaigns/unsubscribe', { token })).statusCode).toBe(201);
    expect(
      (await anon.post('/crm/campaigns/unsubscribe', { token: 'x'.repeat(32) })).statusCode,
    ).toBe(400);
    const ficha = (await admin.get(`/customers/${ana.id}`)).json();
    expect(ficha.marketingConsent).toBe(false);

    const lista = (await admin.get('/crm/campaigns')).json();
    expect(lista.items[0]).toMatchObject({
      name: 'Café da semana',
      recipients: 1,
      unsubscribed: 1,
    });
    // Com a Ana fora, ninguém mais aceitou.
    expect((await admin.post('/crm/campaigns', campanha)).statusCode).toBe(400);
    const auditoria = JSON.stringify((await admin.get('/audit?action=crm.campaign_sent')).json());
    expect(auditoria).toContain('"recipients":1');
  });

  it('quem não pode exportar a lista também não manda campanha', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const email = `caixa-campanha-${Date.now()}@exemplo.com.br`;
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
    expect((await operador.get('/crm/campaigns')).statusCode).toBe(403);
    expect(
      (await operador.post('/crm/campaigns', { name: 'x', subject: 'x', body: 'x' })).statusCode,
    ).toBe(403);
  });
});
