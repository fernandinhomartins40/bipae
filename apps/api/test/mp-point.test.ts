import type { CardChargeView, SyncPullResult } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardChargesService } from '../src/modules/payments/card-charges.service';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F8-10: Mercado Pago Point pela Orders API, contra um Mercado Pago simulado. A homologação com
 * as credenciais de teste reais depende do item E26.
 */

const TERMINAL = 'NEWLAND_N950__SBX0000001';

function fakeMercadoPago() {
  const orders = new Map<string, { status: string; amount: string; payment: string }>();
  const requests: PixHttpRequest[] = [];
  let busy = false;
  let n = 0;
  const transport: PixTransport = {
    async send(req) {
      requests.push(req);
      if (req.headers.Authorization !== 'Bearer APP_USR-teste') {
        return { status: 401, body: JSON.stringify({ message: 'invalid access token' }) };
      }
      const path = req.url.replace('https://api.mercadopago.com', '');
      if (req.method === 'POST' && path === '/v1/orders') {
        if (busy) {
          return {
            status: 409,
            body: JSON.stringify({ errors: [{ code: 'already_queued_order_for_terminal' }] }),
          };
        }
        const body = JSON.parse(req.body!) as {
          transactions: { payments: { amount: string }[] };
          config: { point: { terminal_id: string } };
        };
        if (body.config.point.terminal_id !== TERMINAL) {
          return {
            status: 403,
            body: JSON.stringify({ errors: [{ code: 'forbidden_checking_terminal_owner' }] }),
          };
        }
        const id = `ORD${String(++n).padStart(26, '0')}`;
        const amount = body.transactions.payments[0]!.amount;
        orders.set(id, { status: 'created', amount, payment: `PAY${n}` });
        return {
          status: 201,
          body: JSON.stringify({
            id,
            status: 'created',
            transactions: { payments: [{ id: `PAY${n}`, amount, status: 'created' }] },
          }),
        };
      }
      const id = path.split('/')[3]!;
      const order = orders.get(id);
      if (!order) return { status: 404, body: '{}' };
      if (path.endsWith('/cancel')) order.status = 'canceled';
      return {
        status: 200,
        body: JSON.stringify({
          id,
          status: order.status,
          transactions: {
            payments: [{ id: order.payment, amount: order.amount, status: order.status }],
          },
        }),
      };
    },
  };
  return {
    transport,
    requests,
    set(id: string, status: string) {
      orders.get(id)!.status = status;
    },
    lastOrder: () => `ORD${String(n).padStart(26, '0')}`,
    setBusy(v: boolean) {
      busy = v;
    },
  };
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('Mercado Pago Point (F8-10)', () => {
  it('manda o valor para a maquininha e acompanha até aprovar, recusar ou cancelar', async () => {
    const mp = fakeMercadoPago();
    const service = t.app.get(CardChargesService);
    Object.assign(service, { transport: mp.transport });
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const store = (await admin.get('/stores')).json()[0];
    const url = `/stores/${store.id}/payment-settings`;
    const ctx = {
      tenantId: dono.me.tenant.id,
      userId: dono.me.user.id,
      permissions: [],
      storeIds: null,
    } as never;
    const later = (s: number) => new Date(Date.now() + s * 1000);

    // Sem o token na primeira vez, recusa; ID do terminal no formato errado também.
    expect(
      (await admin.put(url, { card: 'mp_point', mpPoint: { terminalId: TERMINAL } })).statusCode,
    ).toBe(400);
    expect(
      (await admin.put(url, { card: 'mp_point', mpPoint: { terminalId: 'SBX', accessToken: 'x' } }))
        .statusCode,
    ).toBe(400);
    const salvo = await admin.put(url, {
      card: 'mp_point',
      mpPoint: { terminalId: TERMINAL, accessToken: 'APP_USR-teste' },
    });
    expect(salvo.json().mpPoint).toEqual({ terminalId: TERMINAL, hasAccessToken: true });
    expect(salvo.body).not.toContain('APP_USR-teste');

    // O caixa da loja fica sabendo que o cartão vai pela Point.
    const terminal = (
      await admin.post('/terminals', { storeId: store.id, name: 'Balcão', platform: 'web' })
    ).json();
    const pull = (
      await api(t.app, { ...dono.auth, 'x-bipae-terminal': terminal.id }).get('/sync/pull?limit=1')
    ).json() as SyncPullResult;
    expect(pull.pricing?.payments?.card).toBe('mp_point');

    // Crédito à vista: o valor vai em reais com duas casas e com chave de idempotência.
    const criada = await admin.post('/payments/card/charges', {
      storeId: store.id,
      amountCents: 4590,
      method: 'credit',
    });
    expect(criada.statusCode).toBe(201);
    const charge = criada.json() as CardChargeView;
    const sent = mp.requests.at(-1)!;
    expect(sent.headers['X-Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(sent.body!)).toMatchObject({
      type: 'point',
      transactions: { payments: [{ amount: '45.90' }] },
      config: {
        point: { terminal_id: TERMINAL },
        payment_method: { default_type: 'credit_card', default_installments: 1 },
      },
    });

    mp.set(mp.lastOrder(), 'at_terminal');
    expect((await service.get(ctx, charge.id, later(3))).status).toBe('pending');
    mp.set(mp.lastOrder(), 'processed');
    expect(await service.get(ctx, charge.id, later(6))).toMatchObject({
      status: 'paid',
      paymentId: 'PAY1',
    });

    // Débito recusado na maquininha.
    const debito = (
      await admin.post('/payments/card/charges', {
        storeId: store.id,
        amountCents: 1000,
        method: 'debit',
      })
    ).json() as CardChargeView;
    mp.set(mp.lastOrder(), 'failed');
    expect(await service.get(ctx, debito.id, later(3))).toMatchObject({
      status: 'failed',
      message: 'A maquininha recusou o pagamento. Tente outro cartão ou outra forma.',
    });

    // Cancelada pelo caixa.
    const outra = (
      await admin.post('/payments/card/charges', {
        storeId: store.id,
        amountCents: 500,
        method: 'debit',
      })
    ).json() as CardChargeView;
    const cancelada = await admin.post(`/payments/card/charges/${outra.id}/cancel`);
    expect(cancelada.json()).toMatchObject({ status: 'canceled' });

    // Maquininha ocupada: mensagem clara.
    mp.setBusy(true);
    const ocupada = await admin.post('/payments/card/charges', {
      storeId: store.id,
      amountCents: 500,
      method: 'debit',
    });
    expect(ocupada.statusCode).toBe(422);
    expect(ocupada.json().message).toContain('já tem uma cobrança esperando');
  });
});
