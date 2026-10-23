import type { CardChargeView, PaymentSettingsView, PixChargeView } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE } from '../src/common/di';
import type { MemoryQueue } from '../src/common/queue';
import { CardChargesService } from '../src/modules/payments/card-charges.service';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { PixChargesService } from '../src/modules/payments/pix-charges.service';
import {
  mercadoPagoSignature,
  pagBankSignature,
  WEBHOOK_MAX_BYTES,
} from '../src/modules/payments/payment-webhooks';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F8-09.c.2: avisos (webhooks) do banco (API Pix do Banco Central), do Mercado Pago (Pix e Point),
 * do PagBank e do Asaas. O aviso nunca confirma sozinho: só a consulta simulada ao parceiro.
 */

const BASE = 'https://pix.banco-simulado.example/v2';
const TOKEN_URL = 'https://pix.banco-simulado.example/oauth/token';
const TERMINAL = 'NEWLAND_N950__SBX0000001';

/** Parceiro simulado: responde pela função e guarda cada chamada. */
function fake(respond: (req: PixHttpRequest) => { status: number; body: unknown }) {
  const calls: PixHttpRequest[] = [];
  const transport: PixTransport = {
    send(req) {
      calls.push(req);
      const { status, body } = respond(req);
      return Promise.resolve({
        status,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    },
  };
  return { transport, calls, gets: () => calls.filter((c) => c.method === 'GET').length };
}

let t: TestApp;
let queue: MemoryQueue;
beforeAll(async () => {
  t = await createTestApp({ API_PUBLIC_URL: 'https://api.bipae.example' });
  queue = t.app.get(QUEUE) as MemoryQueue;
});
afterAll(async () => {
  await t.close();
});

const RECEIVED = { received: true };

/** Manda o aviso como o parceiro manda e espera a conferência na fila terminar. */
async function notify(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/v1/payments/webhooks/${path}`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
  await queue.idle();
  return res;
}

async function owner() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const store = (await admin.get('/stores')).json()[0] as { id: string };
  return { dono, admin, store, url: `/stores/${store.id}/payment-settings` };
}

describe('aviso da API Pix do banco (F8-09.c.2)', () => {
  it('confirma só depois que a consulta ao banco diz que pagou; repetido e desconhecido não mudam nada', async () => {
    const cobs = new Map<string, { status: string; pix?: unknown[] }>();
    const bank = fake((req) => {
      if (req.url === TOKEN_URL) {
        return { status: 200, body: { access_token: 'tk', expires_in: 3600 } };
      }
      const txid = req.url.split('/cob/')[1]!;
      if (req.method === 'PUT') {
        cobs.set(txid, { status: 'ATIVA' });
        return { status: 201, body: { txid, status: 'ATIVA', pixCopiaECola: `000201${txid}` } };
      }
      const c = cobs.get(txid);
      return c ? { status: 200, body: { txid, ...c } } : { status: 404, body: {} };
    });
    Object.assign(t.app.get(PixChargesService), { transport: bank.transport });
    const { admin, store, url } = await owner();

    // Antes de salvar, a loja ainda não tem o segredo nem o endereço do banco.
    const antes = (await admin.get(url)).json() as PaymentSettingsView;
    expect(antes.webhook.pixApiUrl).toBeNull();

    const salvo = await admin.put(url, {
      pix: 'api',
      pixKey: 'loja@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN_URL, clientId: 'c1', clientSecret: 's1' },
    });
    expect(salvo.statusCode).toBe(200);
    const view = salvo.json() as PaymentSettingsView;
    const token = view.webhook.token!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.webhook.pixApiUrl).toBe(
      `https://api.bipae.example/v1/payments/webhooks/pix-api/${token}`,
    );
    // O segredo nunca vai para a trilha de auditoria.
    expect(JSON.stringify((await admin.get('/audit?limit=5')).json())).not.toContain(token);

    const charge = (
      await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 1500 })
    ).json() as PixChargeView;
    const status = async () =>
      ((await admin.get(`/payments/pix/charges/${charge.txid}`)).json() as PixChargeView).status;
    const path = `pix-api/${token}/pix`;
    const aviso = (txid: string) => ({
      pix: [{ endToEndId: 'E1234567820261022120000000000001', txid, valor: '15.00' }],
    });

    // Desconhecido: 200 igual, nenhuma consulta.
    const desconhecido = await notify(path, aviso('A'.repeat(32)));
    expect(desconhecido.statusCode).toBe(200);
    expect(desconhecido.json()).toEqual(RECEIVED);
    expect(bank.gets()).toBe(0);

    // Segredo errado no endereço: ignorado, sem consulta.
    const errado = await notify(`pix-api/${'x'.repeat(43)}/pix`, aviso(charge.txid));
    expect(errado.json()).toEqual(RECEIVED);
    expect(bank.gets()).toBe(0);

    // Aviso válido, mas o banco diz que a cobrança segue ativa: não confirma.
    await notify(path, aviso(charge.txid));
    expect(bank.gets()).toBe(1);
    expect(await status()).toBe('pending');

    // Agora o banco diz que pagou: o aviso confirma na hora (sem esperar os 2 segundos).
    cobs.set(charge.txid, {
      status: 'CONCLUIDA',
      pix: [{ endToEndId: 'E1234567820261022120000000000001', valor: '15.00' }],
    });
    await notify(path, aviso(charge.txid));
    const pago = (await admin.get(`/payments/pix/charges/${charge.txid}`)).json() as PixChargeView;
    expect(pago).toMatchObject({ status: 'paid', endToEndId: 'E1234567820261022120000000000001' });
    const consultas = bank.gets();

    // Repetido: responde igual e não consulta nem muda nada.
    const repetido = await notify(path, aviso(charge.txid));
    expect(repetido.json()).toEqual(RECEIVED);
    expect(bank.gets()).toBe(consultas);

    // Sem /pix no fim (alguns bancos), corpo estranho e corpo grande demais: 200 e nada muda.
    expect((await notify(`pix-api/${token}`, { evento: 'teste_webhook' })).json()).toEqual(
      RECEIVED,
    );
    const grande = JSON.stringify({ pix: [], lixo: 'x'.repeat(WEBHOOK_MAX_BYTES) });
    expect((await notify(path, grande)).json()).toEqual(RECEIVED);
    expect(bank.gets()).toBe(consultas);
  });
});

describe('aviso do Mercado Pago (F8-09.c.2)', () => {
  it('Pix e Point: assinatura x-signature conferida e confirmação só pela consulta', async () => {
    const payments = new Map<string, string>();
    const orders = new Map<string, string>();
    const mp = fake((req) => {
      const path = req.url.replace('https://api.mercadopago.com', '');
      if (req.method === 'POST' && path === '/v1/payments') {
        payments.set('9001', 'pending');
        return {
          status: 201,
          body: {
            id: 9001,
            status: 'pending',
            point_of_interaction: { transaction_data: { qr_code: '00020101mp' } },
          },
        };
      }
      if (req.method === 'POST' && path === '/v1/orders') {
        const id = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
        orders.set(id, 'at_terminal');
        return { status: 201, body: { id, status: 'created' } };
      }
      if (path.startsWith('/v1/payments/')) {
        const id = path.split('/')[3]!;
        return { status: 200, body: { id: Number(id), status: payments.get(id) } };
      }
      const id = path.split('/')[3]!;
      return {
        status: 200,
        body: {
          id,
          status: orders.get(id),
          transactions: { payments: [{ id: 'PAY01', status: 'processed', amount: '10.00' }] },
        },
      };
    });
    Object.assign(t.app.get(PixChargesService), { transport: mp.transport });
    Object.assign(t.app.get(CardChargesService), { transport: mp.transport });
    const { admin, store, url } = await owner();
    const SECRET = 'assinatura-secreta-do-mp';
    const salvo = await admin.put(url, {
      card: 'mp_point',
      mpPoint: { terminalId: TERMINAL, accessToken: 'APP_USR-teste' },
      pix: 'psp',
      pixPsp: { provider: 'mercadopago', accessToken: 'APP_USR-teste', payerEmail: 'a@b.com.br' },
      mpWebhookSecret: SECRET,
    });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.body).not.toContain(SECRET);
    const view = salvo.json() as PaymentSettingsView;
    expect(view.webhook).toMatchObject({
      hasMercadoPagoSecret: true,
      mercadopagoUrl: 'https://api.bipae.example/v1/payments/webhooks/mercadopago',
    });

    const pix = (
      await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 1000 })
    ).json() as PixChargeView;
    const card = (
      await admin.post('/payments/card/charges', {
        storeId: store.id,
        amountCents: 1000,
        method: 'debit',
      })
    ).json() as CardChargeView;

    const send = (type: 'payment' | 'order', id: string, secret = SECRET) => {
      const ts = '1742505638683';
      const requestId = 'b1b2c3d4-0000-4000-8000-000000000001';
      const v1 = mercadoPagoSignature(secret, { dataId: id.toLowerCase(), requestId, ts });
      return notify(
        `mercadopago?data.id=${id}&type=${type}`,
        { action: `${type}.updated`, type, data: { id } },
        { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      );
    };

    // Assinatura com outro segredo: ignorado, sem consulta.
    const antes = mp.gets();
    expect((await send('payment', '9001', 'outro-segredo')).json()).toEqual(RECEIVED);
    expect(mp.gets()).toBe(antes);

    // Assinado, mas o Mercado Pago diz que segue pendente: não confirma.
    await send('payment', '9001');
    expect(mp.gets()).toBe(antes + 1);
    const pendente = (await admin.get(`/payments/pix/charges/${pix.txid}`)).json();
    expect(pendente.status).toBe('pending');

    payments.set('9001', 'approved');
    await send('payment', '9001');
    const pago = (await admin.get(`/payments/pix/charges/${pix.txid}`)).json() as PixChargeView;
    expect(pago).toMatchObject({ status: 'paid', endToEndId: '9001' });

    // Point: ordem processada confirma depois da consulta; aviso repetido não consulta de novo.
    orders.set('ORD01JQ4S4KY8HWQ6NA5PXB65B3D3', 'processed');
    await send('order', 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3');
    const aprovado = (await admin.get(`/payments/card/charges/${card.id}`)).json();
    expect(aprovado).toMatchObject({ status: 'paid', paymentId: 'PAY01' });
    const depois = mp.gets();
    await send('order', 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3');
    await send('payment', '9001');
    expect(mp.gets()).toBe(depois);

    // Sem assinatura nenhuma: ignorado.
    expect(
      (
        await notify('mercadopago?data.id=9001&type=payment', {
          type: 'payment',
          data: { id: '1' },
        })
      ).json(),
    ).toEqual(RECEIVED);
    expect(mp.gets()).toBe(depois);
  });
});

describe('aviso do PagBank e do Asaas (F8-09.c.2)', () => {
  it('PagBank: endereço do aviso no pedido e x-authenticity-token conferido', async () => {
    let paid = false;
    const pb = fake((req) =>
      req.method === 'POST'
        ? {
            status: 201,
            body: {
              id: 'ORDE_ABC',
              qr_codes: [{ id: 'Q', text: '00020101pb', expiration_date: '2099-01-01T00:00:00Z' }],
            },
          }
        : {
            status: 200,
            body: { id: 'ORDE_ABC', charges: paid ? [{ id: 'CHAR_1', status: 'PAID' }] : [] },
          },
    );
    Object.assign(t.app.get(PixChargesService), { transport: pb.transport });
    const { admin, store, url } = await owner();
    expect(
      (
        await admin.put(url, {
          pix: 'psp',
          pixPsp: {
            provider: 'pagbank',
            environment: 'sandbox',
            accessToken: 'token-pagbank',
            payerName: 'Consumidor Final',
            payerEmail: 'caixa@loja.com.br',
            payerTaxId: '111.444.777-35',
          },
        })
      ).statusCode,
    ).toBe(200);
    const charge = (
      await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 990 })
    ).json() as PixChargeView;
    expect(JSON.parse(pb.calls[0]!.body!).notification_urls).toEqual([
      'https://api.bipae.example/v1/payments/webhooks/pagbank',
    ]);

    const body = JSON.stringify({
      id: 'ORDE_ABC',
      reference_id: charge.txid,
      charges: [{ id: 'CHAR_1', status: 'PAID' }],
    });
    // O corpo diz PAID, mas a assinatura é de outro token: ignorado.
    await notify('pagbank', body, { 'x-authenticity-token': pagBankSignature('outro', body) });
    expect(pb.gets()).toBe(0);
    // Assinado certo, mas a consulta diz que não pagou: segue pendente.
    const sig = { 'x-authenticity-token': pagBankSignature('token-pagbank', body) };
    await notify('pagbank', body, sig);
    expect(pb.gets()).toBe(1);
    expect((await admin.get(`/payments/pix/charges/${charge.txid}`)).json().status).toBe('pending');
    paid = true;
    await notify('pagbank', body, sig);
    expect((await admin.get(`/payments/pix/charges/${charge.txid}`)).json()).toMatchObject({
      status: 'paid',
      endToEndId: 'CHAR_1',
    });
  });

  it('Asaas: token da loja no cabeçalho asaas-access-token', async () => {
    let status = 'PENDING';
    const asaas = fake((req) => {
      if (req.method === 'POST') return { status: 200, body: { id: 'pay_77', status: 'PENDING' } };
      if (req.url.endsWith('/pixQrCode')) return { status: 200, body: { payload: '00020101as' } };
      return { status: 200, body: { id: 'pay_77', status } };
    });
    Object.assign(t.app.get(PixChargesService), { transport: asaas.transport });
    const { admin, store, url } = await owner();
    const view = (
      await admin.put(url, {
        pix: 'psp',
        pixPsp: {
          provider: 'asaas',
          environment: 'sandbox',
          accessToken: '$aact_teste',
          customerId: 'cus_000005219613',
        },
      })
    ).json() as PaymentSettingsView;
    expect(view.webhook.asaasUrl).toBe('https://api.bipae.example/v1/payments/webhooks/asaas');
    const token = view.webhook.token!;
    const charge = (
      await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 500 })
    ).json() as PixChargeView;
    const gets = () =>
      asaas.calls.filter((c) => c.method === 'GET' && !c.url.endsWith('/pixQrCode')).length;
    const aviso = {
      id: 'evt_1',
      event: 'PAYMENT_RECEIVED',
      payment: { object: 'payment', id: 'pay_77', externalReference: charge.txid },
    };

    // Token errado ou ausente: ignorado.
    await notify('asaas', aviso, { 'asaas-access-token': 'x'.repeat(43) });
    await notify('asaas', aviso);
    expect(gets()).toBe(0);
    // Evento que não é de cobrança: ignorado.
    await notify('asaas', { id: 'evt_2', event: 'TRANSFER_DONE' }, { 'asaas-access-token': token });
    expect(gets()).toBe(0);
    // Token certo e consulta ainda pendente: não confirma.
    await notify('asaas', aviso, { 'asaas-access-token': token });
    expect(gets()).toBe(1);
    expect((await admin.get(`/payments/pix/charges/${charge.txid}`)).json().status).toBe('pending');
    status = 'RECEIVED';
    await notify('asaas', aviso, { 'asaas-access-token': token });
    expect((await admin.get(`/payments/pix/charges/${charge.txid}`)).json().status).toBe('paid');

    // Outra empresa não vê a configuração (nem o segredo) desta loja.
    const vizinho = api(t.app, (await signup(t.app)).auth);
    expect((await vizinho.get(url)).statusCode).toBe(404);
  });
});
