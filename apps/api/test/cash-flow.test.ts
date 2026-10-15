import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, salePayments, sales } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-05: fluxo de caixa realizado e previsto. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('fluxo de caixa (F4-05)', () => {
  it('vendas sem crediário, devoluções, contas pagas e recebidas e o previsto', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const sessionId = uuidv7();
    // 10/03/2026 às 12h no horário de Brasília (15h UTC).
    const dia = (d: number) => new Date(Date.UTC(2026, 2, d, 15));
    let seq = 0;
    const venda = (total: number, d: number, payments: [string, number][], extra = {}) => {
      const id = uuidv7();
      return {
        sale: {
          id,
          tenantId: ctx.tenantId,
          terminalId,
          storeId: loja.id,
          terminalSeq: ++seq,
          sessionId,
          kind: 'sale' as const,
          status: 'completed' as const,
          subtotalCents: total,
          discountCents: 0,
          totalCents: total,
          operatorId: ctx.userId,
          occurredAt: dia(d),
          data: {},
          ...extra,
        },
        payments: payments.map(([method, amountCents], idx) => ({
          tenantId: ctx.tenantId,
          saleId: id,
          idx,
          method,
          amountCents,
          changeCents: 0,
        })),
      };
    };
    const lista = [
      venda(10_000, 10, [
        ['cash', 6000],
        ['store_credit', 4000],
      ]),
      venda(5000, 10, [['pix', 5000]], { status: 'cancelled' }),
      venda(2000, 11, [['debit', 2000]]),
      venda(1000, 11, [], { kind: 'return', data: { refundMethod: 'cash' } }),
    ];
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: dia(10),
        openingCents: 0,
      });
      for (const v of lista) {
        await tx.insert(sales).values(v.sale);
        if (v.payments.length) await tx.insert(salePayments).values(v.payments);
      }
    });
    const [pagar] = (
      await admin.post('/finance/entries', {
        kind: 'payable',
        description: 'Aluguel',
        amountCents: 3000,
        dueDate: '2026-03-11',
      })
    ).json();
    await admin.post(`/finance/entries/${pagar.id}/pay`, { paidAt: '2026-03-11', paidCents: 3000 });
    await admin.post('/finance/entries', {
      kind: 'receivable',
      description: 'Cliente atacado',
      amountCents: 7000,
      dueDate: '2026-03-12',
    });

    const r = await admin.get('/finance/entries/cash-flow?from=2026-03-01&to=2026-03-31&group=day');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([
      expect.objectContaining({
        period: '2026-03-10',
        salesCents: 6000,
        netCents: 6000,
        balanceCents: 6000,
      }),
      expect.objectContaining({
        period: '2026-03-11',
        salesCents: 1000,
        paidCents: 3000,
        netCents: -2000,
        balanceCents: 4000,
      }),
      expect.objectContaining({
        period: '2026-03-12',
        projectedInCents: 7000,
        netCents: 0,
        balanceCents: 4000,
      }),
    ]);
    const mes = (
      await admin.get('/finance/entries/cash-flow?from=2026-03-01&to=2026-03-31&group=month')
    ).json();
    expect(mes).toEqual([
      expect.objectContaining({ period: '2026-03', netCents: 4000, projectedInCents: 7000 }),
    ]);
    expect(
      (await admin.get('/finance/entries/cash-flow?from=2026-03-31&to=2026-03-01')).statusCode,
    ).toBe(422);
  });
});
