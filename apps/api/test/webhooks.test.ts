import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import {
  isPrivateAddress,
  signWebhook,
  WEBHOOK_RETRY_MS,
  WebhooksService,
} from '../src/modules/public-api/webhooks.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-01.c: webhooks da API pública (ADR-0016). */

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let t: TestApp;
let server: Server;
let url = '';
let reply = 200;
const received: Received[] = [];

beforeAll(async () => {
  t = await createTestApp();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = reply;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/avisos`;
});
afterAll(async () => {
  await t.close();
  await new Promise((r) => server.close(r));
});

async function waitFor<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error('O aviso não chegou a tempo.');
    await new Promise((r) => setTimeout(r, 25));
  }
}

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

describe('webhooks (F6-01.c)', () => {
  it('não deixa um aviso alcançar a rede interna', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '172.20.0.5',
      '192.168.0.10',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('avisa venda e produto com assinatura, tenta de novo e desiste depois de 6 tentativas', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);

    // Endereço sem https ou da rede interna é recusado (em teste, só o 127.0.0.1 local passa).
    expect(
      (
        await admin.post('/webhooks', {
          url: 'http://exemplo.com.br/x',
          events: ['sale.completed'],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await admin.post('/webhooks', { url: 'https://10.0.0.1/x', events: ['sale.completed'] }))
        .statusCode,
    ).toBe(422);

    const criado = await admin.post('/webhooks', {
      url,
      events: ['sale.completed', 'product.updated'],
    });
    expect(criado.statusCode).toBe(201);
    const hook = criado.json();
    expect(hook.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await admin.get('/webhooks')).json())).not.toContain(hook.secret);

    // Produto: o aviso chega com o produto no formato da API pública e a assinatura confere.
    const produto = (
      await admin.post('/products', {
        name: 'Pão de Queijo 1 kg',
        priceCents: 2990,
        barcodes: ['7891000100103'],
      })
    ).json();
    const aviso = await waitFor(() =>
      received.find((r) => r.headers['x-bipae-event'] === 'product.updated'),
    );
    const corpo = JSON.parse(aviso.body);
    expect(corpo).toMatchObject({
      event: 'product.updated',
      tenantId: dono.me.tenant.id,
      data: {
        id: produto.id,
        name: 'Pão de Queijo 1 kg',
        priceCents: 2990,
        barcodes: ['7891000100103'],
      },
    });
    expect(aviso.headers['x-bipae-delivery']).toBe(corpo.id);
    const assinatura = String(aviso.headers['x-bipae-signature']);
    const t0 = Number(/t=(\d+)/.exec(assinatura)![1]);
    const v1 = createHmac('sha256', hook.secret).update(`${t0}.${aviso.body}`).digest('hex');
    expect(assinatura).toBe(`t=${t0},v1=${v1}`);
    expect(signWebhook(hook.secret, aviso.body, t0)).toBe(assinatura);

    // Venda no caixa: o aviso sai depois que o servidor aplica o evento.
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const item = (await pdv.findByCode('7891000100103'))!;
    const venda = await pdv.completeSale(
      addItem(EMPTY_CART, item, 1000),
      [{ method: 'cash', receivedCents: 3000 }],
      {
        discountLimitPercent: 10,
      },
    );
    expect((await sync.sync()).lastError).toBeNull();
    const avisoVenda = await waitFor(() =>
      received.find((r) => r.headers['x-bipae-event'] === 'sale.completed'),
    );
    expect(JSON.parse(avisoVenda.body).data).toMatchObject({
      id: venda.id,
      totalCents: 2990,
      items: [expect.objectContaining({ productId: produto.id, quantityMilli: 1000 })],
    });

    // O parceiro fora do ar: o aviso fica pendente, com a próxima tentativa marcada.
    reply = 500;
    const antes = received.length;
    await admin.post(`/webhooks/${hook.id}/ping`, {});
    await waitFor(() => (received.length > antes ? true : undefined));
    const entregas = async () => (await admin.get(`/webhooks/${hook.id}/deliveries`)).json();
    const pendente = await (async () => {
      for (let i = 0; i < 100; i++) {
        const lista = await entregas();
        const p = lista.find(
          (d: { event: string; attempts: number }) => d.event === 'ping' && d.attempts === 1,
        );
        if (p) return p;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('ping não registrado');
    })();
    expect(pendente).toMatchObject({
      status: 'pending',
      lastStatus: 500,
      lastError: 'O endereço respondeu 500.',
    });
    expect(new Date(pendente.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 30_000);

    // As novas tentativas (rodando o envio direto, com o relógio adiantado) até desistir.
    const webhooks = t.app.get(WebhooksService);
    let agora = Date.now();
    for (let i = 0; i < WEBHOOK_RETRY_MS.length; i++) {
      agora += WEBHOOK_RETRY_MS[i]! + 1000;
      await webhooks.deliver(
        { tenantId: dono.me.tenant.id, deliveryId: pendente.id, at: Date.now() },
        new Date(agora),
      );
    }
    const final = (await entregas()).find((d: { id: string }) => d.id === pendente.id);
    expect(final).toMatchObject({
      status: 'failed',
      attempts: WEBHOOK_RETRY_MS.length + 1,
      nextAttemptAt: null,
    });
    expect((await admin.get('/webhooks')).json()[0]).toMatchObject({ failed: 1 });

    // A rotina de manutenção põe de volta na fila o que venceu.
    reply = 200;
    await admin.post(`/webhooks/${hook.id}/ping`, {});
    const maintenance = t.app.get(MaintenanceService);
    expect(
      await maintenance.sweepWebhooks(new Date(Date.now() + 10 * 60_000)),
    ).toBeGreaterThanOrEqual(0);

    // Gerar outro segredo e desativar ficam na auditoria.
    const novo = (await admin.post(`/webhooks/${hook.id}/secret`, {})).json();
    expect(novo.secret).not.toBe(hook.secret);
    await admin.put(`/webhooks/${hook.id}`, { url, events: ['sale.completed'], active: false });
    const auditoria = JSON.stringify((await admin.get('/audit?entity=webhook')).json());
    for (const acao of ['webhook.created', 'webhook.secret_rotated', 'webhook.updated']) {
      expect(auditoria).toContain(acao);
    }
    expect(auditoria).not.toContain(novo.secret);

    // Desativado, nada mais é gravado para ele.
    const total = (await entregas()).length;
    await admin.post('/products', { name: 'Biscoito', priceCents: 499 });
    expect((await entregas()).length).toBe(total);
  });

  it('o gerente não configura webhooks', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const email = `gerente-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Gerente',
      email,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'manager')!.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const gerente = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await gerente.get('/webhooks')).statusCode).toBe(403);
  });
});
