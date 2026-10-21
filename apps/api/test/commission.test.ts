import { uuidv7, type CommissionReport, type SellerView } from '@bipae/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import {
  cashSessions,
  commissionRates,
  financialEntries,
  saleItems,
  salePayments,
  sales,
} from '../src/db/schema';
import { allocate, rateFor, totalize, type CommissionRate } from '../src/modules/sales/commission';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F8-02: comissão por vendedor, com exceções, crediário e devoluções. */

describe('cálculo da comissão (puro)', () => {
  const ANA = 'ana';
  const rates: CommissionRate[] = [
    { sellerId: ANA, productId: null, category: null, rateBp: 300, startsOn: '2026-01-01' },
    { sellerId: ANA, productId: null, category: null, rateBp: 500, startsOn: '2026-10-10' },
    { sellerId: null, productId: null, category: 'Roupas', rateBp: 800, startsOn: '2026-01-01' },
    { sellerId: null, productId: 'vestido', category: null, rateBp: 1000, startsOn: '2026-01-01' },
    { sellerId: null, productId: 'vestido', category: null, rateBp: null, startsOn: '2026-10-15' },
  ];
  const q = (productId: string, category: string | null, day: string) =>
    rateFor(rates, { sellerId: ANA, productId, category, day });

  it('vale o % do dia da venda: mudar o % não muda o passado', () => {
    expect(q('arroz', null, '2026-10-09')).toBe(300);
    expect(q('arroz', null, '2026-10-10')).toBe(500);
    expect(q('arroz', null, '2025-12-31')).toBe(0);
  });

  it('produto vale antes da categoria, que vale antes do vendedor; exceção encerrada volta', () => {
    expect(q('vestido', 'Roupas', '2026-10-14')).toBe(1000);
    expect(q('vestido', 'Roupas', '2026-10-15')).toBe(800);
    expect(q('camisa', ' roupas ', '2026-10-15')).toBe(800);
    expect(q('camisa', 'Calçados', '2026-10-15')).toBe(500);
  });

  it('arredonda uma vez por vendedor, meio para cima, e devolução desconta', () => {
    const [t] = totalize([
      { sellerId: ANA, kind: 'sale', baseCents: 333, rateBp: 250 },
      { sellerId: ANA, kind: 'sale', baseCents: 333, rateBp: 250 },
      { sellerId: ANA, kind: 'credit', baseCents: 1000, rateBp: 500 },
      { sellerId: ANA, kind: 'return', baseCents: -200, rateBp: 250 },
    ]);
    // 666 × 2,5% = 16,65 · 1000 × 5% = 50 · -200 × 2,5% = -5 → 61,65 → 62
    expect(t).toMatchObject({
      salesCents: 666,
      creditReceivedCents: 1000,
      returnsCents: 200,
      baseCents: 1466,
      commissionCents: 62,
    });
  });

  it('rateia o crediário entre os itens sem perder centavo', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(0, [500, 500])).toEqual([0, 0]);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    const out = allocate(9999, [1234, 5678, 91]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(9999);
  });
});

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('relatório de comissões (F8-02)', () => {
  it('vendas pagas, crediário recebido, devolução, cancelada e exceção por categoria', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const camisa = (
      await admin.post('/products', { name: 'Camisa', priceCents: 10_000, category: 'Roupas' })
    ).json();
    const meia = (await admin.post('/products', { name: 'Meia', priceCents: 2_000 })).json();
    expect(camisa.category).toBe('Roupas');

    const ana = (
      await admin.post('/sellers', { name: 'Ana', code: '1', commissionBp: 300 })
    ).json() as SellerView;
    expect(ana.commissionBp).toBe(300);
    const bia = (await admin.post('/sellers', { name: 'Bia', code: '2' })).json() as SellerView;
    // Roupas pagam 5%, no lugar do % do vendedor.
    expect(
      (await admin.post('/commissions/exceptions', { category: 'Roupas', rateBp: 500 })).statusCode,
    ).toBe(201);
    const exceptions = (await admin.get('/commissions/exceptions')).json();
    expect(exceptions).toMatchObject([{ category: 'Roupas', rateBp: 500 }]);
    // Só uma das duas coisas: produto ou categoria.
    expect((await admin.post('/commissions/exceptions', { rateBp: 100 })).statusCode).toBe(400);

    const companyId = (await admin.get('/companies')).json()[0].id as string;
    const sessionId = uuidv7();
    const at = new Date();
    let seq = 0;
    const ids: Record<string, string> = {};
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: at,
        openingCents: 0,
      });
      const venda = async (
        name: string,
        items: { productId: string; total: number; sellerId: string | null }[],
        payments: { method: string; amount: number }[],
        extra: Partial<typeof sales.$inferInsert> = {},
      ) => {
        const id = uuidv7();
        ids[name] = id;
        const total = items.reduce((s, i) => s + i.total, 0);
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
          occurredAt: at,
          data: {},
          ...extra,
        });
        await tx.insert(saleItems).values(
          items.map((i, n) => ({
            tenantId: ctx.tenantId,
            saleId: id,
            line: n + 1,
            productId: i.productId,
            name: 'x',
            unit: 'UN',
            quantityMilli: 1000,
            unitPriceCents: i.total,
            grossCents: i.total,
            discountCents: 0,
            totalCents: i.total,
            sellerId: i.sellerId,
          })),
        );
        await tx.insert(salePayments).values(
          payments.map((p, idx) => ({
            tenantId: ctx.tenantId,
            saleId: id,
            idx,
            method: p.method,
            amountCents: p.amount,
          })),
        );
      };
      // Ana: camisa (5%) e meia (3%), à vista.
      await venda(
        'avista',
        [
          { productId: camisa.id, total: 10_000, sellerId: ana.id },
          { productId: meia.id, total: 2_000, sellerId: ana.id },
        ],
        [{ method: 'cash', amount: 12_000 }],
      );
      // Ana: meia no crediário, metade paga hoje.
      await venda(
        'crediario',
        [{ productId: meia.id, total: 4_000, sellerId: ana.id }],
        [{ method: 'store_credit', amount: 4_000 }],
      );
      // Cancelada: não conta.
      await venda(
        'cancelada',
        [{ productId: camisa.id, total: 10_000, sellerId: ana.id }],
        [{ method: 'cash', amount: 10_000 }],
        { status: 'cancelled' },
      );
      // Bia sem % definido: entra no relatório com comissão zero.
      await venda(
        'bia',
        [{ productId: meia.id, total: 2_000, sellerId: bia.id }],
        [{ method: 'pix', amount: 2_000 }],
      );
      // Sem vendedor: fica de fora.
      await venda(
        'sem',
        [{ productId: meia.id, total: 2_000, sellerId: null }],
        [{ method: 'cash', amount: 2_000 }],
      );
      // Recebimento de metade do crediário.
      await tx.insert(financialEntries).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId,
        kind: 'receivable',
        status: 'paid',
        description: 'Crediário',
        amountCents: 2_000,
        dueDate: today(),
        paidAt: today(),
        paidCents: 2_000,
        groupId: uuidv7(),
        saleId: ids.crediario!,
      });
      // Devolução da camisa à vista, em dinheiro.
      await tx.insert(sales).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        terminalId,
        storeId: loja.id,
        terminalSeq: ++seq,
        sessionId,
        kind: 'return',
        status: 'completed',
        originalSaleId: ids.avista!,
        subtotalCents: 10_000,
        discountCents: 0,
        totalCents: 10_000,
        operatorId: ctx.userId,
        occurredAt: at,
        data: { refundMethod: 'cash', items: [{ line: 1, refundCents: 10_000 }] },
      });
    });

    const r = (
      await admin.get(`/commissions?from=${today()}&to=${today()}`)
    ).json() as CommissionReport;
    const anaRow = r.rows.find((x) => x.sellerName === 'Ana')!;
    // Vendas pagas: 12.000 (a do crediário não entra na hora). Crediário recebido: 2.000.
    // Devolução: -10.000 da camisa. Comissão: camisa 10.000×5% - 10.000×5% + meia 2.000×3%
    // + crediário 2.000×3% = 120.
    expect(anaRow).toMatchObject({
      salesCents: 12_000,
      creditReceivedCents: 2_000,
      returnsCents: 10_000,
      baseCents: 4_000,
      commissionCents: 120,
    });
    expect(r.rows.find((x) => x.sellerName === 'Bia')).toMatchObject({
      baseCents: 2_000,
      commissionCents: 0,
    });
    expect(r.totalCommissionCents).toBe(120);

    // Mudar o % de hoje em diante grava histórico e aparece no cadastro.
    const editada = (
      await admin.put(`/sellers/${ana.id}`, { name: 'Ana', code: '1', commissionBp: 400 })
    ).json() as SellerView;
    expect(editada.commissionBp).toBe(400);
    const historico = await withTenant(t.database.db, ctx as never, (tx) =>
      tx.select().from(commissionRates).where(eq(commissionRates.sellerId, ana.id)),
    );
    expect(historico.map((h) => h.rateBp).sort()).toEqual([300, 400]);

    const csv = await admin.get(`/commissions/export?from=${today()}&to=${today()}&format=csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Ana');
    expect((await admin.get('/commissions?from=2026-10-10&to=2026-10-01')).statusCode).toBe(422);
  });
});
