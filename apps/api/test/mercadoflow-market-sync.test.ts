import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { mercadoflowLinks } from '../src/db/schema';
import { MercadoflowMarketSync } from '../src/modules/mercadoflow/mercadoflow.market-sync';
import { MercadoflowOutbox } from '../src/modules/mercadoflow/mercadoflow.outbox';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** MF-12: cadastro, preço, custo e estoque das lojas vinculadas, contra um MercadoFlow simulado. */

let mf: Server;
let t: TestApp;
const recebidos: { path: string; key: string | undefined; items: Record<string, unknown>[] }[] = [];

beforeAll(async () => {
  mf = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/api/v1/partner', '').split('?')[0]!;
      const send = (payload: unknown) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      if (path === '/oauth/token') return send({ access_token: 'mfp_ms', expires_in: 3600 });
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        items?: Record<string, unknown>[];
      };
      recebidos.push({
        path,
        key: req.headers['idempotency-key'] as string | undefined,
        items: body.items ?? [],
      });
      return send({ ok: true });
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});
beforeEach(() => {
  recebidos.length = 0;
});

let mercado = 0;
async function lojaVinculada(scopes: string[]) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  const [empresa] = (await admin.get('/companies')).json();
  const [store] = (await admin.get('/stores')).json();
  const marketId = `mk_sync_${++mercado}`;
  await withTenant(t.database.db, ctx as never, (tx) =>
    tx
      .insert(mercadoflowLinks)
      .values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: store.id,
        marketId,
        status: 'ATIVA',
        createdVia: 'ACCOUNT',
        scopes,
      }),
  );
  return { admin, store, ctx, marketId };
}

/** Esvazia a fila como a rotina faria (o intervalo do catálogo não pesa aqui). */
const enviar = () => t.app.get(MercadoflowOutbox).flush(new Date(Date.now() + 60 * 60_000));
const doMercado = (marketId: string, recurso: string) =>
  recebidos.filter((r) => r.path === `/markets/${marketId}/${recurso}`);

describe('envio às lojas vinculadas (MF-12)', () => {
  it('produto novo: cadastro, preço da loja e custo, com chave de idempotência', async () => {
    const { admin, store, marketId } = await lojaVinculada([
      'catalog:write',
      'prices:write',
      'costs:write',
    ]);
    const produto = (
      await admin.post('/products', {
        name: 'Arroz Tipo 1 5kg',
        priceCents: 2890,
        costCents: 2100,
        barcodes: ['7891000315507', '2000001000005'],
        catalog: { brand: 'Marca A', department: 'Mercearia' },
      })
    ).json();
    // Tabela de preço da loja: o preço enviado é o dela.
    const tabela = (
      await admin.post('/price-tables', {
        name: 'Loja Centro',
        items: [{ productId: produto.id, priceCents: 2790 }],
      })
    ).json();
    await admin.patch(`/stores/${store.id}`, { name: store.name, priceTableId: tabela.id });
    await admin.put(`/products/${produto.id}`, {
      ...(produto as object),
      name: 'Arroz Tipo 1 Marca A 5kg',
    });
    await enviar();
    expect(doMercado(marketId, 'products').flatMap((r) => r.items)).toEqual([
      {
        gtin: '7891000315507',
        description: 'Arroz Tipo 1 Marca A 5kg',
        department: 'Mercearia',
        brand: 'Marca A',
        unit: 'UN',
      },
    ]);
    expect(doMercado(marketId, 'prices').flatMap((r) => r.items)).toEqual([
      { gtin: '7891000315507', price: 27.9 },
    ]);
    expect(doMercado(marketId, 'costs').flatMap((r) => r.items)).toEqual([
      expect.objectContaining({ gtin: '7891000315507', unitCost: 21 }),
    ]);
    expect(doMercado(marketId, 'products')[0]!.key).toMatch(/^[0-9a-f]{40}$/);
  });

  it('só manda o que a loja autorizou', async () => {
    const { admin, marketId } = await lojaVinculada(['catalog:write']);
    await admin.post('/products', {
      name: 'Feijão 1kg',
      priceCents: 899,
      costCents: 600,
      barcodes: ['78912342'],
    });
    await enviar();
    expect(doMercado(marketId, 'products')).toHaveLength(1);
    expect(doMercado(marketId, 'prices')).toEqual([]);
    expect(doMercado(marketId, 'costs')).toEqual([]);
  });

  it('carga inicial ao vincular e estoque diário em unidades de venda', async () => {
    const { admin, store, ctx, marketId } = await lojaVinculada([
      'catalog:write',
      'prices:write',
      'stock:write',
    ]);
    const p = (
      await admin.post('/products', {
        name: 'Leite 1L',
        priceCents: 549,
        barcodes: ['7891000100103'],
      })
    ).json();
    await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'count',
      quantityMilli: 12_500,
    });
    await admin.post('/suppliers', { name: 'Distribuidora X', taxId: '11.444.777/0001-61' });
    await enviar();
    recebidos.length = 0;

    const sync = t.app.get(MercadoflowMarketSync);
    await sync.initialLoad(ctx.tenantId, store.id);
    await enviar();
    expect(doMercado(marketId, 'suppliers').flatMap((r) => r.items)).toEqual([
      expect.objectContaining({ cnpj: '11444777000161', legalName: 'Distribuidora X' }),
    ]);
    expect(doMercado(marketId, 'products').flatMap((r) => r.items)).toEqual([
      expect.objectContaining({ gtin: '7891000100103' }),
    ]);
    expect(doMercado(marketId, 'stock').flatMap((r) => r.items)).toEqual([
      expect.objectContaining({ gtin: '7891000100103', units: 12.5 }),
    ]);

    recebidos.length = 0;
    await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: store.id,
      mode: 'adjustment',
      quantityMilli: -2500,
    });
    await sync.dailyStock();
    await enviar();
    expect(doMercado(marketId, 'stock').flatMap((r) => r.items)).toEqual([
      expect.objectContaining({ gtin: '7891000100103', units: 10 }),
    ]);
  });
});
