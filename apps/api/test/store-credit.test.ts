import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F2-02: crediário com limite por cliente, do cadastro ao caixa sem internet e de volta. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function transport(auth: Record<string, string>, terminalId: string) {
  const state = { online: true };
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  const impl: SyncTransport = {
    async push(id, events: TerminalEvent[]) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      if (!state.online) throw new Error('Sem conexão');
      const res = await client.get(
        `/sync/pull?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      return res.json() as SyncPullResult;
    },
  };
  return { impl, state };
}

const CPF = '52998224725';

describe('crediário (F2-02)', () => {
  it('limite no cadastro, venda no caixa sem internet, extrato, cancelamento e recebimento', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (
      await admin.post('/products', { name: 'Arroz 5kg', priceCents: 3000, barcodes: ['78912342'] })
    ).json();

    // Limite exige CPF/CNPJ.
    const semCpf = await admin.post('/customers', { name: 'Sem CPF', creditLimitCents: 10_000 });
    expect(semCpf.statusCode).toBe(422);
    expect(semCpf.json().message).toContain('CPF ou CNPJ');
    const maria = (
      await admin.post('/customers', { name: 'Maria', taxId: CPF, creditLimitCents: 10_000 })
    ).json();
    expect(maria.creditLimitCents).toBe(10_000);
    const audit = JSON.stringify(
      (await admin.get('/audit?action=customer.credit_limit_changed')).json(),
    );
    expect(audit).toContain('customer.credit_limit_changed');

    // Caixa: baixa o retrato com o limite e vende sem internet.
    const store = (await admin.get('/stores')).json()[0];
    const terminal = (
      await admin.post('/terminals', { storeId: store.id, name: 'Caixa', platform: 'web' })
    ).json();
    const storage = createStorage(nodeSqliteDriver());
    await migrateLocal(storage);
    const pdv = new PdvService(storage, { terminalId: terminal.id, operatorId: owner.me.user.id });
    const net = transport(owner.auth, terminal.id);
    const sync = new SyncClient(storage, pdv, net.impl, terminal.id);
    expect((await sync.sync()).lastError).toBeNull();
    expect(await pdv.creditAvailable(CPF)).toEqual({ limitCents: 10_000, availableCents: 10_000 });
    expect(await pdv.creditAvailable('11144477735')).toBeNull();

    net.state.online = false;
    await pdv.openSession(0);
    const item = (await pdv.findByCode('78912342'))!;
    const cart = { ...addItem(EMPTY_CART, item, 2000), customerTaxId: CPF };
    const options = { discountLimitPercent: 10 };
    // Sem CPF na venda, o crediário é recusado.
    await expect(
      pdv.completeSale(
        addItem(EMPTY_CART, item, 1000),
        [{ method: 'store_credit', receivedCents: 3000 }],
        options,
      ),
    ).rejects.toThrow('informe o CPF ou CNPJ');
    const venda = await pdv.completeSale(
      cart,
      [{ method: 'store_credit', receivedCents: 6000 }],
      options,
    );
    // A venda que ainda não subiu já conta no disponível.
    expect((await pdv.creditAvailable(CPF))!.availableCents).toBe(4000);
    await expect(
      pdv.completeSale(cart, [{ method: 'store_credit', receivedCents: 6000 }], options),
    ).rejects.toThrow('R$ 40,00 disponíveis');

    // Volta a internet: o extrato do cliente tem a compra.
    net.state.online = true;
    expect((await sync.sync()).lastError).toBeNull();
    let credit = (await admin.get(`/customers/${maria.id}/credit`)).json();
    expect(credit).toMatchObject({ limitCents: 10_000, balanceCents: 6000, availableCents: 4000 });
    expect(credit.entries[0]).toMatchObject({ kind: 'sale', amountCents: 6000, saleId: venda.id });
    // O retrato novo traz o saldo do servidor (e a venda já não está pendente).
    expect((await pdv.creditAvailable(CPF))!.availableCents).toBe(4000);

    // Cancelar a venda estorna o crediário.
    await pdv.cancelSale(venda.id, 'Cliente desistiu', owner.me.user.id);
    await sync.sync();
    credit = (await admin.get(`/customers/${maria.id}/credit`)).json();
    expect(credit.balanceCents).toBe(0);
    expect(credit.entries[0]).toMatchObject({ kind: 'cancel', amountCents: -6000 });

    // Nova compra e recebimento na retaguarda; pagar mais que o saldo é recusado.
    await pdv.completeSale(cart, [{ method: 'store_credit', receivedCents: 6000 }], options);
    await sync.sync();
    const demais = await admin.post(`/customers/${maria.id}/credit/payments`, {
      amountCents: 7000,
    });
    expect(demais.statusCode).toBe(422);
    const pago = await admin.post(`/customers/${maria.id}/credit/payments`, {
      amountCents: 2500,
      note: 'Parcela 1',
    });
    expect(pago.json()).toMatchObject({ balanceCents: 3500, availableCents: 6500 });
    await sync.sync();
    expect((await pdv.creditAvailable(CPF))!.availableCents).toBe(6500);
    expect(product.id).toBeDefined();
  });

  it('operador de caixa não muda o limite nem recebe no crediário', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const cashierRole = roles.find((r) => r.systemKey === 'cashier')!;
    const email = `caixa-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Ju',
      email,
      password: 'senha-forte-123',
      roleId: cashierRole.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const cashier = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    const cliente = (await admin.post('/customers', { name: 'João', taxId: CPF })).json();
    const r = await cashier.put(`/customers/${cliente.id}`, {
      name: 'João',
      taxId: CPF,
      creditLimitCents: 50_000,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toContain('limite do crediário');
    // Editar outros dados, sem mandar o limite, continua permitido.
    expect(
      (await cashier.put(`/customers/${cliente.id}`, { name: 'João Silva', taxId: CPF }))
        .statusCode,
    ).toBe(200);
    expect(
      (await cashier.post(`/customers/${cliente.id}/credit/payments`, { amountCents: 100 }))
        .statusCode,
    ).toBe(403);
  });
});
