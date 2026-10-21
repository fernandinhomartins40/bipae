import type { PixChargeView } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PixRejectedError,
  PixUnavailableError,
  type PixHttpRequest,
  type PixTransport,
} from '../src/modules/payments/pix-api';
import { PixChargesService } from '../src/modules/payments/pix-charges.service';
import {
  AsaasPixClient,
  brasiliaIso,
  centsToDecimal,
  MercadoPagoPixClient,
  PagBankPixClient,
  type PixPspConfig,
} from '../src/modules/payments/pix-psp';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F8-09.c: Pix pelas APIs próprias de Mercado Pago, PagBank e Asaas, contra parceiros simulados.
 * A homologação com conta de verdade depende do item E9.
 */

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
  return { transport, calls };
}

const config = (provider: PixPspConfig['provider'], extra: Partial<PixPspConfig> = {}) => ({
  provider,
  sandbox: true,
  token: 'token-secreto',
  payerName: 'Consumidor Final',
  payerEmail: 'caixa@loja.com.br',
  payerTaxId: '11144477735',
  customerId: 'cus_000005219613',
  ...extra,
});

const input = {
  reference: 'BIPAE0123456789',
  amountCents: 2590,
  description: 'Venda no caixa',
  expiresAt: new Date('2026-10-21T18:30:00Z'),
};

describe('valores e datas na borda dos parceiros', () => {
  it('centavos viram o texto decimal exato, sem ponto flutuante', () => {
    expect(centsToDecimal(2590)).toBe('25.90');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(100000)).toBe('1000.00');
    expect(() => centsToDecimal(10.5)).toThrow();
  });

  it('data no fuso de Brasília', () => {
    expect(brasiliaIso(new Date('2026-10-21T18:30:00Z'))).toBe('2026-10-21T15:30:00.000-03:00');
  });
});

describe('Mercado Pago (POST /v1/payments)', () => {
  it('cria com o valor exato e a chave de idempotência, e confirma pelo status approved', async () => {
    const mp = fake((req) =>
      req.method === 'POST'
        ? {
            status: 201,
            body: {
              id: 1234,
              status: 'pending',
              point_of_interaction: { transaction_data: { qr_code: '00020101mp' } },
            },
          }
        : { status: 200, body: { id: 1234, status: 'approved' } },
    );
    const client = new MercadoPagoPixClient(config('mercadopago'), mp.transport);
    const charge = await client.create(input);
    expect(charge).toEqual({
      id: '1234',
      copyPaste: '00020101mp',
      status: 'pending',
      paymentRef: null,
    });
    const post = mp.calls[0]!;
    expect(post.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(post.headers['X-Idempotency-Key']).toBe(input.reference);
    expect(post.headers.Authorization).toBe('Bearer token-secreto');
    expect(post.body).toContain('"transaction_amount":25.90');
    expect(JSON.parse(post.body!)).toMatchObject({
      payment_method_id: 'pix',
      external_reference: input.reference,
      date_of_expiration: '2026-10-21T15:30:00.000-03:00',
      payer: { email: 'caixa@loja.com.br', identification: { type: 'CPF', number: '11144477735' } },
    });
    expect(await client.get('1234')).toMatchObject({ status: 'paid', paymentRef: '1234' });
  });

  it('vencido e cancelado; token recusado e parceiro fora do ar viram erros claros', async () => {
    let reply: { status: number; body: unknown } = {
      status: 200,
      body: { id: 9, status: 'cancelled', status_detail: 'expired' },
    };
    const mp = fake(() => reply);
    const client = new MercadoPagoPixClient(config('mercadopago'), mp.transport);
    expect((await client.get('9')).status).toBe('expired');
    reply = { status: 200, body: { id: 9, status: 'cancelled', status_detail: 'by_collector' } };
    expect((await client.get('9')).status).toBe('canceled');
    reply = { status: 401, body: {} };
    await expect(client.get('9')).rejects.toThrow(
      new PixRejectedError(
        'O Mercado Pago recusou o token de acesso. Confira em Meios de pagamento.',
      ),
    );
    reply = {
      status: 400,
      body: { message: 'bad', cause: [{ description: 'payer.email inválido' }] },
    };
    await expect(client.create(input)).rejects.toThrow(
      'O Mercado Pago recusou a cobrança: payer.email inválido.',
    );
    reply = { status: 503, body: '' };
    await expect(client.get('9')).rejects.toBeInstanceOf(PixUnavailableError);
  });
});

describe('PagBank (POST /orders)', () => {
  it('valor em centavos, sandbox no endereço certo e pago pela charge PAID', async () => {
    const pb = fake((req) =>
      req.method === 'POST'
        ? {
            status: 201,
            body: {
              id: 'ORDE_1',
              qr_codes: [
                { id: 'QRCO_1', text: '00020101pb', expiration_date: '2099-01-01T00:00:00-03:00' },
              ],
            },
          }
        : { status: 200, body: { id: 'ORDE_1', charges: [{ id: 'CHAR_1', status: 'PAID' }] } },
    );
    const client = new PagBankPixClient(config('pagbank'), pb.transport);
    expect(await client.create(input)).toMatchObject({
      id: 'ORDE_1',
      copyPaste: '00020101pb',
      status: 'pending',
    });
    expect(pb.calls[0]!.url).toBe('https://sandbox.api.pagseguro.com/orders');
    expect(JSON.parse(pb.calls[0]!.body!)).toMatchObject({
      reference_id: input.reference,
      customer: { name: 'Consumidor Final', tax_id: '11144477735' },
      qr_codes: [{ amount: { value: 2590 } }],
    });
    expect(await client.get('ORDE_1')).toMatchObject({ status: 'paid', paymentRef: 'CHAR_1' });
    // O PagBank não cancela o QR: ele vence sozinho.
    expect(await client.cancel()).toBe(false);
  });

  it('QR vencido sem pagamento vira expirado', async () => {
    const pb = fake(() => ({
      status: 200,
      body: { id: 'ORDE_2', qr_codes: [{ id: 'Q', expiration_date: '2020-01-01T00:00:00-03:00' }] },
    }));
    const client = new PagBankPixClient(config('pagbank', { sandbox: false }), pb.transport);
    expect((await client.get('ORDE_2')).status).toBe('expired');
    expect(pb.calls[0]!.url).toBe('https://api.pagseguro.com/orders/ORDE_2');
  });
});

describe('Asaas (POST /v3/payments)', () => {
  it('cria a cobrança, busca o QR e confirma pelo status RECEIVED', async () => {
    const asaas = fake((req) => {
      if (req.method === 'POST') return { status: 200, body: { id: 'pay_1', status: 'PENDING' } };
      if (req.url.endsWith('/pixQrCode')) return { status: 200, body: { payload: '00020101as' } };
      return { status: 200, body: { id: 'pay_1', status: 'RECEIVED' } };
    });
    const client = new AsaasPixClient(config('asaas'), asaas.transport);
    expect(await client.create(input)).toMatchObject({
      id: 'pay_1',
      copyPaste: '00020101as',
      status: 'pending',
    });
    const post = asaas.calls[0]!;
    expect(post.url).toBe('https://api-sandbox.asaas.com/v3/payments');
    expect(post.headers.access_token).toBe('token-secreto');
    expect(post.body).toContain('"value":25.90');
    expect(JSON.parse(post.body!)).toMatchObject({
      customer: 'cus_000005219613',
      billingType: 'PIX',
      dueDate: '2026-10-21',
    });
    expect(await client.get('pay_1')).toMatchObject({ status: 'paid', paymentRef: 'pay_1' });
  });

  it('vencida e removida', async () => {
    let status = 'OVERDUE';
    let deleted = false;
    const asaas = fake(() => ({ status: 200, body: { id: 'pay_2', status, deleted } }));
    const client = new AsaasPixClient(config('asaas'), asaas.transport);
    expect((await client.get('pay_2')).status).toBe('expired');
    status = 'PENDING';
    deleted = true;
    expect((await client.get('pay_2')).status).toBe('canceled');
  });
});

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('Pix pelo parceiro no caixa (F8-09.c)', () => {
  it('guarda o token selado, cria a cobrança e confirma quando o parceiro diz que pagou', async () => {
    let paid = false;
    const mp = fake((req) =>
      req.method === 'POST'
        ? {
            status: 201,
            body: {
              id: 777,
              status: 'pending',
              point_of_interaction: { transaction_data: { qr_code: '00020101mp777' } },
            },
          }
        : { status: 200, body: { id: 777, status: paid ? 'approved' : 'pending' } },
    );
    Object.assign(t.app.get(PixChargesService), { transport: mp.transport });
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const store = (await admin.get('/stores')).json()[0];
    const url = `/stores/${store.id}/payment-settings`;

    // O Mercado Pago exige o e-mail do pagador padrão.
    const semEmail = await admin.put(url, {
      pix: 'psp',
      pixPsp: { provider: 'mercadopago', accessToken: 'APP_USR-segredo-mp' },
    });
    expect(semEmail.statusCode).toBe(400);
    expect(semEmail.json().issues[0].path).toBe('pixPsp.payerEmail');

    const salvo = await admin.put(url, {
      pix: 'psp',
      pixPsp: {
        provider: 'mercadopago',
        accessToken: 'APP_USR-segredo-mp',
        payerEmail: 'caixa@loja.com.br',
      },
    });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json().pixPsp).toMatchObject({ provider: 'mercadopago', hasAccessToken: true });
    expect(salvo.body).not.toContain('APP_USR-segredo-mp');
    expect(JSON.stringify((await admin.get('/audit?limit=5')).json())).not.toContain(
      'APP_USR-segredo-mp',
    );

    const nova = await admin.post('/payments/pix/charges', {
      storeId: store.id,
      amountCents: 2590,
    });
    expect(nova.statusCode).toBe(201);
    const charge = nova.json() as PixChargeView;
    expect(charge).toMatchObject({
      amountCents: 2590,
      status: 'pending',
      copyPaste: '00020101mp777',
    });
    expect(mp.calls[0]!.headers.Authorization).toBe('Bearer APP_USR-segredo-mp');

    paid = true;
    const ctx = {
      tenantId: dono.me.tenant.id,
      userId: dono.me.user.id,
      permissions: [],
      storeIds: null,
    } as never;
    const pago = await t.app
      .get(PixChargesService)
      .get(ctx, charge.txid, new Date(Date.now() + 3000));
    expect(pago).toMatchObject({ status: 'paid', providerName: 'Pix (Mercado Pago)' });
  });
});
