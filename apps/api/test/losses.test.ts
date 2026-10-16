import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashMovements, cashSessions, sales, stockLots, stockMovements } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F5-05: painel de prevenção de perdas por operador, estoque e lotes vencidos. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const hoje = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

describe('painel de prevenção de perdas (F5-05)', () => {
  it('soma por operador, aponta quem foge do padrão e mostra perdas e vencidos', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [store] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: store.id, name: 'Caixa 1', platform: 'web' })
    ).json();
    const produto = (
      await admin.post('/products', { name: 'Azeite 500 ml', priceCents: 3990, costCents: 2500 })
    ).json();
    const ana = dono.me.user.id as string;
    // Operador sem cadastro visível neste cliente: aparece como "Operador".
    const beto = uuidv7();
    const agora = new Date();

    await withTenant(t.database.db, ctx as never, async (tx) => {
      const sessao = async (operatorId: string, differenceCents: number) => {
        const id = uuidv7();
        await tx.insert(cashSessions).values({
          id,
          tenantId: ctx.tenantId,
          terminalId: caixa.id,
          operatorId,
          openedAt: agora,
          openingCents: 0,
          closedAt: agora,
          differenceCents,
        });
        return id;
      };
      const sAna = await sessao(ana, 0);
      const sBeto = await sessao(beto, -2500);
      let seq = 0;
      const venda = (
        operatorId: string,
        sessionId: string,
        extra: Partial<typeof sales.$inferInsert> = {},
      ) =>
        tx.insert(sales).values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          terminalId: caixa.id,
          storeId: store.id,
          terminalSeq: ++seq,
          sessionId,
          kind: 'sale',
          status: 'completed',
          subtotalCents: 1000,
          discountCents: 0,
          totalCents: 1000,
          operatorId,
          occurredAt: agora,
          data: {},
          ...extra,
        });
      // Ana: 20 vendas, 1 cancelada. Beto: 6 vendas, 4 canceladas e 1 com desconto autorizado.
      for (let i = 0; i < 20; i++) {
        await venda(ana, sAna, i === 0 ? { status: 'cancelled', cancelledAt: agora } : {});
      }
      for (let i = 0; i < 6; i++) {
        await venda(beto, sBeto, i < 4 ? { status: 'cancelled', cancelledAt: agora } : {});
      }
      await venda(beto, sBeto, { discountCents: 300, totalCents: 700, discountAuthorizedBy: ana });
      await venda(ana, sAna, { kind: 'return', totalCents: 500 });
      await tx.insert(cashMovements).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        sessionId: sBeto,
        kind: 'withdrawal',
        amountCents: 20_000,
        operatorId: beto,
        authorizedBy: ana,
        occurredAt: agora,
      });
      // Perda de estoque: 2 unidades a menos por ajuste (a custo, R$ 50,00).
      await tx.insert(stockMovements).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        storeId: store.id,
        productId: produto.id,
        deltaMilli: -2000,
        reason: 'adjustment',
        note: 'Quebra',
        actorId: ana,
        occurredAt: agora,
      });
      await tx.insert(stockLots).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        storeId: store.id,
        productId: produto.id,
        lotCode: 'L-VENCIDO',
        expiresOn: '2026-01-31',
        quantityMilli: 3000,
      });
    });

    const res = await admin.get(`/reports/losses?from=${hoje()}&to=${hoje()}`);
    expect(res.statusCode).toBe(200);
    const painel = res.json();
    expect(painel.totals).toMatchObject({
      salesCount: 27,
      cancelledCount: 5,
      cancelledCents: 5000,
      returnsCount: 1,
      returnsCents: 500,
      authorizedDiscountCount: 1,
      authorizedDiscountCents: 300,
      withdrawalsCount: 1,
      withdrawalsCents: 20_000,
      cashDifferenceCents: -2500,
      stockLossCostCents: 5000,
      expiredCostCents: 7500,
    });
    // Quem tem alerta vem primeiro.
    const [primeiro, segundo] = painel.operators;
    expect(primeiro).toMatchObject({
      operatorId: beto,
      name: 'Operador',
      salesCount: 7,
      cancelledCount: 4,
      cancelRateBp: 5714,
      cashDifferenceCents: -2500,
    });
    expect(primeiro.alerts).toEqual([
      'Cancelou 57,1% das vendas; a média do período é 18,5%.',
      'Faltou R$ 25,00 nos fechamentos de caixa.',
    ]);
    expect(segundo).toMatchObject({ operatorId: ana, cancelledCount: 1, alerts: [] });
    expect(painel.products).toEqual([
      { productId: produto.id, name: 'Azeite 500 ml', lostMilli: 2000, lostCostCents: 5000 },
    ]);
    expect(painel.expiredLots).toEqual([
      expect.objectContaining({ lotCode: 'L-VENCIDO', quantityMilli: 3000, costCents: 7500 }),
    ]);
    expect(painel.alerts).toEqual(
      expect.arrayContaining([
        'Perdas de estoque somam R$ 50,00 a custo; a maior é Azeite 500 ml (R$ 50,00).',
        '1 lote(s) vencido(s) ainda no estoque (R$ 75,00 a custo): retire da venda e dê baixa como perda.',
      ]),
    );

    // Período sem nada: zeros (os vencidos continuam, porque são a situação de hoje).
    const vazio = (await admin.get('/reports/losses?from=2020-01-01&to=2020-01-31')).json();
    expect(vazio.totals.salesCount).toBe(0);
    expect(vazio.operators).toEqual([]);
    expect(vazio.expiredLots).toHaveLength(1);
    expect((await admin.get('/reports/losses?from=2026-02-01&to=2026-01-01')).statusCode).toBe(422);
  });

  it('operador de caixa não vê o painel', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string }[];
    expect(roles.some((r) => r.systemKey === 'cashier')).toBe(true);
    // O papel de caixa não tem a permissão de auditoria que o painel exige.
    const caixa = roles.find((r) => r.systemKey === 'cashier') as unknown as {
      permissions: string[];
    };
    expect(caixa.permissions).not.toContain('audit.read');
  });
});
