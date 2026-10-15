import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, salePayments, sales } from '../src/db/schema';
import { feeOf } from '../src/modules/finance/settlement.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-08: recebíveis de cartão e Pix conferidos com o extrato. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('recebíveis de cartão e Pix (F4-08)', () => {
  it('taxa meio para cima', () => {
    expect(feeOf(10_000, 199)).toBe(199);
    expect(feeOf(3333, 250)).toBe(83); // 83,325 → 83
    expect(feeOf(3334, 250)).toBe(83); // 83,35 → 83
    expect(feeOf(3340, 250)).toBe(84); // 83,5 → 84
  });

  it('prevê o recebimento por forma, desconta a taxa e confere com o extrato', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const sessionId = uuidv7();
    const quando = new Date(Date.UTC(2026, 9, 5, 15)); // 05/10/2026
    let seq = 0;
    const vendas = [
      ['debit', 10_000],
      ['debit', 5000],
      ['credit', 20_000],
      ['pix', 3000],
      ['cash', 9999],
    ] as const;
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: quando,
        openingCents: 0,
      });
      for (const [method, cents] of vendas) {
        const id = uuidv7();
        await tx.insert(sales).values({
          id,
          tenantId: ctx.tenantId,
          terminalId,
          storeId: loja.id,
          terminalSeq: ++seq,
          sessionId,
          kind: 'sale',
          status: 'completed',
          subtotalCents: cents,
          discountCents: 0,
          totalCents: cents,
          operatorId: ctx.userId,
          occurredAt: quando,
          data: {},
        });
        await tx.insert(salePayments).values({
          tenantId: ctx.tenantId,
          saleId: id,
          idx: 0,
          method,
          amountCents: cents,
          changeCents: 0,
        });
      }
    });

    const padrao = (await admin.get('/finance/settlement-rules')).json();
    expect(padrao.find((r: { method: string }) => r.method === 'debit')).toEqual({
      method: 'debit',
      feeBp: 0,
      days: 1,
      configured: false,
    });
    await admin.put('/finance/settlement-rules', {
      rules: [
        { method: 'debit', feeBp: 150, days: 1 },
        { method: 'credit', feeBp: 300, days: 30 },
      ],
    });
    // O débito do dia 05 cai no dia 06: 150,00 − 1,5% = 147,75.
    await admin.post('/finance/bank/import', {
      content: `<OFX><BANKACCTFROM><BANKID>1<ACCTID>9</BANKACCTFROM>
<STMTTRN><DTPOSTED>20261006<TRNAMT>147.75<FITID>D1<MEMO>REDE DEBITO</STMTTRN></OFX>`,
    });

    const r = await admin.get('/finance/settlements?from=2026-10-01&to=2026-10-31');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([
      {
        date: '2026-10-05',
        method: 'pix',
        salesCount: 1,
        grossCents: 3000,
        feeCents: 0,
        netCents: 3000,
        received: false,
      },
      {
        date: '2026-10-06',
        method: 'debit',
        salesCount: 2,
        grossCents: 15_000,
        feeCents: 225,
        netCents: 14_775,
        received: true,
      },
      {
        date: '2026-11-04',
        method: 'credit',
        salesCount: 1,
        grossCents: 20_000,
        feeCents: 600,
        netCents: 19_400,
        received: false,
      },
    ]);
    const trilha = JSON.stringify(
      (await admin.get('/audit?action=finance.settlement_rules_changed')).json(),
    );
    expect(trilha).toContain('settlement_rules_changed');
  });
});
