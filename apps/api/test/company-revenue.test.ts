import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, sales } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F3-29: receita do ano da empresa e os avisos de limite do Simples. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('receita do ano e limites do regime (F3-29)', () => {
  it('Simples acima do sublimite avisa para mudar para o CRT 2; vendas de outro ano e canceladas não contam', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [empresa] = (await admin.get('/companies')).json();
    const [loja] = (await admin.get('/stores')).json();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      uf: 'SP',
      taxRegime: 'simples',
    });
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa 1', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const sessionId = uuidv7();
    const agora = new Date();
    const anoPassado = new Date(agora.getFullYear() - 1, 5, 1);
    let seq = 0;
    const venda = (totalCents: number, extra: Partial<typeof sales.$inferInsert> = {}) => ({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      terminalId,
      storeId: loja.id,
      terminalSeq: ++seq,
      sessionId,
      kind: 'sale' as const,
      status: 'completed' as const,
      subtotalCents: totalCents,
      discountCents: 0,
      totalCents,
      operatorId: ctx.userId,
      occurredAt: agora,
      data: {},
      ...extra,
    });
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: agora,
        openingCents: 0,
      });
      await tx
        .insert(sales)
        .values([
          venda(300_000_000),
          venda(70_000_000),
          venda(5_000_000, { kind: 'return' }),
          venda(9_000_000, { status: 'cancelled' }),
          venda(50_000_000, { occurredAt: anoPassado }),
        ]);
    });

    const r = await admin.get(`/companies/${empresa.id}/revenue`);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.yearRevenueCents).toBe(365_000_000);
    expect(body.alerts).toEqual([
      expect.objectContaining({
        level: 'critical',
        message: expect.stringContaining('CRT 2'),
      }),
    ]);
    expect(body.note).toContain('vendas registradas no Bipaê');
  });
});
