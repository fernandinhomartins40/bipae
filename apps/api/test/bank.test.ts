import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-07: conciliação bancária por OFX. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ofx = (lines: [string, string, string, string][]) => `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
${lines.map(([fit, date, amount, memo]) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${date}<TRNAMT>${amount}<FITID>${fit}<MEMO>${memo}</STMTTRN>`).join('\n')}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('conciliação bancária (F4-07)', () => {
  it('importa sem duplicar, sugere a conta, concilia dando baixa e ignora', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [aluguel] = (
      await admin.post('/finance/entries', {
        kind: 'payable',
        description: 'Aluguel',
        amountCents: 150_000,
        dueDate: '2026-10-08',
      })
    ).json();
    await admin.post('/finance/entries', {
      kind: 'receivable',
      description: 'Venda a prazo',
      amountCents: 150_000,
      dueDate: '2026-10-08',
    });
    const extrato = ofx([
      ['A1', '20261010', '-1500.00', 'PAG ALUGUEL'],
      ['A2', '20261011', '-12.90', 'TARIFA'],
    ]);
    const primeira = await admin.post('/finance/bank/import', { content: extrato });
    expect(primeira.json()).toEqual({
      account: 'Banco 0341 · Conta 12345-6',
      imported: 2,
      repeated: 0,
      pixAutoMatched: 0,
    });
    expect((await admin.post('/finance/bank/import', { content: extrato })).json()).toMatchObject({
      imported: 0,
      repeated: 2,
    });

    const pendentes = (await admin.get('/finance/bank/transactions')).json();
    expect(pendentes).toHaveLength(2);
    // A saída de R$ 1.500 sugere só a conta a pagar (não a a receber de mesmo valor).
    expect(pendentes[0].suggestions).toEqual([
      expect.objectContaining({ id: aluguel.id, description: 'Aluguel' }),
    ]);
    expect(pendentes[1].suggestions).toEqual([]);

    const receber = (await admin.get('/finance/entries?kind=receivable')).json()[0];
    const errado = await admin.post(`/finance/bank/transactions/${pendentes[0].id}/match`, {
      entryId: receber.id,
    });
    expect(errado.statusCode).toBe(422);
    expect(errado.json().message).toBe('Saída do banco só concilia com conta a pagar.');

    await admin.post(`/finance/bank/transactions/${pendentes[0].id}/match`, {
      entryId: aluguel.id,
    });
    const pago = (await admin.get('/finance/entries?status=paid')).json();
    expect(pago).toEqual([
      expect.objectContaining({
        id: aluguel.id,
        paidAt: '2026-10-10',
        paidCents: 150_000,
        paymentMethod: 'banco',
      }),
    ]);
    await admin.post(`/finance/bank/transactions/${pendentes[1].id}/ignore`);
    expect((await admin.get('/finance/bank/transactions')).json()).toEqual([]);
    expect((await admin.get('/finance/bank/transactions?status=matched')).json()).toHaveLength(1);
    expect(
      (await admin.post(`/finance/bank/transactions/${pendentes[1].id}/ignore`)).statusCode,
    ).toBe(409);
  });

  it('arquivo que não é OFX tem mensagem clara', async () => {
    const dono = await signup(t.app);
    const r = await api(t.app, dono.auth).post('/finance/bank/import', {
      content: 'isto não é um extrato bancário',
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toBe('Este arquivo não é um extrato OFX.');
  });
});
