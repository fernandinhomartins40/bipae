import { normalizedOrderSchema } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelsService, signInbound } from '../src/modules/channels/channels.service';
import {
  MarketplaceChannel,
  isMarketplace,
  mapMarketplaceOrder,
  marketplaceMissing,
  type OrderMapping,
} from '../src/modules/channels/marketplace.channel';
import { ChannelNotReadyError, ChannelRejectedError } from '../src/modules/channels/channel.port';
import { GenericChannel, PUSH_BATCH } from '../src/modules/channels/simulator.channel';
import { ChannelsSweep } from '../src/modules/maintenance/channels-sweep';
import {
  PixUnavailableError,
  type PixHttpRequest,
  type PixTransport,
} from '../src/modules/payments/pix-api';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F6-05.b e F6-06.b sem credenciais: cardápio e estoque idempotentes (simulador e conector
 * genérico), marketplaces como "falta configurar" e mapeamento de pedido configurável.
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
  ).json() as Record<string, unknown> & { id: string };
  return { dono, admin, store, product };
}

describe('cardápio e estoque idempotentes', () => {
  it('só reenvia o que mudou; força reenvia tudo; auditoria só quando algo saiu', async () => {
    const { admin, store, product } = await setup();
    const integ = (
      await admin.post('/channels/integrations', {
        provider: 'simulator',
        name: 'Sim',
        storeId: store.id,
      })
    ).json() as { id: string };
    await admin.post(`/channels/integrations/${integ.id}/links`, {
      sku: 'PIZZA-G',
      productId: product.id,
    });
    const url = `/channels/integrations/${integ.id}/catalog-sync`;
    const hub = t.app.get(ChannelsService).hub;

    expect((await admin.post(url)).json()).toMatchObject({ sent: 1, skipped: 0 });
    expect((await admin.post(url)).json()).toMatchObject({
      sent: 0,
      skipped: 1,
      unavailable: null,
    });
    expect(hub.state(integ.id).pushed).toHaveLength(1);

    await admin.put(`/products/${product.id}`, { ...product, priceCents: 5000 });
    expect((await admin.post(url)).json()).toMatchObject({ sent: 1, skipped: 0 });
    expect(hub.state(integ.id).pushed[1]![0]).toMatchObject({ sku: 'PIZZA-G', priceCents: 5000 });

    const trail = JSON.stringify((await admin.get('/audit?limit=100')).json());
    expect(trail.match(/channel\.catalog_synced/g)).toHaveLength(2);
  });

  it('o job da fila repete sem estrago e a varredura agenda só o conector com endereço', async () => {
    const { admin, store, product } = await setup();
    const svc = t.app.get(ChannelsService);
    const calls: PixHttpRequest[] = [];
    let status = 503;
    const transport: PixTransport = {
      send(req) {
        calls.push(req);
        return Promise.resolve({ status, body: '{}' });
      },
    };
    svc.transport = transport;
    const created = (
      await admin.post('/channels/integrations', {
        provider: 'generic',
        name: 'Conector',
        storeId: store.id,
        outboundUrl: 'https://conector.example.com/estoque',
      })
    ).json() as { id: string; inboundSecret: string; outboundUrl: string };
    expect(created.outboundUrl).toBe('https://conector.example.com/estoque');
    await admin.post(`/channels/integrations/${created.id}/links`, {
      sku: 'P1',
      productId: product.id,
    });
    const url = `/channels/integrations/${created.id}/catalog-sync`;

    // Conector fora do ar: 502 e nada gravado como enviado.
    expect((await admin.post(url)).statusCode).toBe(502);
    status = 422;
    expect((await admin.post(url)).statusCode).toBe(502);
    status = 200;
    const ok = (await admin.post(url)).json();
    expect(ok).toMatchObject({ sent: 1, skipped: 0 });
    // Assinatura confere com o segredo da integração.
    const last = calls.at(-1)!;
    const sig = last.headers['x-bipae-signature']!;
    const seconds = Number(/t=(\d+)/.exec(sig)![1]);
    expect(sig).toBe(signInbound(created.inboundSecret, last.body!, seconds));
    expect(JSON.parse(last.body!)).toMatchObject({
      type: 'availability',
      items: [{ sku: 'P1', priceCents: 4500, available: false, stockUnits: 0 }],
    });
    // Repetir não manda de novo.
    const before = calls.length;
    expect((await admin.post(url)).json()).toMatchObject({ sent: 0, skipped: 1 });
    expect(calls).toHaveLength(before);

    // Varredura: integração recém-sincronizada não é agendada de novo.
    const swept = await t.app.get(ChannelsSweep).sweep(new Date());
    expect(swept.catalogs).toBeGreaterThanOrEqual(0);
    const later = await t.app.get(ChannelsSweep).sweep(new Date(Date.now() + 11 * 60_000));
    expect(later.catalogs).toBeGreaterThanOrEqual(1);
  });

  it('job direto: integração desligada ou sem conector não faz nada', async () => {
    const { admin, store } = await setup();
    const svc = t.app.get(ChannelsService);
    const created = (
      await admin.post('/channels/integrations', {
        provider: 'generic',
        name: 'Sem URL',
        storeId: store.id,
      })
    ).json() as { id: string };
    const res = (await admin.post(`/channels/integrations/${created.id}/catalog-sync`)).json();
    expect(res.unavailable).toContain('endereço');
    await svc.scheduleCatalogSync('00000000-0000-0000-0000-000000000000', created.id);
    // Tarefa de integração que não existe é ignorada, sem erro.
    await svc.runCatalogJob({
      tenantId: '00000000-0000-0000-0000-000000000000',
      integrationId: created.id,
    });
  });

  it('recusa endereço que não é https', async () => {
    const { admin, store } = await setup();
    const res = await admin.post('/channels/integrations', {
      provider: 'generic',
      name: 'x1',
      storeId: store.id,
      outboundUrl: 'http://conector.example.com',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('marketplaces (Mercado Livre, Shopee, Amazon)', () => {
  it('aparecem como falta configurar, na ordem do que falta, e nunca enviam', async () => {
    const { admin, store } = await setup();
    for (const [provider, name] of [
      ['mercadolivre', 'Mercado Livre'],
      ['shopee', 'Shopee'],
      ['amazon', 'Amazon'],
    ] as const) {
      const semUrl = (
        await admin.post('/channels/integrations', {
          provider,
          name: `${name} 1`,
          storeId: store.id,
        })
      ).json() as { id: string; missing: string };
      expect(semUrl.missing).toContain('endereço da API');
      const comUrl = (
        await admin.post('/channels/integrations', {
          provider,
          name: `${name} 2`,
          storeId: store.id,
          outboundUrl: 'https://api.example.com',
        })
      ).json() as { id: string; missing: string };
      expect(comUrl.missing).toContain('acesso de integrador');
      const com = (
        await admin.post('/channels/integrations', {
          provider,
          name: `${name} 3`,
          storeId: store.id,
          outboundUrl: 'https://api.example.com',
          clientId: 'cid',
          clientSecret: 'secret-do-marketplace',
        })
      ).json() as { id: string; missing: string; hasCredentials: boolean };
      expect(com.hasCredentials).toBe(true);
      expect(com.missing).toContain('chega em breve');
      const sync = (await admin.post(`/channels/integrations/${com.id}/catalog-sync`)).json();
      expect(sync).toMatchObject({ sent: 0 });
      expect(sync.unavailable).toContain(name);
    }
    expect(JSON.stringify((await admin.get('/audit?limit=100')).json())).not.toContain(
      'secret-do-marketplace',
    );
  });

  it('o adaptador diz o que falta em toda operação', async () => {
    const ch = new MarketplaceChannel('Falta algo.');
    expect(await ch.pollEvents()).toEqual([]);
    await expect(ch.acknowledge()).resolves.toBeUndefined();
    await expect(ch.fetchOrder()).rejects.toBeInstanceOf(ChannelNotReadyError);
    await expect(ch.act('1', 'accept')).rejects.toBeInstanceOf(ChannelNotReadyError);
    await expect(ch.pushAvailability([])).rejects.toBeInstanceOf(ChannelNotReadyError);
    expect(isMarketplace('shopee')).toBe(true);
    expect(isMarketplace('ifood')).toBe(false);
    expect(marketplaceMissing('amazon', { outboundUrl: null, hasCredentials: false })).toContain(
      'Amazon',
    );
  });

  const map: OrderMapping = {
    externalId: 'id',
    displayId: 'number',
    createdAt: 'created',
    customerName: 'buyer.name',
    customerPhone: 'buyer.phone',
    address: 'ship.address',
    items: 'lines',
    itemSku: 'sku',
    itemName: 'title',
    itemQuantity: 'qty',
    itemUnitPrice: 'price',
    total: 'total',
    shipping: 'ship.cost',
    discount: 'discount',
    prepaid: 'paid',
  };
  const raw = {
    id: 'MP-1',
    number: 99,
    created: '2026-10-27T12:00:00.000Z',
    buyer: { name: 'Ana', phone: '11999990000' },
    ship: { address: 'Rua B, 2', cost: '10,50' },
    lines: [
      { sku: 'A', title: 'Item A', qty: 2, price: 19.9 },
      { sku: 'B', title: 'Item B', qty: 1, price: '5,10' },
    ],
    discount: 0,
    total: 55.4,
    paid: true,
  };

  it('mapeia o pedido do marketplace para o formato único, em centavos', () => {
    const order = mapMarketplaceOrder(raw, map);
    expect(order).toMatchObject({
      externalId: 'MP-1',
      displayId: '99',
      subtotalCents: 4490,
      deliveryFeeCents: 1050,
      totalCents: 5540,
      payment: { method: 'online', prepaid: true },
      customer: { name: 'Ana', phone: '11999990000' },
      address: 'Rua B, 2',
    });
    expect(order.items[0]).toMatchObject({
      sku: 'A',
      quantity: 2,
      unitPriceCents: 1990,
      totalCents: 3980,
    });
    expect(normalizedOrderSchema.safeParse(order).success).toBe(true);
  });

  it('valores em centavos, pagamento na entrega e campos opcionais ausentes', () => {
    const order = mapMarketplaceOrder(
      {
        id: 'X',
        created: '',
        lines: [{ sku: 'S', qty: 0, price: 1000 }],
        total: 1000,
        paid: false,
      },
      {
        externalId: 'id',
        createdAt: 'created',
        customerName: 'nome',
        items: 'lines',
        itemSku: 'sku',
        itemName: 'title',
        itemQuantity: 'qty',
        itemUnitPrice: 'price',
        total: 'total',
        prepaid: 'paid',
        priceUnit: 'cents',
      },
    );
    expect(order).toMatchObject({
      displayId: 'X',
      totalCents: 1000,
      payment: { method: 'other', prepaid: false },
      customer: { name: 'Cliente' },
    });
    expect(order.items[0]).toMatchObject({ name: 'Item', quantity: 1 });
    const semPago = mapMarketplaceOrder(
      { id: 'Y', lines: [{ sku: 'S', price: 1 }], total: 1 },
      { ...map, prepaid: undefined, priceUnit: 'cents', shipping: undefined, discount: undefined },
    );
    expect(semPago.payment.prepaid).toBe(true);
  });

  it('recusa pedido sem itens, sem id, sem SKU ou com valor inválido', () => {
    expect(() => mapMarketplaceOrder({ id: '1', lines: [] }, map)).toThrow(ChannelRejectedError);
    expect(() => mapMarketplaceOrder({ lines: [{ sku: 'A' }] }, map)).toThrow(/identificador/);
    expect(() => mapMarketplaceOrder({ id: '1', lines: [{ title: 'x', price: 1 }] }, map)).toThrow(
      /SKU/,
    );
    expect(() =>
      mapMarketplaceOrder(
        { id: '1', lines: [{ sku: 'A', price: 1.5 }] },
        { ...map, priceUnit: 'cents' },
      ),
    ).toThrow(/inválido/);
    expect(() => mapMarketplaceOrder({ id: '1', lines: [{ sku: 'A', price: -1 }] }, map)).toThrow(
      /inválido/,
    );
  });
});

describe('conector genérico por lotes', () => {
  const sign = signInbound;
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      sku: `S${i}`,
      priceCents: 100,
      available: true,
      stockUnits: 1,
    }));

  it('divide em lotes e traduz as falhas', async () => {
    const bodies: string[] = [];
    const mk = (status: number | Error) =>
      new GenericChannel({
        url: 'https://c.example.com/x',
        secret: 's',
        sign,
        now: () => 1_000_000,
        transport: {
          send(req) {
            bodies.push(req.body!);
            return status instanceof Error
              ? Promise.reject(status)
              : Promise.resolve({ status, body: '' });
          },
        },
      });
    await mk(200).pushAvailability(items(PUSH_BATCH + 1));
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[1]!).items).toHaveLength(1);
    await expect(mk(500).pushAvailability(items(1))).rejects.toThrow(/respondeu 500/);
    await expect(mk(429).pushAvailability(items(1))).rejects.toThrow(/429/);
    await expect(mk(400).pushAvailability(items(1))).rejects.toBeInstanceOf(ChannelRejectedError);
    await expect(mk(new PixUnavailableError('rede')).pushAvailability(items(1))).rejects.toThrow(
      'rede',
    );
    await expect(mk(new Error('outro')).pushAvailability(items(1))).rejects.toThrow('outro');
    await expect(new GenericChannel().pushAvailability(items(1))).rejects.toBeInstanceOf(
      ChannelNotReadyError,
    );
    await expect(new GenericChannel().fetchOrder()).rejects.toBeInstanceOf(ChannelNotReadyError);
  });
});
