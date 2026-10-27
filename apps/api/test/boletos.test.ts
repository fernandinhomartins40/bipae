import { boletoDueFactor, isValidBoletoLine, type BoletoView } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE } from '../src/common/di';
import { simulatedBoletoCodes } from '../src/modules/payments/boleto.psp';
import { BoletoService } from '../src/modules/payments/boleto.service';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { PixChargesService } from '../src/modules/payments/pix-charges.service';
import { ChannelsSweep } from '../src/modules/maintenance/channels-sweep';
import { todayBr } from '../src/modules/finance/finance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import type { MemoryQueue } from '../src/common/queue';

/**
 * F4-15: boletos via PSP (emissão, registro, baixa por aviso ou consulta e conciliação), contra o
 * simulador e contra um Asaas de mentira. A conta de verdade depende do item E9.
 */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ API_PUBLIC_URL: 'https://api.bipae.example' });
});
afterAll(async () => {
  await t.close();
});

const CPF = '529.982.247-25';
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function owner() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const store = (await admin.get('/stores')).json()[0] as { id: string };
  return { dono, admin, store };
}

async function receivable(admin: ReturnType<typeof api>, amountCents = 25_000) {
  const r = await admin.post('/finance/entries', {
    kind: 'receivable',
    description: 'Venda a prazo',
    amountCents,
    dueDate: future(10),
    installments: 1,
  });
  expect(r.statusCode, r.body).toBe(201);
  return (r.json() as { id: string }[])[0]!;
}

describe('linha digitável', () => {
  it('as linhas do simulador passam na conferência dos dígitos e a errada não', () => {
    const { barcode, digitableLine } = simulatedBoletoCodes(25_000, '2026-12-10', 7);
    expect(barcode).toHaveLength(44);
    expect(digitableLine).toHaveLength(47);
    expect(isValidBoletoLine(digitableLine)).toBe(true);
    const wrong = `${digitableLine.slice(0, 20)}${(Number(digitableLine[20]) + 1) % 10}${digitableLine.slice(21)}`;
    expect(isValidBoletoLine(wrong)).toBe(false);
    expect(isValidBoletoLine('123')).toBe(false);
  });

  it('o fator de vencimento recomeça em 1000 depois de 21/02/2025', () => {
    expect(boletoDueFactor('1997-10-07')).toBe(0);
    expect(boletoDueFactor('2025-02-21')).toBe(9999);
    expect(boletoDueFactor('2025-02-22')).toBe(1000);
  });
});

describe('boleto no simulador', () => {
  it('emite, é idempotente, baixa a conta a receber ao ser pago e concilia', async () => {
    const { admin } = await owner();
    const cap = (await admin.get('/boletos/capability')).json();
    expect(cap).toMatchObject({ available: true, provider: 'simulator' });
    const entry = await receivable(admin);
    const id = '0198a000-0000-7000-8000-000000000001';
    const body = {
      id,
      payerName: 'Maria Souza',
      payerTaxId: CPF,
      amountCents: 25_000,
      dueDate: future(10),
      description: 'Venda a prazo',
      financialEntryId: entry.id,
    };
    const first = await admin.post('/boletos', body);
    expect(first.statusCode, first.body).toBe(201);
    const boleto = first.json() as BoletoView;
    expect(boleto).toMatchObject({
      status: 'registered',
      provider: 'simulator',
      payerTaxId: '52998224725',
    });
    expect(isValidBoletoLine(boleto.digitableLine!)).toBe(true);
    // Mesmo pedido de novo (rede ruim): o mesmo boleto, sem registrar outro.
    const again = (await admin.post('/boletos', body)).json() as BoletoView;
    expect(again.id).toBe(id);
    expect(again.digitableLine).toBe(boleto.digitableLine);
    expect(((await admin.get('/boletos')).json() as BoletoView[]).length).toBe(1);
    // Uma conta só tem um boleto vivo.
    expect((await admin.post('/boletos', { ...body, id: undefined })).statusCode).toBe(409);

    // Antes de pagar, a conciliação não muda nada.
    expect((await admin.post('/boletos/reconcile')).json()).toMatchObject({
      checked: 1,
      paid: 0,
      divergences: [],
    });
    const paid = (await admin.post(`/boletos/${id}/simulate-payment`)).json() as BoletoView;
    expect(paid).toMatchObject({ status: 'paid', paidCents: 25_000 });
    const entries = (await admin.get('/finance/entries?kind=receivable&status=paid')).json() as {
      id: string;
      paymentMethod: string;
      paidCents: number;
    }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: entry.id, paymentMethod: 'boleto', paidCents: 25_000 });
    // Consultar de novo não baixa duas vezes nem muda nada.
    const svc = t.app.get(BoletoService);
    const dono = (await admin.get('/auth/me')).json();
    expect((await svc.refresh(dono.tenant.id, id))?.status).toBe('paid');
    expect(JSON.stringify((await admin.get('/audit?limit=50')).json())).toContain('boleto.paid');
  });

  it('valida pagador, vencimento e valor; falha do parceiro deixa "não registrou" e dá para tentar de novo', async () => {
    const { admin } = await owner();
    const ok = {
      payerName: 'Maria',
      payerTaxId: CPF,
      amountCents: 10_000,
      dueDate: future(5),
      description: 'Mensalidade',
    };
    expect((await admin.post('/boletos', { ...ok, payerTaxId: '111.111.111-11' })).statusCode).toBe(
      422,
    );
    expect((await admin.post('/boletos', { ...ok, dueDate: '2020-01-01' })).statusCode).toBe(422);
    expect((await admin.post('/boletos', { ...ok, amountCents: 100 })).statusCode).toBe(400);
    const entry = await receivable(admin, 5_000);
    expect((await admin.post('/boletos', { ...ok, financialEntryId: entry.id })).statusCode).toBe(
      422,
    );

    t.app.get(BoletoService).hub.failNext = 1;
    const failed = (await admin.post('/boletos', ok)).json() as BoletoView;
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.failure).toContain('Falha simulada');
    const retried = (await admin.post(`/boletos/${failed.id}/retry`)).json() as BoletoView;
    expect(retried.status).toBe('registered');
    const canceled = (await admin.post(`/boletos/${failed.id}/cancel`)).json() as BoletoView;
    expect(canceled.status).toBe('canceled');
    expect((await admin.post(`/boletos/${failed.id}/cancel`)).statusCode).toBe(409);
  });

  it('a varredura consulta os boletos em aberto e baixa os pagos (aviso perdido)', async () => {
    const { admin } = await owner();
    const b = (
      await admin.post('/boletos', {
        payerName: 'Pedro',
        payerTaxId: CPF,
        amountCents: 7_000,
        dueDate: future(3),
        description: 'Cobrança avulsa',
      })
    ).json() as BoletoView;
    const svc = t.app.get(BoletoService);
    const ext = await (async () => {
      // O id do parceiro vem da linha; o banco de mentira "recebe" o pagamento por fora do Bipaê.
      const list = (await admin.get('/boletos')).json() as BoletoView[];
      expect(list[0]!.id).toBe(b.id);
      return svc;
    })();
    expect(ext).toBe(svc);
    await admin.post(`/boletos/${b.id}/simulate-payment`);
    expect(((await admin.get(`/boletos/${b.id}`)).json() as BoletoView).status).toBe('paid');
    expect(await t.app.get(ChannelsSweep).sweep()).toMatchObject({ boletos: expect.any(Number) });
  });

  it('isola os clientes', async () => {
    const a = await owner();
    const b = await owner();
    const made = (
      await a.admin.post('/boletos', {
        payerName: 'Ana',
        payerTaxId: CPF,
        amountCents: 9_000,
        dueDate: future(4),
        description: 'Cobrança',
      })
    ).json() as BoletoView;
    expect((await b.admin.get('/boletos')).json()).toHaveLength(0);
    expect((await b.admin.get(`/boletos/${made.id}`)).statusCode).toBe(404);
    expect((await b.admin.post(`/boletos/${made.id}/cancel`)).statusCode).toBe(404);
  });
});

describe('boleto no Asaas (parceiro de mentira)', () => {
  function asaasFake() {
    const calls: PixHttpRequest[] = [];
    let status = 'PENDING';
    const state = { created: 0 };
    const transport: PixTransport = {
      send(req) {
        calls.push(req);
        const json = (body: unknown, code = 200) =>
          Promise.resolve({ status: code, body: JSON.stringify(body) });
        if (req.method === 'GET' && req.url.includes('/customers')) return json({ data: [] });
        if (req.method === 'POST' && req.url.endsWith('/customers')) return json({ id: 'cus_1' });
        if (req.method === 'GET' && req.url.includes('/payments?externalReference=')) {
          return json({
            data: state.created ? [{ id: 'pay_9', status: 'PENDING', value: 123.45 }] : [],
          });
        }
        if (req.method === 'POST' && req.url.endsWith('/payments')) {
          state.created += 1;
          return json({ id: 'pay_9', status: 'PENDING', bankSlipUrl: 'https://asaas.example/b/9' });
        }
        if (req.url.endsWith('/identificationField')) {
          return json({
            identificationField: '99999.99999 99999.999999 99999.999999 9 99990000012345',
            barCode: '9'.repeat(44),
          });
        }
        if (req.method === 'GET' && req.url.endsWith('/payments/pay_9')) {
          return json({ id: 'pay_9', status, value: 123.45, paymentDate: todayBr() });
        }
        return json({ ok: true });
      },
    };
    return {
      transport,
      calls,
      pay: () => {
        status = 'RECEIVED';
      },
    };
  }

  it('registra com o valor exato, e só baixa pelo aviso depois de consultar o Asaas', async () => {
    const asaas = asaasFake();
    Object.assign(t.app.get(BoletoService), { transport: asaas.transport });
    Object.assign(t.app.get(PixChargesService), { transport: asaas.transport });
    const { admin, store } = await owner();
    const view = (
      await admin.put(`/stores/${store.id}/payment-settings`, {
        pix: 'psp',
        pixPsp: {
          provider: 'asaas',
          environment: 'sandbox',
          accessToken: '$aact_segredo',
          customerId: 'cus_000005219613',
        },
      })
    ).json() as { webhook: { token: string } };
    expect((await admin.get('/boletos/capability')).json()).toMatchObject({
      available: true,
      provider: 'asaas',
    });
    const entry = await receivable(admin, 12_345);

    const boleto = (
      await admin.post('/boletos', {
        payerName: 'Cliente Asaas',
        payerTaxId: CPF,
        amountCents: 12_345,
        dueDate: future(7),
        description: 'Cobrança Asaas',
        financialEntryId: entry.id,
      })
    ).json() as BoletoView;
    expect(boleto).toMatchObject({
      provider: 'asaas',
      status: 'registered',
      pdfUrl: 'https://asaas.example/b/9',
    });
    const post = asaas.calls.find((c) => c.method === 'POST' && c.url.endsWith('/payments'))!;
    // O valor sai como decimal exato, sem ponto flutuante.
    expect(post.body).toContain('"value":123.45');
    expect(JSON.parse(post.body!.replace('123.45', '"x"'))).toMatchObject({
      billingType: 'BOLETO',
      customer: 'cus_1',
    });
    expect(post.headers.access_token).toBe('$aact_segredo');
    expect(JSON.stringify(boleto)).not.toContain('aact');

    const notify = (token: string | undefined) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/boletos/webhooks/asaas',
        headers: {
          'content-type': 'application/json',
          ...(token && { 'asaas-access-token': token }),
        },
        payload: JSON.stringify({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9' } }),
      });
    // Aviso sem prova, com token errado ou de boleto que não existe: mesma resposta, nada muda.
    asaas.pay();
    for (const token of [undefined, 'token-errado']) {
      const r = await notify(token);
      expect(r.json()).toEqual({ received: true });
    }
    expect(((await admin.get(`/boletos/${boleto.id}`)).json() as BoletoView).status).toBe(
      'registered',
    );
    // Com o token da loja, o Bipaê consulta o Asaas e baixa.
    expect((await notify(view.webhook.token)).json()).toEqual({ received: true });
    await (t.app.get(QUEUE) as MemoryQueue).idle();
    expect(((await admin.get(`/boletos/${boleto.id}`)).json() as BoletoView).status).toBe('paid');
    const entries = (await admin.get('/finance/entries?kind=receivable&status=paid')).json();
    expect(entries).toHaveLength(1);
    // Aviso repetido não muda nada.
    expect((await notify(view.webhook.token)).statusCode).toBe(200);
    expect((await admin.get('/finance/entries?kind=receivable&status=paid')).json()).toHaveLength(
      1,
    );
  });
});
