import { parseScan } from '@bipae/pdv-core/pure';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LabelsService } from '../src/modules/catalog/labels.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-01: etiquetas de gôndola e de balança. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('etiquetas (F5-01)', () => {
  it('gôndola com o preço da tabela da loja e balança com o código que o caixa lê', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = {
      tenantId: dono.me.tenant.id as string,
      userId: dono.me.user.id as string,
      permissions: dono.me.permissions,
      storeIds: null,
    };
    const [loja] = (await admin.get('/stores')).json();
    const arroz = (
      await admin.post('/products', {
        name: 'Arroz 5kg',
        priceCents: 2890,
        barcodes: ['7891000315507'],
      })
    ).json();
    const queijo = (
      await admin.post('/products', {
        name: 'Queijo minas frescal',
        priceCents: 4990,
        unit: 'KG',
        isWeighable: true,
        sku: '42',
      })
    ).json();
    const semCodigo = (
      await admin.post('/products', {
        name: 'Pão',
        priceCents: 1500,
        unit: 'KG',
        isWeighable: true,
      })
    ).json();
    const tabela = (
      await admin.post('/price-tables', {
        name: 'Loja Centro',
        items: [{ productId: arroz.id, priceCents: 2790 }],
      })
    ).json();
    await admin.patch(`/stores/${loja.id}`, { priceTableId: tabela.id });

    const service = t.app.get(LabelsService);
    const gondola = await service.build(ctx as never, {
      kind: 'shelf',
      storeId: loja.id,
      items: [{ productId: arroz.id, copies: 2 }],
    });
    expect(gondola).toHaveLength(2);
    expect(gondola[0]).toMatchObject({ name: 'Arroz 5kg', code: '7891000315507' });
    expect(gondola[0]!.price).toMatch(/27,90/);

    const balanca = await service.build(ctx as never, {
      kind: 'scale',
      items: [{ productId: queijo.id, copies: 1, grams: 1250 }],
    });
    // 1,25 kg × R$ 49,90 = R$ 62,375 → R$ 62,38.
    expect(balanca[0]!.price).toMatch(/62,38/);
    expect(parseScan(balanca[0]!.code!)).toEqual({
      kind: 'scale-label',
      plu: '42',
      totalCents: 6238,
    });

    const pdf = await admin.post('/labels', {
      kind: 'shelf',
      items: [{ productId: arroz.id, copies: 30 }],
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    expect(
      (
        await admin.post('/labels', {
          kind: 'scale',
          items: [{ productId: arroz.id, grams: 500 }],
        })
      ).json().message,
    ).toBe('Arroz 5kg não é vendido por peso: use a etiqueta de gôndola.');
    expect(
      (
        await admin.post('/labels', {
          kind: 'scale',
          items: [{ productId: semCodigo.id, grams: 500 }],
        })
      ).json().message,
    ).toBe('Pão precisa de um código interno (só números) para ir na etiqueta da balança.');
    expect(
      (await admin.post('/labels', { kind: 'scale', items: [{ productId: queijo.id }] }))
        .statusCode,
    ).toBe(400);
  });
});
