import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@bipae/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPlatform, withTenant } from '../src/db/client';
import {
  mercadoflowLinks,
  mercadoflowOutbox,
  mercadoflowWebhookDeliveries,
} from '../src/db/schema';
import {
  MercadoflowClient,
  MercadoflowError,
  MercadoflowUnavailableError,
} from '../src/modules/mercadoflow/mercadoflow.client';
import { MercadoflowOutbox } from '../src/modules/mercadoflow/mercadoflow.outbox';
import { signWebhook } from '../src/modules/mercadoflow/mercadoflow.webhook';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** MF-01: base da integração com o MercadoFlow, contra um MercadoFlow simulado. */

// ---------------------------------------------------------------- cliente (respostas simuladas)

function fakeFetch(script: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return script(String(url), init);
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const tokenOk = (n: number) =>
  json({ access_token: `mfp_${n}`, token_type: 'Bearer', expires_in: 3600 });

function client(script: Parameters<typeof fakeFetch>[0], extra: { now?: () => number } = {}) {
  const fake = fakeFetch(script);
  const sleeps: number[] = [];
  const c = new MercadoflowClient({
    apiUrl: 'http://mf.test/api/v1/partner',
    clientId: 'bipae',
    clientSecret: 'segredo',
    fetch: fake.fn,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { c, calls: fake.calls, sleeps };
}

describe('cliente do MercadoFlow', () => {
  it('guarda o token, renova 5 minutos antes de vencer e manda o Bearer', async () => {
    let agora = 0;
    let tokens = 0;
    const { c, calls } = client(
      (url) => (url.endsWith('/oauth/token') ? tokenOk(++tokens) : json({ ok: true })),
      { now: () => agora },
    );
    await c.get('/me');
    await c.get('/me', { query: { a: 1, b: undefined } });
    expect(tokens).toBe(1);
    expect(calls[1]!.init.headers).toMatchObject({ Authorization: 'Bearer mfp_1' });
    expect(calls[2]!.url).toBe('http://mf.test/api/v1/partner/me?a=1');
    expect(String(calls[0]!.init.body)).toBe(
      'grant_type=client_credentials&client_id=bipae&client_secret=segredo',
    );
    agora = 3600_000 - 4 * 60_000;
    await c.get('/me');
    expect(tokens).toBe(2);
  });

  it('ao receber 401 renova o token uma vez e repete', async () => {
    let tokens = 0;
    let chamadas = 0;
    const { c } = client((url) => {
      if (url.endsWith('/oauth/token')) return tokenOk(++tokens);
      return ++chamadas === 1 ? json({ erro: 'token vencido' }, 401) : json({ ok: true });
    });
    expect(await c.get('/me')).toEqual({ ok: true });
    expect(tokens).toBe(2);
    // Se continuar 401 depois de renovar, não entra em laço.
    const preso = client((url) =>
      url.endsWith('/oauth/token') ? tokenOk(1) : json({ erro: 'sem acesso' }, 401),
    );
    await expect(preso.c.get('/me')).rejects.toMatchObject({ status: 401, message: 'sem acesso' });
  });

  it('espera e repete em 429 e 5xx, e desiste depois das tentativas', async () => {
    let n = 0;
    const { c, sleeps } = client((url) => {
      if (url.endsWith('/oauth/token')) return tokenOk(1);
      n++;
      if (n === 1) return json({}, 429, { 'retry-after': '2' });
      if (n === 2) return json({}, 503);
      return json({ ok: true });
    });
    expect(await c.post('/x', { a: 1 }, { idempotencyKey: 'k1' })).toEqual({ ok: true });
    expect(sleeps).toEqual([2000, 1000]);
    const fora = client((url) => (url.endsWith('/oauth/token') ? tokenOk(1) : json({}, 500)));
    await expect(fora.c.get('/x')).rejects.toBeInstanceOf(MercadoflowUnavailableError);
    expect(fora.calls.filter((k) => k.url.endsWith('/x'))).toHaveLength(3);
    const rede = client(() => {
      throw new Error('ECONNREFUSED');
    });
    await expect(rede.c.get('/x', { attempts: 1 })).rejects.toThrow(
      'Não foi possível falar com o MercadoFlow',
    );
  });

  it('erro de dado traz a mensagem em português e o corpo, sem repetir', async () => {
    const { c, calls } = client((url) => {
      if (url.endsWith('/oauth/token')) return tokenOk(1);
      if (url.endsWith('/a')) return json({ erro: 'CNPJ inválido' }, 400);
      if (url.endsWith('/b'))
        return json(
          { status: 'JA_TEM_CONTA', message: 'Já existe conta', connect: { code: 'mfx_1' } },
          409,
        );
      return new Response('não é json', { status: 404 });
    });
    await expect(c.get('/a')).rejects.toMatchObject({ status: 400, message: 'CNPJ inválido' });
    const conflito = await c.post('/b', {}).catch((e: MercadoflowError) => e);
    expect(conflito).toBeInstanceOf(MercadoflowError);
    expect((conflito as MercadoflowError).body).toMatchObject({ connect: { code: 'mfx_1' } });
    await expect(c.delete('/c')).rejects.toMatchObject({
      status: 404,
      message: 'O MercadoFlow respondeu 404.',
    });
    expect(calls.filter((k) => k.url.endsWith('/a'))).toHaveLength(1);
  });

  it('credenciais recusadas e integração desligada', async () => {
    const recusado = client(() => json({ error: 'invalid_client' }, 401));
    await expect(recusado.c.get('/me')).rejects.toThrow('recusou as credenciais do Bipaê');
    const desligado = new MercadoflowClient({});
    expect(desligado.enabled).toBe(false);
    await expect(desligado.get('/me')).rejects.toThrow('está desligada');
  });
});

// ---------------------------------------------------------------- outbox e webhook (API)

let mf: Server;
let t: TestApp;
let modo: 'ok' | 'fora' | 'recusa' = 'ok';
const recebidos: { path: string; body: unknown }[] = [];
const SEGREDO = 'whsec_teste_0123456789';

const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  });

beforeAll(async () => {
  mf = createServer(async (req, res) => {
    const text = await readBody(req);
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url?.endsWith('/oauth/token'))
      return send(200, { access_token: 'mfp_teste', expires_in: 3600 });
    if (modo === 'fora') return send(503, {});
    if (modo === 'recusa') return send(400, { erro: 'Lote inválido' });
    recebidos.push({ path: req.url ?? '', body: text ? JSON.parse(text) : null });
    return send(200, { ok: true });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  const porta = (mf.address() as AddressInfo).port;
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${porta}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
    MERCADOFLOW_WEBHOOK_SECRET: SEGREDO,
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});
beforeEach(() => {
  modo = 'ok';
  recebidos.length = 0;
});

async function loja() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  const [store] = (await admin.get('/stores')).json();
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  return { admin, empresa, store, ctx };
}

describe('outbox do MercadoFlow', () => {
  it('envia em lote, não duplica a mesma chave e respeita recusa por item', async () => {
    const { ctx, store } = await loja();
    const outbox = t.app.get(MercadoflowOutbox);
    outbox.register('teste', 10, async (rows, client) => {
      await client.post('/teste', { items: rows.map((r) => r.payload) });
      return rows.map((r) =>
        (r.payload as { ruim?: boolean }).ruim
          ? { id: r.id, outcome: 'rejected' as const, error: 'GTIN inválido' }
          : { id: r.id, outcome: 'sent' as const },
      );
    });
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await outbox.enqueue(tx, {
        tenantId: ctx.tenantId,
        storeId: store.id,
        kind: 'teste',
        dedupeKey: 'a',
        payload: { n: 1 },
      });
      await outbox.enqueue(tx, {
        tenantId: ctx.tenantId,
        kind: 'teste',
        dedupeKey: 'a',
        payload: { n: 2 },
      });
      await outbox.enqueue(tx, {
        tenantId: ctx.tenantId,
        kind: 'teste',
        dedupeKey: 'b',
        payload: { ruim: true },
      });
    });
    expect(await outbox.flush()).toEqual({ sent: 1, rejected: 1, retried: 0 });
    expect(recebidos).toEqual([
      { path: '/api/v1/partner/teste', body: { items: [{ n: 2 }, { ruim: true }] } },
    ]);
    // Recusado não volta para a fila: nada de laço.
    expect(await outbox.flush()).toEqual({ sent: 0, rejected: 0, retried: 0 });
    const linhas = await withTenant(t.database.db, ctx as never, (tx) =>
      tx.select().from(mercadoflowOutbox).where(eq(mercadoflowOutbox.kind, 'teste')),
    );
    expect(linhas.map((l) => [l.dedupeKey, l.status, l.lastError]).sort()).toEqual([
      ['a', 'sent', null],
      ['b', 'rejected', 'GTIN inválido'],
    ]);
  });

  it('com o MercadoFlow fora do ar guarda e tenta de novo depois, com espera crescente', async () => {
    const { ctx } = await loja();
    const outbox = t.app.get(MercadoflowOutbox);
    outbox.register('fora', 10, async (rows, client) => {
      await client.post(
        '/fora',
        rows.map((r) => r.payload),
        { attempts: 1 },
      );
      return rows.map((r) => ({ id: r.id, outcome: 'sent' as const }));
    });
    await withTenant(t.database.db, ctx as never, (tx) =>
      outbox.enqueue(tx, {
        tenantId: ctx.tenantId,
        kind: 'fora',
        dedupeKey: 'v1',
        payload: { venda: 1 },
      }),
    );
    modo = 'fora';
    const agora = new Date();
    expect(await outbox.flush(agora)).toMatchObject({ retried: 1, sent: 0 });
    // Ainda não chegou a hora da nova tentativa.
    modo = 'ok';
    expect(await outbox.flush(agora)).toMatchObject({ sent: 0, retried: 0 });
    expect(await outbox.flush(new Date(agora.getTime() + 61_000))).toMatchObject({ sent: 1 });
    expect(recebidos.at(-1)).toEqual({ path: '/api/v1/partner/fora', body: [{ venda: 1 }] });
  });

  it('item alterado durante o envio não é marcado como enviado: o conteúdo novo sai depois (PIE ACH-22)', async () => {
    const { ctx } = await loja();
    const outbox = t.app.get(MercadoflowOutbox);
    const enviados: unknown[] = [];
    let alterarNoMeio = true;
    outbox.register('corrida', 10, async (rows) => {
      enviados.push(...rows.map((r) => r.payload));
      // O preço muda enquanto o lote está indo.
      if (alterarNoMeio) {
        alterarNoMeio = false;
        await withTenant(t.database.db, ctx as never, (tx) =>
          outbox.enqueue(tx, {
            tenantId: ctx.tenantId,
            kind: 'corrida',
            dedupeKey: 'p1',
            payload: { preco: 200 },
          }),
        );
      }
      return rows.map((r) => ({ id: r.id, outcome: 'sent' as const }));
    });
    await withTenant(t.database.db, ctx as never, (tx) =>
      outbox.enqueue(tx, {
        tenantId: ctx.tenantId,
        kind: 'corrida',
        dedupeKey: 'p1',
        payload: { preco: 100 },
      }),
    );
    await outbox.flush();
    const [linha] = await withTenant(t.database.db, ctx as never, (tx) =>
      tx.select().from(mercadoflowOutbox).where(eq(mercadoflowOutbox.kind, 'corrida')),
    );
    expect(linha).toMatchObject({ status: 'pending', payload: { preco: 200 } });
    await outbox.flush();
    expect(enviados).toEqual([{ preco: 100 }, { preco: 200 }]);
    const [depois] = await withTenant(t.database.db, ctx as never, (tx) =>
      tx.select().from(mercadoflowOutbox).where(eq(mercadoflowOutbox.kind, 'corrida')),
    );
    expect(depois!.status).toBe('sent');
  });

  it('lote recusado inteiro por dado inválido vira recusa, sem repetir', async () => {
    const { ctx } = await loja();
    const outbox = t.app.get(MercadoflowOutbox);
    outbox.register('recusa', 10, async (rows, client) => {
      await client.post(
        '/recusa',
        rows.map((r) => r.payload),
      );
      return rows.map((r) => ({ id: r.id, outcome: 'sent' as const }));
    });
    await withTenant(t.database.db, ctx as never, (tx) =>
      outbox.enqueue(tx, { tenantId: ctx.tenantId, kind: 'recusa', dedupeKey: 'x', payload: {} }),
    );
    modo = 'recusa';
    expect(await outbox.flush()).toMatchObject({ rejected: 1, retried: 0 });
  });
});

describe('webhook do MercadoFlow', () => {
  const enviar = (corpo: unknown, opts: { entrega?: string; assinatura?: string } = {}) => {
    const raw = JSON.stringify(corpo);
    return t.app.inject({
      method: 'POST',
      url: '/v1/integrations/mercadoflow/webhook',
      headers: {
        'content-type': 'application/json',
        'x-mercadoflow-signature': opts.assinatura ?? signWebhook(raw, SEGREDO),
        ...(opts.entrega !== '' && { 'x-mercadoflow-delivery': opts.entrega ?? uuidv7() }),
      },
      payload: raw,
    });
  };

  it('recusa assinatura inválida e aceita a válida uma vez só', async () => {
    const evento = {
      event: 'evento.futuro',
      marketId: 'mk_1',
      occurredAt: '2026-10-13T10:00:00Z',
      data: { a: 1 },
    };
    expect((await enviar(evento, { assinatura: 'sha256=00' })).statusCode).toBe(401);
    expect(
      (await enviar(evento, { assinatura: signWebhook('outro corpo', SEGREDO) })).statusCode,
    ).toBe(401);
    expect((await enviar(evento, { entrega: '' })).statusCode).toBe(400);
    const primeira = await enviar(evento, { entrega: 'entrega-1' });
    expect(primeira.statusCode).toBe(200);
    expect(primeira.json()).toEqual({ received: true, repeated: false });
    expect((await enviar(evento, { entrega: 'entrega-1' })).json()).toEqual({
      received: true,
      repeated: true,
    });
    // Evento de módulo ainda não construído fica guardado para tratar depois.
    const [guardado] = await asPlatform(t.database.db, (tx) =>
      tx
        .select()
        .from(mercadoflowWebhookDeliveries)
        .where(eq(mercadoflowWebhookDeliveries.deliveryId, 'entrega-1')),
    );
    expect(guardado).toMatchObject({ event: 'evento.futuro', marketId: 'mk_1', processedAt: null });
  });

  it('connection.authorized ativa o vínculo da loja e connection.revoked encerra', async () => {
    const { ctx, empresa, store } = await loja();
    const linkId = uuidv7();
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(mercadoflowLinks).values({
        id: linkId,
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: store.id,
        status: 'PENDENTE',
        createdVia: 'CONNECT',
        connectCode: 'mfx_abc',
      }),
    );
    const ok = await enviar({
      event: 'connection.authorized',
      marketId: 'mk_42',
      data: {
        externalStoreId: store.id,
        scopes: ['sales:write', 'confere:use'],
        authorizedBy: 'Maria',
      },
    });
    expect(ok.statusCode).toBe(200);
    const ler = () =>
      withTenant(
        t.database.db,
        ctx as never,
        async (tx) =>
          (await tx.select().from(mercadoflowLinks).where(eq(mercadoflowLinks.id, linkId)))[0]!,
      );
    expect(await ler()).toMatchObject({
      status: 'ATIVA',
      marketId: 'mk_42',
      scopes: ['sales:write', 'confere:use'],
    });
    expect((await ler()).connectedAt).toBeInstanceOf(Date);

    await enviar({ event: 'connection.revoked', marketId: 'mk_42', data: { revokedBy: 'Maria' } });
    expect(await ler()).toMatchObject({
      status: 'REVOGADA',
      lastError: 'Vínculo encerrado no MercadoFlow por Maria.',
    });

    // Aviso para uma loja que o Bipaê não conhece fica registrado com o erro, sem derrubar nada.
    const perdido = await enviar(
      { event: 'connection.authorized', marketId: 'mk_x', data: { externalStoreId: 'nada' } },
      { entrega: 'perdida' },
    );
    expect(perdido.statusCode).toBe(200);
    const [falha] = await asPlatform(t.database.db, (tx) =>
      tx
        .select()
        .from(mercadoflowWebhookDeliveries)
        .where(eq(mercadoflowWebhookDeliveries.deliveryId, 'perdida')),
    );
    expect(falha!.error).toBe('Nenhuma loja do Bipaê espera este vínculo.');
  });
});

describe('sem as variáveis MERCADOFLOW_*', () => {
  it('o Bipaê funciona como hoje: nada entra na fila e o webhook recusa', async () => {
    const semMf = await createTestApp();
    try {
      const dono = await signup(semMf.app);
      const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
      const outbox = semMf.app.get(MercadoflowOutbox);
      await withTenant(semMf.database.db, ctx as never, (tx) =>
        outbox.enqueue(tx, { tenantId: ctx.tenantId, kind: 'x', dedupeKey: '1', payload: {} }),
      );
      expect(await outbox.flush()).toEqual({ sent: 0, rejected: 0, retried: 0 });
      const res = await semMf.app.inject({
        method: 'POST',
        url: '/v1/integrations/mercadoflow/webhook',
        headers: {
          'content-type': 'application/json',
          'x-mercadoflow-signature': 'sha256=00',
          'x-mercadoflow-delivery': 'd',
        },
        payload: '{}',
      });
      expect(res.statusCode).toBe(401);
      expect((await api(semMf.app, dono.auth).get('/products')).statusCode).toBe(200);
    } finally {
      await semMf.close();
    }
  });
});
