import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-01: pedidos de compra. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function cenario() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [loja] = (await admin.get('/stores')).json();
  const fornecedor = (
    await admin.post('/suppliers', { name: 'Distribuidora Boa', taxId: '11.444.777/0001-61' })
  ).json();
  const arroz = (
    await admin.post('/products', { name: 'Arroz 5kg', priceCents: 2890, costCents: 2100 })
  ).json();
  const banana = (
    await admin.post('/products', {
      name: 'Banana',
      priceCents: 699,
      unit: 'KG',
      isWeighable: true,
    })
  ).json();
  return { admin, loja, fornecedor, arroz, banana };
}

describe('pedidos de compra (F4-01)', () => {
  it('cria em rascunho com número em sequência e total pela regra de arredondamento', async () => {
    const { admin, loja, fornecedor, arroz, banana } = await cenario();
    const r = await admin.post('/purchase-orders', {
      storeId: loja.id,
      supplierId: fornecedor.id,
      expectedAt: '2026-10-20',
      notes: 'Entregar pela manhã',
      items: [
        { productId: arroz.id, quantityMilli: 10_000, unitCostCents: 2100 },
        { productId: banana.id, quantityMilli: 12_345, unitCostCents: 333 },
      ],
    });
    expect(r.statusCode).toBe(201);
    const pedido = r.json();
    // 10 × 21,00 = 210,00; 12,345 kg × 3,33 = 41,10885 → 41,11
    expect(pedido).toMatchObject({
      number: 1,
      status: 'draft',
      supplierName: 'Distribuidora Boa',
      totalCents: 21_000 + 4111,
      items: [
        expect.objectContaining({ line: 1, productName: 'Arroz 5kg', totalCents: 21_000 }),
        expect.objectContaining({ line: 2, totalCents: 4111 }),
      ],
    });
    const segundo = (
      await admin.post('/purchase-orders', {
        storeId: loja.id,
        supplierId: fornecedor.id,
        items: [{ productId: arroz.id, quantityMilli: 1000, unitCostCents: 2100 }],
      })
    ).json();
    expect(segundo.number).toBe(2);
    expect((await admin.get('/purchase-orders?status=draft')).json()).toHaveLength(2);
  });

  it('edita só o rascunho; enviado não muda; cancelar pede motivo e fica na auditoria', async () => {
    const { admin, loja, fornecedor, arroz } = await cenario();
    const body = {
      storeId: loja.id,
      supplierId: fornecedor.id,
      items: [{ productId: arroz.id, quantityMilli: 5000, unitCostCents: 2000 }],
    };
    const pedido = (await admin.post('/purchase-orders', body)).json();
    const editado = await admin.put(`/purchase-orders/${pedido.id}`, {
      ...body,
      items: [{ productId: arroz.id, quantityMilli: 6000, unitCostCents: 2000 }],
    });
    expect(editado.json().totalCents).toBe(12_000);

    const enviado = await admin.post(`/purchase-orders/${pedido.id}/send`);
    expect(enviado.json()).toMatchObject({ status: 'sent' });
    expect(enviado.json().sentAt).not.toBeNull();
    const naoEdita = await admin.put(`/purchase-orders/${pedido.id}`, body);
    expect(naoEdita.statusCode).toBe(409);
    expect(naoEdita.json().message).toContain('está enviado');

    expect(
      (await admin.post(`/purchase-orders/${pedido.id}/cancel`, { reason: '' })).statusCode,
    ).toBe(400);
    const cancelado = await admin.post(`/purchase-orders/${pedido.id}/cancel`, {
      reason: 'Fornecedor sem estoque',
    });
    expect(cancelado.json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Fornecedor sem estoque',
    });
    const trilha = JSON.stringify(
      (await admin.get('/audit?action=purchase_order.cancelled')).json(),
    );
    expect(trilha).toContain('Fornecedor sem estoque');
  });

  it('recusa quantidade quebrada de produto por unidade e dados de outro cliente', async () => {
    const { admin, loja, fornecedor, arroz } = await cenario();
    const quebrado = await admin.post('/purchase-orders', {
      storeId: loja.id,
      supplierId: fornecedor.id,
      items: [{ productId: arroz.id, quantityMilli: 1500, unitCostCents: 2000 }],
    });
    expect(quebrado.statusCode).toBe(422);
    expect(quebrado.json().message).toBe('Arroz 5kg é comprado por unidade inteira.');

    const outro = await cenario();
    const alheio = await admin.post('/purchase-orders', {
      storeId: loja.id,
      supplierId: outro.fornecedor.id,
      items: [{ productId: arroz.id, quantityMilli: 1000, unitCostCents: 2000 }],
    });
    expect(alheio.statusCode).toBe(422);
    expect(alheio.json().message).toBe('Fornecedor não encontrado.');
    expect((await outro.admin.get('/purchase-orders')).json()).toEqual([]);
  });
});
