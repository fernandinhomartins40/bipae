import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F1-03.a: a loja e o cliente apontam para uma tabela de preço. */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function shopWithTable() {
  const owner = await signup(t.app);
  const client = api(t.app, owner.auth);
  const product = (await client.post('/products', { name: 'Arroz 5kg', priceCents: 2890 })).json();
  const table = (
    await client.post('/price-tables', {
      name: 'Atacado',
      items: [{ productId: product.id, priceCents: 2590 }],
    })
  ).json();
  const store = (await client.get('/stores')).json()[0];
  return { client, product, table, store };
}

describe('tabela de preço da loja e do cliente', () => {
  it('a loja usa uma tabela padrão, e trocar fica na auditoria', async () => {
    const { client, table, store } = await shopWithTable();
    const res = await client.patch(`/stores/${store.id}`, { priceTableId: table.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().priceTableId).toBe(table.id);
    expect((await client.get('/stores')).json()[0].priceTableId).toBe(table.id);

    const back = await client.patch(`/stores/${store.id}`, { priceTableId: null });
    expect(back.json().priceTableId).toBeNull();

    const audit = (await client.get('/audit')).json() as { items: { action: string }[] };
    expect(audit.items.filter((i) => i.action === 'store.updated')).toHaveLength(2);
  });

  it('o cliente pode ter uma tabela própria', async () => {
    const { client, table } = await shopWithTable();
    const created = await client.post('/customers', {
      name: 'Mercearia do Zé',
      priceTableId: table.id,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().priceTableId).toBe(table.id);
    const listed = (await client.get('/customers')).json().items[0];
    expect(listed.priceTableId).toBe(table.id);
  });

  it('não aceita a tabela de outro cliente do Bipaê', async () => {
    const mine = await shopWithTable();
    const other = await shopWithTable();
    const store = await mine.client.patch(`/stores/${mine.store.id}`, {
      priceTableId: other.table.id,
    });
    expect(store.statusCode).toBe(422);
    expect(store.json().message).toBe('Tabela de preço não encontrada.');
    const customer = await mine.client.post('/customers', {
      name: 'Ana',
      priceTableId: other.table.id,
    });
    expect(customer.statusCode).toBe(422);
  });

  it('só quem gerencia lojas troca a tabela da loja', async () => {
    const { client, table, store } = await shopWithTable();
    const roles = (await client.get('/roles')).json() as { id: string; systemKey: string }[];
    const cashier = roles.find((r) => r.systemKey === 'cashier')!;
    const email = `caio-${Date.now()}@exemplo.com.br`;
    await client.post('/members', {
      name: 'Caio Caixa',
      email,
      password: 'senha-forte-123',
      roleId: cashier.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const caio = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await caio.patch(`/stores/${store.id}`, { priceTableId: table.id })).statusCode).toBe(
      403,
    );
  });
});
