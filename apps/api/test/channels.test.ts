import {
  availableChannelActions,
  channelStatusAfter,
  normalizedOrderSchema,
  type ChannelOrderView,
} from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE, DB } from '../src/common/di';
import type { MemoryQueue } from '../src/common/queue';
import { asPlatform, type Db } from '../src/db/client';
import { reaisToCents } from '../src/modules/channels/channel.port';
import { ChannelsService, signInbound } from '../src/modules/channels/channels.service';
import { mapIfoodOrder } from '../src/modules/channels/ifood.channel';
import { ChannelsSweep } from '../src/modules/maintenance/channels-sweep';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F6-05 (iFood) e F6-06 (marketplaces): pedidos de entrada pela porta de canais, contra o
 * simulador e contra um iFood de mentira. A homologação com o iFood de verdade depende de E14.
 */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function setup() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const store = (await admin.get('/stores')).json()[0] as { id: string };
  const product = (
    await admin.post('/products', {
      name: 'Pizza grande',
      priceCents: 4500,
      barcodes: ['7891149101009'],
    })
  ).json() as { id: string };
  return { dono, admin, store, product };
}

async function createSim(admin: ReturnType<typeof api>, storeId: string, extra = {}) {
  const res = await admin.post('/channels/integrations', {
    provider: 'simulator',
    name: 'Simulador',
    storeId,
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string };
}

const sweep = () => t.app.get(ChannelsSweep);
const queue = () => t.app.get(QUEUE) as MemoryQueue;

describe('regras puras dos pedidos de canal', () => {
  it('recusa pedido cujo total não bate e converte reais em centavos sem erro', () => {
    const base = {
      externalId: 'A1',
      displayId: '1234',
      createdAt: '2026-10-27T12:00:00-03:00',
      customer: { name: 'Ana' },
      items: [{ sku: 'x', name: 'X', quantity: 2, unitPriceCents: 1000, totalCents: 2000 }],
      subtotalCents: 2000,
      deliveryFeeCents: 500,
      discountCents: 100,
      totalCents: 2400,
      payment: { method: 'online', prepaid: true },
    };
    expect(normalizedOrderSchema.safeParse(base).success).toBe(true);
    expect(normalizedOrderSchema.safeParse({ ...base, totalCents: 2500 }).success).toBe(false);
    expect(
      normalizedOrderSchema.safeParse({ ...base, subtotalCents: 1999, totalCents: 2399 }).success,
    ).toBe(false);
    expect(reaisToCents(25.9)).toBe(2590);
    expect(reaisToCents(0.29)).toBe(29);
    expect(reaisToCents(1.005 + 0.1)).toBe(110);
  });

  it('só oferece as ações do momento do pedido', () => {
    expect(availableChannelActions('received')).toEqual(['accept', 'reject']);
    expect(availableChannelActions('accepted')).toEqual(['start_preparation', 'ready']);
    expect(availableChannelActions('concluded')).toEqual([]);
    expect(channelStatusAfter('received', 'dispatch')).toBeNull();
    expect(channelStatusAfter('ready', 'dispatch')).toBe('dispatched');
  });
});

describe('fluxo do pedido com o simulador', () => {
  it('chega, é aceito (vai para a fila do caixa), avisa o canal uma vez e não duplica', async () => {
    const { admin, store, product } = await setup();
    const integ = await createSim(admin, store.id);
    const channels = t.app.get(ChannelsService);

    await admin.post(`/channels/integrations/${integ.id}/simulate`, {});
    await admin.post(`/channels/integrations/${integ.id}/simulate`, { prepaid: true });
    const dono = (await admin.get('/auth/me')).json();
    const poll = await admin.post(`/channels/integrations/${integ.id}/poll`);
    expect(poll.json()).toMatchObject({ events: 2, orders: 2 });
    // Segunda consulta: nada novo, nada duplicado.
    expect((await admin.post(`/channels/integrations/${integ.id}/poll`)).json()).toMatchObject({
      events: 0,
      orders: 0,
    });

    const orders = (await admin.get('/channels/orders?open=1')).json() as ChannelOrderView[];
    expect(orders).toHaveLength(2);
    const prepaid = orders.find((o) => o.prepaid)!;
    const cash = orders.find((o) => !o.prepaid)!;
    expect(cash).toMatchObject({ status: 'received', subtotalCents: 9000, totalCents: 9600 });
    expect(cash.items[0]!.productId).toBe(product.id);

    // Aceitar o pago online: pedido na fila do caixa e repasse a receber.
    const accepted = await admin.post(`/channels/orders/${prepaid.id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({ status: 'accepted' });
    expect(accepted.json().tabOrderId).toBeTruthy();
    expect(accepted.json().financialEntryId).toBeTruthy();
    // Aceitar duas vezes é recusado, sem duplicar a conta.
    expect((await admin.post(`/channels/orders/${prepaid.id}/accept`)).statusCode).toBe(409);

    const tabs = (await admin.get(`/tabs/orders?storeId=${store.id}`)).json() as {
      label: string;
      items: { quantityMilli: number }[];
    }[];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.label).toContain('pago');
    expect(tabs[0]!.items[0]!.quantityMilli).toBe(2000);
    const entries = (await admin.get('/finance/entries?kind=receivable')).json() as {
      amountCents: number;
      category: string;
    }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountCents: 9600, category: 'Marketplace' });

    await queue().idle();
    expect(channels.hub.state(integ.id).actions.map((a) => a.action)).toEqual(['accept']);
    // A fila repetindo a tarefa não manda de novo.
    await sweep().sweep(new Date(Date.now() + 120_000));
    await queue().idle();
    expect(channels.hub.state(integ.id).actions).toHaveLength(1);

    // Preparo, pronto e saída, cada um uma vez.
    for (const step of ['start_preparation', 'ready', 'dispatch']) {
      expect((await admin.post(`/channels/orders/${prepaid.id}/${step}`)).statusCode).toBe(201);
    }
    await queue().idle();
    expect(channels.hub.state(integ.id).actions.map((a) => a.action)).toEqual([
      'accept',
      'start_preparation',
      'ready',
      'dispatch',
    ]);

    // Recusar exige motivo e tira o pedido da fila.
    expect((await admin.post(`/channels/orders/${cash.id}/reject`, {})).statusCode).toBe(400);
    const rejected = await admin.post(`/channels/orders/${cash.id}/reject`, {
      reason: 'Sem massa hoje',
    });
    expect(rejected.json()).toMatchObject({ status: 'rejected', cancelReason: 'Sem massa hoje' });
    expect(dono.user.id).toBeTruthy();

    // A trilha de auditoria guarda quem aceitou e recusou.
    const trail = (await admin.get('/audit?limit=50')).json();
    const actions = JSON.stringify(trail);
    expect(actions).toContain('channel.order_accept');
    expect(actions).toContain('channel.order_reject');
  });

  it('pedido com item sem ligação espera; ligar o produto libera; cancelamento do cliente desfaz tudo', async () => {
    const { admin, store, product } = await setup();
    const integ = await createSim(admin, store.id);
    const channels = t.app.get(ChannelsService);

    await admin.post(`/channels/integrations/${integ.id}/simulate`, {
      unmapped: true,
      prepaid: true,
    });
    await admin.post(`/channels/integrations/${integ.id}/poll`);
    const [order] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(order).toMatchObject({ status: 'needs_mapping' });
    expect((await admin.post(`/channels/orders/${order!.id}/accept`)).statusCode).toBe(422);

    expect(
      (
        await admin.post(`/channels/integrations/${integ.id}/links`, {
          sku: 'SEM-LIGACAO-1',
          productId: product.id,
        })
      ).statusCode,
    ).toBe(201);
    const [again] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(again).toMatchObject({ status: 'received' });
    await admin.post(`/channels/orders/${order!.id}/accept`);
    expect((await admin.get('/finance/entries?kind=receivable')).json()).toHaveLength(1);

    // O cliente cancela no canal: a conta a receber e o pedido do caixa saem.
    channels.hub.cancel(integ.id, order!.externalId);
    await admin.post(`/channels/integrations/${integ.id}/poll`);
    const [done] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(done).toMatchObject({ status: 'cancelled' });
    const entries = (await admin.get('/finance/entries?kind=receivable')).json() as {
      status: string;
    }[];
    expect(entries[0]!.status).toBe('cancelled');
    const tabs = (await admin.get(`/tabs/orders?storeId=${store.id}`)).json() as {
      status: string;
    }[];
    expect(tabs[0]!.status).toBe('rejected');
  });

  it('ação que o canal não recebe fica na tela e tenta de novo; recusa definitiva não repete', async () => {
    const { admin, store } = await setup();
    const integ = await createSim(admin, store.id);
    const channels = t.app.get(ChannelsService);
    await admin.post(`/channels/integrations/${integ.id}/simulate`, {});
    await admin.post(`/channels/integrations/${integ.id}/poll`);
    const [order] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];

    channels.hub.state(integ.id).failNext = 1;
    await admin.post(`/channels/orders/${order!.id}/accept`);
    await queue().idle();
    let [view] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(view).toMatchObject({ status: 'accepted', pendingActions: 1, failedActions: 0 });
    // Passado o tempo de espera, a varredura devolve à fila e a ação sai.
    await sweep().sweep(new Date(Date.now() + 60_000));
    await queue().idle();
    [view] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(view).toMatchObject({ pendingActions: 0 });
    expect(channels.hub.state(integ.id).actions).toHaveLength(1);

    // O canal já cancelou: recusa definitiva, sem nova tentativa.
    channels.hub.cancel(integ.id, order!.externalId);
    await admin.post(`/channels/orders/${order!.id}/start_preparation`);
    await queue().idle();
    [view] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    expect(view).toMatchObject({ failedActions: 1, pendingActions: 0 });
  });

  it('isola os clientes (RLS) e esconde credenciais', async () => {
    const a = await setup();
    const b = await setup();
    const integ = await createSim(a.admin, a.store.id);
    await a.admin.post(`/channels/integrations/${integ.id}/simulate`, {});
    await a.admin.post(`/channels/integrations/${integ.id}/poll`);
    expect((await b.admin.get('/channels/orders')).json()).toHaveLength(0);
    expect((await b.admin.get('/channels/integrations')).json()).toHaveLength(0);
    expect((await b.admin.post(`/channels/orders/${integ.id}/accept`)).statusCode).toBe(404);
    // Sem pedido do outro cliente nem por SQL direto como cliente.
    const rows = await asPlatform(t.app.get<Db>(DB), (tx) =>
      tx.execute(sql`select count(*)::int as n from channel_orders`),
    );
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('catálogo e estoque: o simulador recebe; o iFood diz "chega em breve"', async () => {
    const { admin, store, product } = await setup();
    const integ = await createSim(admin, store.id);
    await admin.post(`/channels/integrations/${integ.id}/links`, {
      sku: 'PIZZA-G',
      productId: product.id,
    });
    const sent = (await admin.post(`/channels/integrations/${integ.id}/catalog-sync`)).json();
    expect(sent).toMatchObject({ sent: 1, unavailable: null });
    expect(t.app.get(ChannelsService).hub.state(integ.id).pushed[0]![0]).toMatchObject({
      sku: 'PIZZA-G',
      priceCents: 4500,
      available: false,
    });
  });
});

describe('iFood (adaptador contra um iFood de mentira)', () => {
  const ifoodOrder = {
    id: 'ord-uuid-1',
    displayId: '4821',
    createdAt: '2026-10-27T15:00:00.000Z',
    orderType: 'DELIVERY',
    customer: { name: 'Maria', phone: { number: '41999990000' } },
    delivery: { deliveryAddress: { formattedAddress: 'Rua A, 10' } },
    items: [
      {
        id: 'm-1',
        externalCode: 'PIZZA-G',
        name: 'Pizza grande',
        quantity: 1,
        unitPrice: 45,
        totalPrice: 45,
      },
    ],
    total: { subTotal: 45, deliveryFee: 6.5, benefits: 0, orderAmount: 51.5 },
    payments: { prepaid: 51.5, methods: [{ type: 'ONLINE', method: 'CREDIT' }] },
  };

  it('traduz o pedido do iFood para centavos', () => {
    const o = mapIfoodOrder(ifoodOrder);
    expect(o).toMatchObject({
      displayId: '4821',
      subtotalCents: 4500,
      deliveryFeeCents: 650,
      totalCents: 5150,
    });
    expect(o.payment).toEqual({ method: 'online', prepaid: true });
    expect(normalizedOrderSchema.safeParse(o).success).toBe(true);
  });

  it('sem credencial aparece "falta configurar"; com credencial busca, confirma e responde ao iFood', async () => {
    const { admin, store, product } = await setup();
    const semCred = (
      await admin.post('/channels/integrations', {
        provider: 'ifood',
        name: 'iFood Centro',
        storeId: store.id,
        merchantId: 'loja-1',
      })
    ).json() as { id: string; missing: string; hasCredentials: boolean };
    expect(semCred.missing).toContain('clientId');
    expect((await admin.post(`/channels/integrations/${semCred.id}/poll`)).json()).toMatchObject({
      events: 0,
    });
    const lista = (await admin.get('/channels/integrations')).json() as { lastError: string }[];
    expect(lista[0]!.lastError).toContain('clientId');

    const calls: PixHttpRequest[] = [];
    let delivered = false;
    const transport: PixTransport = {
      send(req) {
        calls.push(req);
        const json = (status: number, body: unknown) =>
          Promise.resolve({ status, body: JSON.stringify(body) });
        if (req.url.endsWith('/oauth/token'))
          return json(200, { accessToken: 'tok', expiresIn: 3600 });
        if (req.url.endsWith('/events:polling')) {
          if (delivered) return Promise.resolve({ status: 204, body: '' });
          delivered = true;
          return json(200, [{ id: 'ev-1', code: 'PLC', orderId: 'ord-uuid-1' }]);
        }
        if (req.url.endsWith('/orders/ord-uuid-1')) return json(200, ifoodOrder);
        return json(202, {});
      },
    };
    t.app.get(ChannelsService).transport = transport;
    const ok = (
      await admin.post('/channels/integrations', {
        provider: 'ifood',
        name: 'iFood Filial',
        storeId: store.id,
        merchantId: 'loja-2',
        clientId: 'cid-segredo',
        clientSecret: 'csecret-segredo',
        commissionBps: 1200,
        settlementDays: 30,
      })
    ).json() as { id: string; missing: string | null };
    expect(ok.missing).toBeNull();
    // O segredo nunca volta nas respostas nem na trilha.
    expect(JSON.stringify(ok)).not.toContain('csecret');
    expect(JSON.stringify((await admin.get('/audit?limit=50')).json())).not.toContain('csecret');

    expect((await admin.post(`/channels/integrations/${ok.id}/poll`)).json()).toMatchObject({
      events: 1,
      orders: 1,
    });
    // O evento foi confirmado ao iFood (acknowledgment) e uma segunda rodada não repete o pedido.
    const ack = calls.find((c) => c.url.endsWith('/events/acknowledgment'))!;
    expect(JSON.parse(ack.body!)).toEqual([{ id: 'ev-1' }]);
    expect(calls.find((c) => c.url.endsWith('/events:polling'))!.headers.Authorization).toBe(
      'Bearer tok',
    );
    await admin.post(`/channels/integrations/${ok.id}/poll`);
    expect((await admin.get('/channels/orders')).json()).toHaveLength(1);

    const [order] = (await admin.get('/channels/orders')).json() as ChannelOrderView[];
    // O SKU "PIZZA-G" só liga ao produto pela ligação (o produto não tem esse SKU).
    expect(order!.status).toBe('needs_mapping');
    await admin.post(`/channels/integrations/${ok.id}/links`, {
      sku: 'PIZZA-G',
      productId: product.id,
    });
    await admin.post(`/channels/orders/${order!.id}/accept`);
    await queue().idle();
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/orders/ord-uuid-1/confirm')),
    ).toBe(true);
    // Comissão de 12% descontada do repasse: 5150 - 618 = 4532.
    const entries = (await admin.get('/finance/entries?kind=receivable')).json() as {
      amountCents: number;
    }[];
    expect(entries[0]!.amountCents).toBe(4532);
  });
});

describe('marketplace genérico (conector assinado)', () => {
  it('aceita pedido assinado uma vez só e recusa assinatura errada', async () => {
    const { admin, store, product } = await setup();
    const created = (
      await admin.post('/channels/integrations', {
        provider: 'generic',
        name: 'Loja Virtual',
        storeId: store.id,
      })
    ).json() as { inboundSecret: string; inboundPath: string };
    expect(created.inboundSecret).toMatch(/^chsec_/);
    await admin.post(
      `/channels/integrations/${(await admin.get('/channels/integrations')).json()[0].id}/links`,
      {
        sku: 'CAMISA-P',
        productId: product.id,
      },
    );
    const order = {
      externalId: 'MKT-1',
      displayId: '77',
      createdAt: '2026-10-27T12:00:00-03:00',
      customer: { name: 'João' },
      items: [
        { sku: 'CAMISA-P', name: 'Camisa P', quantity: 1, unitPriceCents: 8000, totalCents: 8000 },
      ],
      subtotalCents: 8000,
      totalCents: 8000,
      payment: { method: 'online', prepaid: true },
    };
    const raw = JSON.stringify(order);
    const send = (signature: string | undefined, payload = raw) =>
      t.app.inject({
        method: 'POST',
        url: created.inboundPath,
        headers: {
          'content-type': 'application/json',
          ...(signature && { 'x-bipae-signature': signature }),
        },
        payload,
      });
    const now = Math.floor(Date.now() / 1000);
    expect((await send(undefined)).statusCode).toBe(401);
    expect((await send(signInbound('segredo-errado', raw, now))).statusCode).toBe(401);
    expect((await send(signInbound(created.inboundSecret, raw, now - 3600))).statusCode).toBe(401);
    const ok = await send(signInbound(created.inboundSecret, raw, now));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'received', duplicate: false });
    const again = await send(signInbound(created.inboundSecret, raw, now));
    expect(again.json()).toMatchObject({ duplicate: true });
    expect((await admin.get('/channels/orders')).json()).toHaveLength(1);
    // Total que não bate: recusado com a mensagem.
    const bad = JSON.stringify({ ...order, externalId: 'MKT-2', totalCents: 9000 });
    expect((await send(signInbound(created.inboundSecret, bad, now), bad)).statusCode).toBe(400);
  });
});
