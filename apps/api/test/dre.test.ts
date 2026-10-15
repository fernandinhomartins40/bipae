import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, saleItems, sales } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-06: DRE gerencial. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('DRE gerencial (F4-06)', () => {
  it('receita, devoluções, impostos, CMV, despesas por categoria e resultado', async () => {
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
    const pao = (await admin.post('/products', { name: 'Pão', priceCents: 100 })).json();
    const sessionId = uuidv7();
    const quando = new Date(Date.UTC(2026, 3, 15, 15)); // abril de 2026
    let seq = 0;
    const base = {
      tenantId: ctx.tenantId,
      terminalId,
      storeId: loja.id,
      sessionId,
      operatorId: ctx.userId,
      occurredAt: quando,
      discountCents: 0,
    };
    const vendaId = uuidv7();
    const devolucaoId = uuidv7();
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: quando,
        openingCents: 0,
      });
      await tx.insert(sales).values({
        ...base,
        id: vendaId,
        terminalSeq: ++seq,
        kind: 'sale',
        status: 'completed',
        subtotalCents: 10_100,
        totalCents: 10_100,
        data: {},
      });
      const item = (
        line: number,
        productId: string,
        milli: number,
        total: number,
        taxes: object,
      ) => ({
        tenantId: ctx.tenantId,
        saleId: vendaId,
        line,
        productId,
        name: 'x',
        unit: 'UN',
        quantityMilli: milli,
        unitPriceCents: total,
        grossCents: total,
        discountCents: 0,
        totalCents: total,
        taxes,
      });
      await tx
        .insert(saleItems)
        .values([
          item(1, cafe.id, 5000, 10_000, {
            icmsCents: 1800,
            pisCents: 65,
            cofinsCents: 300,
            cbsCents: 90,
          }),
          item(2, pao.id, 1000, 100, { icmsCents: 0 }),
        ]);
      await tx.insert(sales).values({
        ...base,
        id: devolucaoId,
        terminalSeq: ++seq,
        kind: 'return',
        status: 'completed',
        originalSaleId: vendaId,
        subtotalCents: 2000,
        totalCents: 2000,
        data: { items: [{ productId: cafe.id, quantityMilli: 1000 }], refundMethod: 'cash' },
      });
    });
    for (const [description, category, amountCents] of [
      ['Aluguel', 'Aluguel', 1500],
      ['Energia', 'Energia', 500],
      ['Compra', 'Mercadoria', 9000],
    ] as const) {
      await admin.post('/finance/entries', {
        kind: 'payable',
        description,
        category,
        amountCents,
        dueDate: '2026-04-10',
      });
    }

    const r = await admin.get('/finance/entries/dre?from=2026-04&to=2026-04');
    expect(r.statusCode).toBe(200);
    const [abril] = r.json().months;
    expect(abril).toMatchObject({
      month: '2026-04',
      grossRevenueCents: 10_100,
      returnsCents: 2000,
      // CBS de 2026 é teste: fora.
      taxesCents: 2165,
      netRevenueCents: 10_100 - 2000 - 2165,
      // 5 × 12,00 − 1 devolvido × 12,00 (o pão não tem custo)
      cogsCents: 4800,
      expensesCents: 2000,
      expenses: [
        { category: 'Aluguel', cents: 1500 },
        { category: 'Energia', cents: 500 },
      ],
    });
    expect(abril.resultCents).toBe(10_100 - 2000 - 2165 - 4800 - 2000);
    expect(r.json().notes.join(' ')).toContain('1 item(ns) vendido(s) sem custo');
    expect((await admin.get('/finance/entries/dre?from=2026-4&to=2026-04')).statusCode).toBe(422);
  });
});
