import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPENAPI } from '../src/modules/public-api/openapi';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-01.b: o contrato OpenAPI e as rotas públicas de leitura (ADR-0016). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

type Schema = Record<string, unknown>;

/** Validador mínimo de JSON Schema (o que o contrato usa): $ref, type, required, anyOf, enum. */
function check(value: unknown, schema: Schema, path = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').pop()!;
    return check(value, (OPENAPI.components.schemas as Record<string, Schema>)[name]!, path);
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = (schema.anyOf as Schema[]).some((s) => check(value, s, path).length === 0);
    return ok ? [] : [`${path}: não bate com nenhuma opção`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${path}: ${String(value)} fora da lista`];
  }
  switch (schema.type) {
    case 'null':
      return value === null ? [] : [`${path}: esperado nulo`];
    case 'string':
      return typeof value === 'string' ? [] : [`${path}: esperado texto`];
    case 'integer':
      return Number.isInteger(value) ? [] : [`${path}: esperado inteiro`];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path}: esperado sim/não`];
    case 'array':
      if (!Array.isArray(value)) return [`${path}: esperado lista`];
      return value.flatMap((v, i) => check(v, schema.items as Schema, `${path}[${i}]`));
    case 'object': {
      if (!value || typeof value !== 'object') return [`${path}: esperado objeto`];
      const obj = value as Record<string, unknown>;
      const errors = ((schema.required as string[]) ?? [])
        .filter((k) => !(k in obj))
        .map((k) => `${path}.${k}: faltando`);
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const [k, s] of Object.entries(props)) {
        if (k in obj) errors.push(...check(obj[k], s, `${path}.${k}`));
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          if (!(k in props)) {
            errors.push(...check(v, schema.additionalProperties as Schema, `${path}.${k}`));
          }
        }
      }
      return errors;
    }
    default:
      return [];
  }
}

function transport(auth: Record<string, string>, terminalId: string): SyncTransport {
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  return {
    async push(id, events: TerminalEvent[]) {
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      const res = await client.get(
        `/sync/pull?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      return res.json() as SyncPullResult;
    },
  };
}

describe('API pública: contrato e leitura (F6-01.b)', () => {
  it('o contrato é aberto, e cada rota dele responde com a chave no formato prometido', async () => {
    const aberto = await t.app.inject({ method: 'GET', url: '/v1/public/openapi.json' });
    expect(aberto.statusCode).toBe(200);
    expect(aberto.json()).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'API pública do Bipaê' },
    });

    // Dados: loja, produto com código de barras e estoque, cliente e uma venda do caixa.
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [loja] = (await admin.get('/stores')).json();
    const produto = (
      await admin.post('/products', {
        name: 'Café Torrado 500 g',
        priceCents: 1890,
        barcodes: ['7891000100103'],
        ncm: '09012100',
      })
    ).json();
    await admin.post('/stock/adjustments', {
      productId: produto.id,
      storeId: loja.id,
      mode: 'adjustment',
      quantityMilli: 10_000,
    });
    await admin.post('/customers', { name: 'Ana Lima', taxId: '12345678909' });
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
    const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
    await sync.sync();
    await pdv.openSession(0);
    const cafe = (await pdv.findByCode('7891000100103'))!;
    await pdv.completeSale(
      addItem(EMPTY_CART, cafe, 2000),
      [{ method: 'pix', receivedCents: 3780 }],
      {
        discountLimitPercent: 10,
      },
    );
    expect((await sync.sync()).lastError).toBeNull();

    const chave = (
      await admin.post('/api-keys', { name: 'Tudo', scopes: ['catalog.read', 'parties.read'] })
    ).json().key as string;
    const parceiro = api(t.app, { authorization: `Bearer ${chave}` });

    for (const [path, ops] of Object.entries(OPENAPI.paths)) {
      const res = await parceiro.get(path);
      expect(res.statusCode, path).toBe(200);
      const schema = (
        ops.get.responses['200'] as { content: { 'application/json': { schema: Schema } } }
      ).content['application/json'].schema;
      expect(check(res.json(), schema), path).toEqual([]);
    }

    // O conteúdo, além do formato.
    const produtos = (await parceiro.get('/public/products')).json();
    expect(produtos.items).toEqual([
      expect.objectContaining({
        name: 'Café Torrado 500 g',
        priceCents: 1890,
        barcodes: ['7891000100103'],
      }),
    ]);
    expect(produtos.nextCursor).toBeNull();
    const estoque = (await parceiro.get(`/public/stock?productId=${produto.id}`)).json();
    expect(estoque.items).toEqual([
      { productId: produto.id, storeId: loja.id, quantityMilli: 8000 },
    ]);
    const vendas = (await parceiro.get('/public/sales')).json();
    expect(vendas.items).toEqual([
      expect.objectContaining({
        totalCents: 3780,
        items: [expect.objectContaining({ quantityMilli: 2000, totalCents: 3780 })],
        payments: [expect.objectContaining({ method: 'pix', amountCents: 3780 })],
      }),
    ]);
    expect(
      (await parceiro.get('/public/sales?from=2000-01-01T00:00:00Z&to=2000-01-02T00:00:00Z')).json()
        .items,
    ).toEqual([]);
    expect((await parceiro.get('/public/customers')).json().items).toEqual([
      expect.objectContaining({ name: 'Ana Lima', taxId: '12345678909', marketingConsent: false }),
    ]);

    // Paginação por cursor.
    await admin.post('/products', { name: 'Açúcar 1 kg', priceCents: 549 });
    const primeira = (await parceiro.get('/public/products?limit=1')).json();
    expect(primeira.items).toHaveLength(1);
    const segunda = (
      await parceiro.get(`/public/products?limit=1&cursor=${primeira.nextCursor}`)
    ).json();
    expect(segunda.items[0].name).toBe('Açúcar 1 kg');
    const futuro = (
      await parceiro.get(
        `/public/products?updatedSince=${encodeURIComponent('2999-01-01T00:00:00Z')}`,
      )
    ).json();
    expect(futuro.items).toEqual([]);
    expect((await parceiro.get('/public/products?cursor=nao-e-id')).statusCode).toBe(400);

    // Escopo: chave só de catálogo não lê clientes.
    const soCatalogo = (
      await admin.post('/api-keys', { name: 'Loja', scopes: ['catalog.read'] })
    ).json().key as string;
    expect(
      (await api(t.app, { authorization: `Bearer ${soCatalogo}` }).get('/public/customers'))
        .statusCode,
    ).toBe(403);

    // Outra empresa não enxerga nada desta.
    const outra = await signup(t.app);
    const chaveOutra = (
      await api(t.app, outra.auth).post('/api-keys', {
        name: 'Outra loja',
        scopes: ['catalog.read'],
      })
    ).json().key as string;
    const deFora = api(t.app, { authorization: `Bearer ${chaveOutra}` });
    expect((await deFora.get('/public/products')).json().items).toEqual([]);
    expect((await deFora.get('/public/sales')).json().items).toEqual([]);
  });
});
