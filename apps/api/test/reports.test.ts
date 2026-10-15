import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, saleItems, salePayments, sales } from '../src/db/schema';
import { abcClass } from '../src/modules/reports/reports.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-10: relatórios de vendas exportáveis. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('relatórios de vendas (F4-10)', () => {
  it('curva ABC', () => {
    expect(abcClass(0)).toBe('A');
    expect(abcClass(7999)).toBe('A');
    expect(abcClass(8000)).toBe('B');
    expect(abcClass(9499)).toBe('B');
    expect(abcClass(9500)).toBe('C');
  });

  it('por produto (ABC, margem), por forma de pagamento e exportação em CSV, XLSX e PDF', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const cafe = (
      await admin.post('/products', { name: 'Café', priceCents: 2000, costCents: 1200 })
    ).json();
    const pao = (
      await admin.post('/products', { name: 'Pão', priceCents: 100, costCents: 40 })
    ).json();
    const sessionId = uuidv7();
    const quando = new Date(Date.UTC(2026, 9, 5, 15));
    let seq = 0;
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: quando,
        openingCents: 0,
      });
      const venda = async (items: [string, number, number][], method: string) => {
        const id = uuidv7();
        const total = items.reduce((s, [, , c]) => s + c, 0);
        await tx.insert(sales).values({
          id,
          tenantId: ctx.tenantId,
          terminalId,
          storeId: loja.id,
          terminalSeq: ++seq,
          sessionId,
          kind: 'sale',
          status: 'completed',
          subtotalCents: total,
          discountCents: 0,
          totalCents: total,
          operatorId: ctx.userId,
          occurredAt: quando,
          data: {},
        });
        await tx.insert(saleItems).values(
          items.map(([productId, milli, cents], i) => ({
            tenantId: ctx.tenantId,
            saleId: id,
            line: i + 1,
            productId,
            name: 'x',
            unit: 'UN',
            quantityMilli: milli,
            unitPriceCents: cents,
            grossCents: cents,
            discountCents: 0,
            totalCents: cents,
          })),
        );
        await tx.insert(salePayments).values({
          tenantId: ctx.tenantId,
          saleId: id,
          idx: 0,
          method,
          amountCents: total,
          changeCents: 0,
        });
      };
      await venda([[cafe.id, 9000, 18_000]], 'pix');
      await venda(
        [
          [cafe.id, 1000, 2000],
          [pao.id, 10_000, 1000],
        ],
        'cash',
      );
    });

    const base = '/reports/sales?from=2026-10-01&to=2026-10-31';
    const porProduto = (await admin.get(`${base}&group=product`)).json();
    expect(porProduto).toMatchObject({
      salesCount: 2,
      revenueCents: 21_000,
      avgTicketCents: 10_500,
    });
    expect(porProduto.rows).toEqual([
      expect.objectContaining({
        label: 'Café',
        quantityMilli: 10_000,
        salesCount: 2,
        revenueCents: 20_000,
        costCents: 12_000,
        marginCents: 8000,
        marginBp: 4000,
        abc: 'A',
      }),
      expect.objectContaining({
        label: 'Pão',
        revenueCents: 1000,
        costCents: 400,
        marginBp: 6000,
        abc: 'C',
      }),
    ]);
    // O maior produto é sempre A; o Pão vem depois de 95,2% acumulados: C.

    const porForma = (await admin.get(`${base}&group=payment`)).json();
    expect(porForma.rows).toEqual([
      expect.objectContaining({ label: 'Pix', revenueCents: 18_000, salesCount: 1 }),
      expect.objectContaining({ label: 'Dinheiro', revenueCents: 3000, salesCount: 1 }),
    ]);

    const csv = await admin.get(
      `/reports/sales/export?from=2026-10-01&to=2026-10-31&group=product&format=csv`,
    );
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.body).toContain('Produto;Qtd.;ABC;Vendas;Receita');
    expect(csv.body).toContain('Café;10;A;2;R$ 200,00');
    const xlsx = await admin.get(
      `/reports/sales/export?from=2026-10-01&to=2026-10-31&group=day&format=xlsx`,
    );
    expect(xlsx.headers['content-disposition']).toContain('.xlsx');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const pdf = await admin.get(
      `/reports/sales/export?from=2026-10-01&to=2026-10-31&group=operator&format=pdf`,
    );
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await admin.get(`/reports/sales/export?from=2026-10-01&to=2026-10-31&format=doc`))
        .statusCode,
    ).toBe(422);
  });
});
