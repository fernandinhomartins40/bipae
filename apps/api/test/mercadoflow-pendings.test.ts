import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { mercadoflowLinks, stores, terminals } from '../src/db/schema';
import { MercadoflowOutbox } from '../src/modules/mercadoflow/mercadoflow.outbox';
import { signWebhook } from '../src/modules/mercadoflow/mercadoflow.webhook';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * MF-11: o preço aprovado no MercadoFlow vira alteração de preço pendente (a) e o encarte vira
 * promoção pendente da loja (b).
 */

const SEGREDO = 'whsec_precos';
/** Encartes publicados por mercado, como o MercadoFlow devolveria. */
const encartes = new Map<string, unknown[]>();
const recebidos: { path: string; items: Record<string, unknown>[] }[] = [];
let mf: Server;
let t: TestApp;

beforeAll(async () => {
  // O MercadoFlow simulado devolve os encartes do mercado e guarda o que recebe.
  mf = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/api/v1/partner', '').split('?')[0]!;
      const encarte = /^\/markets\/([^/]+)\/promotions$/.exec(path);
      const body =
        path === '/oauth/token'
          ? { access_token: 'mfp_precos', expires_in: 3600 }
          : encarte
            ? { items: encartes.get(encarte[1]!) ?? [] }
            : { ok: true };
      if (req.method === 'POST' && path !== '/oauth/token') {
        const sent = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
          items?: Record<string, unknown>[];
        };
        recebidos.push({ path, items: sent.items ?? [] });
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
    MERCADOFLOW_WEBHOOK_SECRET: SEGREDO,
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});

let mercado = 0;
let entrega = 0;
async function loja() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  const [empresa] = (await admin.get('/companies')).json();
  const [store] = (await admin.get('/stores')).json();
  const marketId = `mk_precos_${++mercado}`;
  await withTenant(t.database.db, ctx as never, (tx) =>
    tx.insert(mercadoflowLinks).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      companyId: empresa.id,
      storeId: store.id,
      marketId,
      status: 'ATIVA',
      createdVia: 'ACCOUNT',
      scopes: ['prices:read', 'prices:write', 'promotions:read'],
    }),
  );
  const produto = (
    await admin.post('/products', {
      name: 'Leite integral 1 L',
      priceCents: 549,
      barcodes: ['7891000100103'],
    })
  ).json();
  const avisar = async (data: Record<string, unknown>) => {
    const evento = JSON.stringify({
      event: 'price.approved',
      marketId,
      occurredAt: '2026-10-16T09:00:00-03:00',
      data,
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/integrations/mercadoflow/webhook',
      headers: {
        'content-type': 'application/json',
        'x-mercadoflow-signature': signWebhook(evento, SEGREDO),
        'x-mercadoflow-delivery': `preco-${++entrega}`,
      },
      payload: evento,
    });
    expect(res.statusCode).toBe(200);
  };
  return { admin, auth: dono.auth, ctx, empresa, store, produto, marketId, avisar };
}

/** O aviso é tratado logo depois da resposta: espera aparecer na lista. */
async function pendencias(admin: ReturnType<typeof api>, quantas: number) {
  for (let i = 0; i < 50; i++) {
    const lista = (await admin.get('/mercadoflow/pendings')).json();
    if (lista.length === quantas) return lista;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  return (await admin.get('/mercadoflow/pendings')).json();
}

describe('preço aprovado no MercadoFlow (MF-11.a)', () => {
  it('vira pendência com o preço atual; aplicar muda o preço do produto e fica na auditoria', async () => {
    const { admin, produto, avisar } = await loja();
    await avisar({ gtin: '7891000100103', price: 5.29, approvedBy: 'Ana Gerente' });
    const [pendente] = await pendencias(admin, 1);
    expect(pendente).toMatchObject({
      kind: 'price',
      problem: null,
      data: {
        gtin: '7891000100103',
        productId: produto.id,
        productName: 'Leite integral 1 L',
        priceCents: 529,
        currentPriceCents: 549,
        approvedBy: 'Ana Gerente',
      },
    });
    // Novo aviso do mesmo produto substitui o anterior.
    await avisar({ gtin: '7891000100103', price: '5.19', approvedBy: 'Ana Gerente' });
    const [nova] = await pendencias(admin, 1);
    expect(nova.data.priceCents).toBe(519);

    expect((await admin.post(`/mercadoflow/pendings/${nova.id}/apply`)).statusCode).toBe(200);
    expect((await admin.get(`/products/${produto.id}`)).json().priceCents).toBe(519);
    expect(await pendencias(admin, 0)).toEqual([]);
    expect((await admin.post(`/mercadoflow/pendings/${nova.id}/apply`)).statusCode).toBe(409);
    const trilha = JSON.stringify((await admin.get('/audit')).json());
    expect(trilha).toContain('mercadoflow.price_applied');
    expect(trilha).toContain('product.price_changed');
  });

  it('loja com tabela de preço: o preço aprovado entra na tabela dela', async () => {
    const { admin, store, produto, avisar } = await loja();
    const tabela = (
      await admin.post('/price-tables', {
        name: 'Loja Centro',
        items: [{ productId: produto.id, priceCents: 559 }],
      })
    ).json();
    await admin.patch(`/stores/${store.id}`, { name: store.name, priceTableId: tabela.id });
    await avisar({ gtin: '7891000100103', price: 4.99 });
    const [pendente] = await pendencias(admin, 1);
    expect(pendente.data.currentPriceCents).toBe(559);
    await admin.post(`/mercadoflow/pendings/${pendente.id}/apply`);
    const tabelas = (await admin.get('/price-tables')).json();
    expect(tabelas[0].items).toEqual([
      expect.objectContaining({ productId: produto.id, priceCents: 499 }),
    ]);
    // O cadastro continua com o preço de antes.
    expect((await admin.get(`/products/${produto.id}`)).json().priceCents).toBe(549);
  });

  it('produto não cadastrado fica com o motivo; descartar tira da lista', async () => {
    const { admin, avisar } = await loja();
    await avisar({ gtin: '7896004000855', price: 12.9 });
    const [pendente] = await pendencias(admin, 1);
    expect(pendente.problem).toContain('Nenhum produto do Bipaê tem este código de barras');
    const aplicar = await admin.post(`/mercadoflow/pendings/${pendente.id}/apply`);
    expect(aplicar.statusCode).toBe(409);
    expect((await admin.post(`/mercadoflow/pendings/${pendente.id}/dismiss`)).statusCode).toBe(200);
    expect(await pendencias(admin, 0)).toEqual([]);
  });

  it('com a opção automática ligada, o preço aprovado já entra sozinho', async () => {
    const { admin, store, produto, avisar } = await loja();
    const auto = await admin.put(`/mercadoflow/links/${store.id}/auto-apply`, { prices: true });
    expect(auto.json()).toEqual({ prices: true, promotions: false });
    await avisar({ gtin: '7891000100103', price: 5.09 });
    let preco = 0;
    for (let i = 0; i < 50 && preco !== 509; i++) {
      preco = (await admin.get(`/products/${produto.id}`)).json().priceCents;
      if (preco !== 509) await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(preco).toBe(509);
    expect(await pendencias(admin, 0)).toEqual([]);
    const overview = (await admin.get('/mercadoflow')).json();
    expect(overview.stores[0].autoApply).toEqual({ prices: true, promotions: false });
  });

  it('aviso com preço inválido não vira pendência', async () => {
    const { admin, avisar } = await loja();
    await avisar({ gtin: '7891000100103', price: 'grátis' });
    await avisar({ gtin: 'abc', price: 3 });
    expect(await pendencias(admin, 0)).toEqual([]);
  });
});

/** Data AAAA-MM-DD daqui a `dias` dias, em Brasília. */
const dia = (dias: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );

describe('encartes do MercadoFlow (MF-11.b)', () => {
  it('vira promoção pendente; aplicar cria a promoção só da loja e manda o preço promocional', async () => {
    const { admin, store, produto, marketId } = await loja();
    encartes.set(marketId, [
      {
        id: 'enc-1',
        name: 'Ofertas da semana',
        validFrom: dia(0),
        validUntil: dia(6),
        items: [
          {
            gtin: '7891000100103',
            promoPrice: 4.99,
            regularPrice: 5.49,
            unit: 'UN',
            deal: 'De 5,49 por 4,99',
          },
          { gtin: '7896004000855', promoPrice: 9.9, regularPrice: 12.9, unit: 'UN' },
        ],
      },
      // Encarte que já acabou não entra.
      { id: 'enc-velho', name: 'Antigo', validFrom: dia(-10), validUntil: dia(-1), items: [] },
    ]);
    const busca = await admin.post(`/mercadoflow/links/${store.id}/promotions/fetch`);
    expect(busca.json()).toEqual({ found: 1 });
    const [pendente] = await pendencias(admin, 1);
    expect(pendente).toMatchObject({
      kind: 'promotion',
      problem: null,
      data: {
        name: 'Ofertas da semana',
        validFrom: dia(0),
        validUntil: dia(6),
        items: [
          {
            gtin: '7891000100103',
            productId: produto.id,
            promoPriceCents: 499,
            regularPriceCents: 549,
          },
          { gtin: '7896004000855', productId: null, promoPriceCents: 990 },
        ],
      },
    });

    const aplicar = await admin.post(`/mercadoflow/pendings/${pendente.id}/apply`);
    expect(aplicar.json()).toEqual({ ok: true, promotions: 1 });
    const promocoes = (await admin.get('/promotions')).json();
    expect(promocoes).toEqual([
      expect.objectContaining({
        name: 'Ofertas da semana: Leite integral 1 L',
        startsOn: dia(0),
        endsOn: dia(6),
        storeId: store.id,
        rule: {
          kind: 'quantity_tier',
          productIds: [produto.id],
          tiers: [{ minQuantityMilli: 1, unitPriceCents: 499 }],
        },
      }),
    ]);
    // O preço promocional vai ao MercadoFlow pela fila.
    recebidos.length = 0;
    await t.app.get(MercadoflowOutbox).flush(new Date(Date.now() + 2 * 60 * 60_000));
    const precos = recebidos.filter((r) => r.path === `/markets/${marketId}/prices`);
    expect(precos.flatMap((r) => r.items)).toContainEqual({
      gtin: '7891000100103',
      price: 5.49,
      promoPrice: 4.99,
      promoStart: dia(0),
      promoEnd: dia(6),
    });
    // Buscar de novo não traz de volta o encarte já aplicado.
    await admin.post(`/mercadoflow/links/${store.id}/promotions/fetch`);
    expect(await pendencias(admin, 0)).toEqual([]);
    expect(JSON.stringify((await admin.get('/audit')).json())).toContain(
      'mercadoflow.promotion_applied',
    );
  });

  it('a promoção de uma loja não chega ao caixa de outra loja', async () => {
    const { admin, auth, ctx, empresa, store, produto, marketId } = await loja();
    // Segunda loja e um caixa nela (gravados direto: o plano de teste tem uma loja só).
    const outra = uuidv7();
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(stores).values({
        id: outra,
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        name: 'Loja Bairro',
      });
    });
    const caixaDaLoja = (
      await admin.post('/terminals', { storeId: store.id, name: 'Caixa Centro', platform: 'web' })
    ).json();
    const caixaDaOutra = uuidv7();
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(terminals).values({
        id: caixaDaOutra,
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: outra,
        name: 'Caixa Bairro',
        platform: 'web',
        nfceSeries: 2,
      }),
    );
    encartes.set(marketId, [
      {
        id: 'enc-loja',
        name: 'Só no Centro',
        validFrom: dia(0),
        validUntil: dia(3),
        items: [{ gtin: '7891000100103', promoPrice: '4.79' }],
      },
    ]);
    await admin.post(`/mercadoflow/links/${store.id}/promotions/fetch`);
    const [pendente] = await pendencias(admin, 1);
    await admin.post(`/mercadoflow/pendings/${pendente.id}/apply`);
    const promocoesDoCaixa = async (terminalId: string) => {
      const pull = await api(t.app, {
        ...auth,
        'x-bipae-terminal': terminalId,
      }).get('/sync/pull?limit=1');
      return (pull.json().pricing?.promotions ?? []) as { productIds?: string[]; rule?: unknown }[];
    };
    expect(JSON.stringify(await promocoesDoCaixa(caixaDaLoja.id))).toContain(produto.id);
    expect(JSON.stringify(await promocoesDoCaixa(caixaDaOutra))).not.toContain(produto.id);
  });

  it('com a opção automática ligada, o encarte entra sozinho', async () => {
    const { admin, store, marketId } = await loja();
    await admin.put(`/mercadoflow/links/${store.id}/auto-apply`, { promotions: true });
    encartes.set(marketId, [
      {
        id: 'enc-auto',
        name: 'Feirão',
        validFrom: dia(0),
        validUntil: dia(2),
        items: [{ gtin: '7891000100103', promoPrice: 4.5 }],
      },
    ]);
    await admin.post(`/mercadoflow/links/${store.id}/promotions/fetch`);
    expect(await pendencias(admin, 0)).toEqual([]);
    const promocoes = (await admin.get('/promotions')).json();
    expect(promocoes.map((p: { name: string }) => p.name)).toEqual(['Feirão: Leite integral 1 L']);
  });

  it('loja sem a permissão de ler encartes recebe a explicação', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [store] = (await admin.get('/stores')).json();
    const res = await admin.post(`/mercadoflow/links/${store.id}/promotions/fetch`);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('permissão de ler os encartes');
  });
});
