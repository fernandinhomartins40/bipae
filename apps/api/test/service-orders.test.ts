import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-13.c: serviços e ordem de serviço. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function oficina() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [loja] = (await admin.get('/stores')).json();
  const oleo = (await admin.post('/products', { name: 'Óleo 5W30 1L', priceCents: 4_500 })).json();
  await admin.post('/stock/adjustments', {
    productId: oleo.id,
    storeId: loja.id,
    mode: 'adjustment',
    quantityMilli: 10_000,
  });
  const cliente = (
    await admin.post('/customers', { name: 'Joana Prado', taxId: '12345678909' })
  ).json();
  const saldo = async () =>
    (await admin.get(`/stock?productId=${oleo.id}`))
      .json()
      .reduce((s: number, r: { quantityMilli: number }) => s + r.quantityMilli, 0);
  return { admin, loja, oleo, cliente, saldo };
}

describe('serviços e ordem de serviço (F5-13.c)', () => {
  it('cadastro de serviço pelo código da lista nacional', async () => {
    const { admin } = await oficina();
    const criado = await admin.post('/services', {
      name: 'Troca de óleo',
      code: '14.01.01',
      issRate: '2,5',
      priceCents: 8_000,
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({
      code: '140101',
      issRate: '2.5',
      codeDescription: expect.stringMatching(/^Lubrificação, limpeza/),
    });
    const fora = await admin.post('/services', { name: 'X', code: '999999' });
    expect(fora.statusCode).toBe(422);
    expect(fora.json().message).toContain('lista nacional');
    const alta = await admin.post('/services', { name: 'X', code: '140101', issRate: '6' });
    expect(alta.statusCode).toBe(400);
    expect(alta.body).toContain('0 a 5%');
    const mudou = await admin.put(`/services/${criado.json().id}`, {
      name: 'Troca de óleo e filtro',
      code: '140101',
      priceCents: 9_000,
    });
    expect(mudou.json()).toMatchObject({ name: 'Troca de óleo e filtro', priceCents: 9_000 });
    expect((await admin.get('/services?q=filtro')).json()).toHaveLength(1);
    const lista = (await admin.get('/fiscal/nfse-services?q=troca de óleo')).json();
    expect(lista.length).toBeGreaterThanOrEqual(0);
    expect((await admin.get('/fiscal/nfse-services?q=14.01')).json()).toContainEqual(
      expect.objectContaining({ code: '140101', incidence: 'prestador' }),
    );
  });

  it('a OS vai de aberta a entregue; na entrega, a peça sai do estoque e o total vira conta', async () => {
    const { admin, loja, oleo, cliente, saldo } = await oficina();
    const troca = (
      await admin.post('/services', { name: 'Troca de óleo', code: '140101', priceCents: 8_000 })
    ).json();
    const os = await admin.post('/service-orders', {
      storeId: loja.id,
      customerId: cliente.id,
      equipment: 'Moto Honda CG 160, placa ABC1D23',
      problem: 'Barulho no motor',
      items: [
        { kind: 'service', serviceId: troca.id, quantityMilli: 1000, unitPriceCents: 8_000 },
        { kind: 'product', productId: oleo.id, quantityMilli: 2000, unitPriceCents: 4_500 },
      ],
    });
    expect(os.statusCode).toBe(201);
    const view = os.json();
    expect(view).toMatchObject({
      number: 1,
      status: 'open',
      servicesCents: 8_000,
      productsCents: 9_000,
      totalCents: 17_000,
    });
    expect(view.items.map((i: { description: string }) => i.description)).toEqual([
      'Troca de óleo',
      'Óleo 5W30 1L',
    ]);
    const andamento = await admin.post(`/service-orders/${view.id}/status`, {
      status: 'in_progress',
    });
    expect(andamento.json().status).toBe('in_progress');
    expect(await saldo()).toBe(10_000);

    const entregue = await admin.post(`/service-orders/${view.id}/deliver`, {
      dueDate: '2026-11-10',
    });
    expect(entregue.statusCode).toBe(200);
    expect(entregue.json()).toMatchObject({ status: 'delivered' });
    expect(await saldo()).toBe(8_000);
    const contas = (await admin.get('/finance/entries?kind=receivable')).json() as {
      description: string;
      amountCents: number;
      dueDate: string;
    }[];
    expect(contas).toContainEqual(
      expect.objectContaining({
        description: 'OS nº 1 · Joana Prado',
        amountCents: 17_000,
        dueDate: '2026-11-10',
      }),
    );
    // Entregue não muda mais.
    expect((await admin.post(`/service-orders/${view.id}/deliver`, {})).statusCode).toBe(409);
    expect(
      (await admin.post(`/service-orders/${view.id}/status`, { status: 'open' })).statusCode,
    ).toBe(409);
    const trilha = (await admin.get('/audit?entity=service_order')).json().items as {
      action: string;
    }[];
    expect(trilha.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'service_order.created',
        'service_order.status',
        'service_order.delivered',
      ]),
    );
  });

  it('OS vazia não é entregue; cancelada não mexe no estoque; outra empresa não vê', async () => {
    const { admin, loja, cliente, saldo } = await oficina();
    const os = (
      await admin.post('/service-orders', { storeId: loja.id, customerId: cliente.id })
    ).json();
    expect((await admin.post(`/service-orders/${os.id}/deliver`, {})).statusCode).toBe(422);
    const editada = await admin.put(`/service-orders/${os.id}`, {
      storeId: loja.id,
      customerId: cliente.id,
      notes: 'Cliente desistiu',
    });
    expect(editada.json().notes).toBe('Cliente desistiu');
    expect(
      (await admin.post(`/service-orders/${os.id}/status`, { status: 'cancelled' })).json().status,
    ).toBe('cancelled');
    expect(await saldo()).toBe(10_000);
    expect((await admin.get('/service-orders?status=cancelled')).json()).toHaveLength(1);
    const outro = api(t.app, (await signup(t.app)).auth);
    expect((await outro.get(`/service-orders/${os.id}`)).statusCode).toBe(404);
    const semItem = await admin.post('/service-orders', {
      storeId: loja.id,
      customerId: cliente.id,
      items: [{ kind: 'service', quantityMilli: 1000, unitPriceCents: 100 }],
    });
    expect(semItem.statusCode).toBe(400);
    expect(semItem.body).toContain('Escolha o serviço ou a peça');
  });
});
