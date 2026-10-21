import type { PixChargeView } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { PixChargesService } from '../src/modules/payments/pix-charges.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F8-09: Pix com confirmação automática pela API Pix (padrão do Banco Central), contra um banco
 * simulado. A homologação com um banco de verdade depende do item E9.
 */

const BASE = 'https://pix.banco-simulado.example/v2';
const TOKEN = 'https://pix.banco-simulado.example/oauth/token';

function fakeBank() {
  const charges = new Map<string, { valor: string; status: string; pix?: unknown[] }>();
  const calls: string[] = [];
  let down = false;
  let tokens = 0;
  const transport: PixTransport = {
    async send(req: PixHttpRequest) {
      calls.push(`${req.method} ${req.url.replace(/^https:\/\/[^/]+/, '')}`);
      if (down) return { status: 503, body: '' };
      if (req.url === TOKEN) {
        const auth = req.headers.Authorization ?? '';
        const ok = auth === `Basic ${Buffer.from('cliente-1:segredo-1').toString('base64')}`;
        if (!ok) return { status: 401, body: '{"error":"invalid_client"}' };
        tokens++;
        return {
          status: 200,
          body: JSON.stringify({ access_token: `tk${tokens}`, expires_in: 3600 }),
        };
      }
      if (!req.headers.Authorization?.startsWith('Bearer tk')) return { status: 401, body: '{}' };
      const txid = req.url.split('/cob/')[1]!;
      if (req.method === 'PUT') {
        const body = JSON.parse(req.body!) as { valor: { original: string }; chave: string };
        if (body.chave !== 'loja@exemplo.com.br') {
          return { status: 400, body: JSON.stringify({ detail: 'Chave não pertence à conta' }) };
        }
        charges.set(txid, { valor: body.valor.original, status: 'ATIVA' });
        return {
          status: 201,
          body: JSON.stringify({
            txid,
            status: 'ATIVA',
            valor: body.valor,
            pixCopiaECola: `00020101021226850014br.gov.bcb.pix2563banco-simulado/qr/${txid}5204000053039865802BR6304ABCD`,
          }),
        };
      }
      const c = charges.get(txid);
      if (!c) return { status: 404, body: JSON.stringify({ detail: 'Cobrança não encontrada' }) };
      return {
        status: 200,
        body: JSON.stringify({ txid, status: c.status, pix: c.pix, valor: { original: c.valor } }),
      };
    },
  };
  return {
    transport,
    calls,
    pay(txid: string) {
      const c = charges.get(txid)!;
      c.status = 'CONCLUIDA';
      c.pix = [{ endToEndId: 'E12345678202610211200abcdefghijk', valor: c.valor }];
    },
    setDown(v: boolean) {
      down = v;
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

describe('Pix pela API do banco (F8-09)', () => {
  it('cria a cobrança, mostra o QR e confirma só quando o banco diz que pagou', async () => {
    const bank = fakeBank();
    Object.assign(t.app.get(PixChargesService), { transport: bank.transport });
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const store = (await admin.get('/stores')).json()[0];
    const url = `/stores/${store.id}/payment-settings`;

    // Sem a API configurada, nada de cobrança.
    expect(
      (await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 1000 }))
        .statusCode,
    ).toBe(422);

    // Sem o Client Secret na primeira vez: recusa com o campo certo.
    const semSegredo = await admin.put(url, {
      pix: 'api',
      pixKey: 'loja@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1' },
    });
    expect(semSegredo.statusCode).toBe(400);
    expect(semSegredo.json().issues[0].path).toBe('pixApi.clientSecret');
    // Endereço sem https é recusado.
    expect(
      (
        await admin.put(url, {
          pix: 'api',
          pixKey: 'loja@exemplo.com.br',
          pixApi: {
            baseUrl: 'http://inseguro.example',
            tokenUrl: TOKEN,
            clientId: 'x',
            clientSecret: 'y',
          },
        })
      ).statusCode,
    ).toBe(400);

    const salvo = await admin.put(url, {
      pix: 'api',
      pixKey: 'loja@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1', clientSecret: 'segredo-1' },
    });
    expect(salvo.statusCode).toBe(200);
    // A tela sabe que o segredo está guardado, mas nunca o recebe de volta.
    expect(salvo.json().pixApi).toEqual({
      baseUrl: BASE,
      tokenUrl: TOKEN,
      clientId: 'cliente-1',
      hasClientSecret: true,
      hasCertificate: false,
    });
    expect(salvo.body).not.toContain('segredo-1');
    const audit = JSON.stringify((await admin.get('/audit?limit=5')).json());
    expect(audit).not.toContain('segredo-1');
    // Salvar de novo sem o segredo mantém o guardado.
    expect(
      (
        await admin.put(url, {
          pix: 'api',
          pixKey: 'loja@exemplo.com.br',
          pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1' },
        })
      ).statusCode,
    ).toBe(200);

    const nova = await admin.post('/payments/pix/charges', {
      storeId: store.id,
      amountCents: 2590,
    });
    expect(nova.statusCode).toBe(201);
    const charge = nova.json() as PixChargeView;
    expect(charge).toMatchObject({ amountCents: 2590, status: 'pending', endToEndId: null });
    expect(charge.txid).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(charge.copyPaste).toContain(charge.txid);
    expect(bank.calls).toContain(`PUT /v2/cob/${charge.txid}`);

    // Ainda não pagou.
    const antes = (await admin.get(`/payments/pix/charges/${charge.txid}`)).json() as PixChargeView;
    expect(antes.status).toBe('pending');
    // O caixa pergunta sem parar, mas o banco é consultado no máximo a cada 2 segundos.
    const gets = bank.calls.filter((c) => c.startsWith('GET')).length;
    await admin.get(`/payments/pix/charges/${charge.txid}`);
    expect(bank.calls.filter((c) => c.startsWith('GET')).length).toBe(gets);

    bank.pay(charge.txid);
    const service = t.app.get(PixChargesService);
    const ctx = {
      tenantId: dono.me.tenant.id,
      userId: dono.me.user.id,
      permissions: [],
      storeIds: null,
    } as never;
    const pago = await service.get(ctx, charge.txid, new Date(Date.now() + 3000));
    expect(pago).toMatchObject({ status: 'paid', endToEndId: 'E12345678202610211200abcdefghijk' });
    // O token foi reaproveitado entre as chamadas.
    expect(bank.calls.filter((c) => c.includes('/oauth/token'))).toHaveLength(1);
  });

  it('banco recusando ou fora do ar vira mensagem clara, sem travar o caixa', async () => {
    const bank = fakeBank();
    Object.assign(t.app.get(PixChargesService), { transport: bank.transport });
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const store = (await admin.get('/stores')).json()[0];
    await admin.put(`/stores/${store.id}/payment-settings`, {
      pix: 'api',
      pixKey: 'outra@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1', clientSecret: 'segredo-1' },
    });
    const recusada = await admin.post('/payments/pix/charges', {
      storeId: store.id,
      amountCents: 100,
    });
    expect(recusada.statusCode).toBe(422);
    expect(recusada.json().message).toBe('O banco recusou a cobrança: Chave não pertence à conta.');

    bank.setDown(true);
    await admin.put(`/stores/${store.id}/payment-settings`, {
      pix: 'api',
      pixKey: 'loja@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1' },
    });
    const fora = await admin.post('/payments/pix/charges', { storeId: store.id, amountCents: 100 });
    expect(fora.statusCode).toBe(503);
    expect(fora.json().message).toContain('Tente de novo ou use outro meio.');

    // Credencial errada.
    bank.setDown(false);
    await admin.put(`/stores/${store.id}/payment-settings`, {
      pix: 'api',
      pixKey: 'loja@exemplo.com.br',
      pixApi: { baseUrl: BASE, tokenUrl: TOKEN, clientId: 'cliente-1', clientSecret: 'errado' },
    });
    const negada = await admin.post('/payments/pix/charges', {
      storeId: store.id,
      amountCents: 100,
    });
    expect(negada.statusCode).toBe(422);
    expect(negada.json().message).toContain('recusou o Client ID');
  });
});
