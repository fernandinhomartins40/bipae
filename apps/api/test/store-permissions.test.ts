import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F1-05: permissões por loja — quem é de uma loja não vê nem vende nas outras. */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const SENHA = 'senha-forte-123';

async function rede() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const empresa = (await admin.get('/companies')).json()[0];
  const lojaA = (await admin.get('/stores')).json()[0];
  const lojaB = (
    await admin.post('/stores', { companyId: empresa.id, name: 'Loja Bairro' })
  ).json();
  const caixaA = (
    await admin.post('/terminals', { storeId: lojaA.id, name: 'Caixa A', platform: 'web' })
  ).json();
  const caixaB = (
    await admin.post('/terminals', { storeId: lojaB.id, name: 'Caixa B', platform: 'web' })
  ).json();
  const papeis = (await admin.get('/roles')).json() as { id: string; systemKey: string }[];

  /** Pessoa da equipe com um papel, restrita às lojas indicadas. */
  async function pessoa(papel: 'cashier' | 'manager', lojas: string[] | null) {
    const email = `${papel}-${Date.now()}-${Math.random().toString(36).slice(2)}@exemplo.com.br`;
    const membro = await admin.post('/members', {
      name: papel === 'cashier' ? 'Bia Caixa' : 'Gil Gerente',
      email,
      password: SENHA,
      roleId: papeis.find((p) => p.systemKey === papel)!.id,
    });
    const userId = membro.json().userId as string;
    const res = await admin.patch(`/members/${userId}`, { storeIds: lojas });
    expect(res.statusCode).toBe(200);
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: SENHA },
    });
    const token = login.json().accessToken as string;
    return {
      userId,
      cliente: api(t.app, { authorization: `Bearer ${token}` }),
      noCaixa: (terminalId: string) =>
        api(t.app, { authorization: `Bearer ${token}`, 'x-bipae-terminal': terminalId }),
    };
  }
  return { admin, lojaA, lojaB, caixaA, caixaB, pessoa };
}

describe('permissões por loja (F1-05)', () => {
  it('a operadora da Loja Bairro só vê a sua loja e os seus caixas', async () => {
    const r = await rede();
    const bia = await r.pessoa('cashier', [r.lojaB.id]);

    expect((await bia.cliente.get('/stores')).json().map((s: { id: string }) => s.id)).toEqual([
      r.lojaB.id,
    ]);
    expect(
      (await bia.cliente.get('/pos/terminals')).json().map((x: { id: string }) => x.id),
    ).toEqual([r.caixaB.id]);

    expect((await bia.cliente.get(`/pos/terminals/${r.caixaB.id}/context`)).statusCode).toBe(200);
    const outra = await bia.cliente.get(`/pos/terminals/${r.caixaA.id}/context`);
    expect(outra.statusCode).toBe(403);
    expect(outra.json().message).toBe('Você não tem acesso a esta loja.');
  });

  it('não sincroniza nem envia vendas por um caixa de outra loja', async () => {
    const r = await rede();
    const bia = await r.pessoa('cashier', [r.lojaB.id]);

    expect((await bia.noCaixa(r.caixaB.id).get('/sync/pull?limit=10')).statusCode).toBe(200);
    const pull = await bia.noCaixa(r.caixaA.id).get('/sync/pull?limit=10');
    expect(pull.statusCode).toBe(403);
    expect(pull.json().message).toBe('Este caixa é de uma loja que você não tem acesso.');

    // Sem o cabeçalho do caixa, a checagem acontece no envio dos eventos.
    const push = await bia.cliente.post('/sync/events', { terminalId: r.caixaA.id, events: [{ type: 'qualquer' }] });
    expect(push.statusCode).toBe(403);
  });

  it('o gerente da Loja Bairro não mexe em estoque nem cria caixa na outra loja', async () => {
    const r = await rede();
    const gil = await r.pessoa('manager', [r.lojaB.id]);
    const produto = (await r.admin.post('/products', { name: 'Arroz', priceCents: 2890 })).json();
    for (const loja of [r.lojaA, r.lojaB]) {
      await r.admin.post('/stock/adjustments', {
        productId: produto.id,
        storeId: loja.id,
        mode: 'count',
        quantityMilli: 5000,
      });
    }

    const estoque = (await gil.cliente.get(`/stock?productId=${produto.id}`)).json() as {
      storeId: string;
    }[];
    expect(estoque.map((e) => e.storeId)).toEqual([r.lojaB.id]);

    const ajuste = await gil.cliente.post('/stock/adjustments', {
      productId: produto.id,
      storeId: r.lojaA.id,
      mode: 'count',
      quantityMilli: 1000,
    });
    expect(ajuste.statusCode).toBe(403);
    const caixa = await gil.cliente.post('/terminals', {
      storeId: r.lojaA.id,
      name: 'Caixa intruso',
      platform: 'web',
    });
    expect(caixa.statusCode).toBe(403);
    expect(
      (
        await gil.cliente.post('/terminals', {
          storeId: r.lojaB.id,
          name: 'Caixa 2',
          platform: 'web',
        })
      ).statusCode,
    ).toBe(201);
  });

  it('sem restrição vê tudo; a restrição só aceita lojas desta empresa', async () => {
    const r = await rede();
    const livre = await r.pessoa('cashier', null);
    expect((await livre.cliente.get('/stores')).json()).toHaveLength(2);

    const outra = await rede();
    const bia = await r.pessoa('cashier', [r.lojaB.id]);
    const invalida = await r.admin.patch(`/members/${bia.userId}`, { storeIds: [outra.lojaA.id] });
    expect(invalida.statusCode).toBe(422);
    expect(invalida.json().message).toBe('Uma das lojas escolhidas não existe.');

    const membros = (await r.admin.get('/members')).json() as {
      userId: string;
      storeIds: string[] | null;
    }[];
    expect(membros.find((m) => m.userId === bia.userId)!.storeIds).toEqual([r.lojaB.id]);
  });
});
