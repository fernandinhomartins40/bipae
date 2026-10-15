import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths, splitInstallments, todayBr } from '../src/modules/finance/finance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-04: contas a pagar e a receber. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('regras das parcelas', () => {
  it('meses com fim de mês e centavos que sobram na primeira parcela', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(splitInstallments(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(500, 1)).toEqual([500]);
  });
});

describe('contas a pagar e a receber (F4-04)', () => {
  it('lança parcelado, dá baixa com juros e mostra o resumo e o vencido', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const fornecedor = (await admin.post('/suppliers', { name: 'Distribuidora Boa' })).json();
    const r = await admin.post('/finance/entries', {
      kind: 'payable',
      description: 'Compra de mercadoria',
      category: 'Mercadoria',
      supplierId: fornecedor.id,
      document: 'NF 123',
      amountCents: 10_000,
      dueDate: '2026-01-31',
      installments: 3,
    });
    expect(r.statusCode).toBe(201);
    const parcelas = r.json();
    expect(
      parcelas.map((p: { dueDate: string; amountCents: number }) => [p.dueDate, p.amountCents]),
    ).toEqual([
      ['2026-01-31', 3334],
      ['2026-02-28', 3333],
      ['2026-03-31', 3333],
    ]);
    expect(parcelas[0]).toMatchObject({
      partyName: 'Distribuidora Boa',
      installment: 1,
      installments: 3,
    });
    // Vencidas (antes de hoje) aparecem como vencidas.
    expect(parcelas[0].overdue).toBe('2026-01-31' < todayBr());

    const receber = await admin.post('/finance/entries', {
      kind: 'receivable',
      description: 'Venda a prazo',
      amountCents: 5000,
      dueDate: '2099-01-10',
    });
    expect(receber.json()[0]).toMatchObject({ overdue: false, status: 'open' });

    const pago = await admin.post(`/finance/entries/${parcelas[0].id}/pay`, {
      paidAt: '2026-02-02',
      paidCents: 3400,
      paymentMethod: 'pix',
    });
    expect(pago.json()).toMatchObject({ status: 'paid', paidCents: 3400, overdue: false });
    expect(
      (
        await admin.post(`/finance/entries/${parcelas[0].id}/pay`, {
          paidAt: '2026-02-02',
          paidCents: 1,
        })
      ).statusCode,
    ).toBe(409);

    const resumo = (await admin.get('/finance/entries/summary')).json();
    expect(resumo.payable.openCents).toBe(6666);
    expect(resumo.receivable.openCents).toBe(5000);

    expect((await admin.get('/finance/entries?kind=receivable')).json()).toHaveLength(1);
    expect((await admin.get('/finance/entries?status=paid')).json()).toHaveLength(1);

    const cancelado = await admin.post(`/finance/entries/${parcelas[2].id}/cancel`, {
      reason: 'Desconto negociado',
    });
    expect(cancelado.json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Desconto negociado',
    });
    const trilha = JSON.stringify((await admin.get('/audit?action=finance.cancelled')).json());
    expect(trilha).toContain('Desconto negociado');
  });

  it('o operador de caixa não vê o financeiro; o contador vê mas não lança', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const entrar = async (key: string) => {
      const email = `${key}-${Date.now()}@exemplo.com.br`;
      await admin.post('/members', {
        name: key,
        email,
        password: 'senha-forte-123',
        roleId: roles.find((r) => r.systemKey === key)!.id,
      });
      const login = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'senha-forte-123' },
      });
      return api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    };
    const caixa = await entrar('cashier');
    expect((await caixa.get('/finance/entries')).statusCode).toBe(403);
    const contador = await entrar('accountant');
    expect((await contador.get('/finance/entries')).statusCode).toBe(200);
    expect(
      (
        await contador.post('/finance/entries', {
          kind: 'payable',
          description: 'Luz',
          amountCents: 100,
          dueDate: '2026-12-01',
        })
      ).statusCode,
    ).toBe(403);
  });
});
