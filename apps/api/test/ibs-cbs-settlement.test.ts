import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { cashSessions, purchaseInvoices, saleItems, sales } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F4-13: apuração gerencial do IBS e da CBS. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const imposto = (ibsCents: number | null, cbsCents: number | null) => ({
  crt: 3,
  cfop: '5102',
  icmsCents: null,
  icmsStCents: null,
  fcpCents: null,
  pisCents: null,
  cofinsCents: null,
  ibsCents,
  cbsCents,
  complete: ibsCents !== null,
  pending: [],
});

describe('apuração do IBS e da CBS (F4-13)', () => {
  it('débitos das vendas menos devoluções contra créditos das compras, por mês e empresa', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    const [empresa] = (await admin.get('/companies')).json();
    const [loja] = (await admin.get('/stores')).json();
    const caixa = (
      await admin.post('/terminals', { storeId: loja.id, name: 'Caixa', platform: 'web' })
    ).json();
    const terminalId = (caixa.terminal ?? caixa).id as string;
    const fornecedor = (
      await admin.post('/suppliers', { name: 'Atacado Sul', taxId: '11.444.777/0001-61' })
    ).json();
    const produto = (await admin.post('/products', { name: 'Café', priceCents: 2000 })).json();
    const mes = '2027-03';
    const quando = new Date(Date.UTC(2027, 2, 10, 15));

    // Sem regime, pede a configuração.
    const semRegime = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)
    ).json();
    expect(semRegime.mode).toBe('falta-configurar');

    const vendaId = uuidv7();
    const sessionId = uuidv7();
    await withTenant(t.database.db, ctx as never, async (tx) => {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: ctx.tenantId,
        terminalId,
        operatorId: ctx.userId,
        openedAt: quando,
        openingCents: 0,
      });
      const venda = async (id: string, seq: number, linhas: [number, unknown][]) => {
        const total = linhas.reduce((s, [c]) => s + c, 0);
        await tx.insert(sales).values({
          id,
          tenantId: ctx.tenantId,
          terminalId,
          storeId: loja.id,
          terminalSeq: seq,
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
          linhas.map(([c, taxes], i) => ({
            tenantId: ctx.tenantId,
            saleId: id,
            line: i + 1,
            productId: produto.id,
            name: 'Café',
            unit: 'UN',
            quantityMilli: 1000,
            unitPriceCents: c,
            grossCents: c,
            discountCents: 0,
            totalCents: c,
            taxes,
          })),
        );
      };
      // Linha 1: IBS 10,00 e CBS 90,00 sobre R$ 1.000,00; linha 2 ficou sem cálculo.
      await venda(vendaId, 1, [
        [100_000, imposto(1000, 9000)],
        [5000, null],
      ]);
      // Devolução de R$ 333,33 da linha 1: estorna IBS 3,33 e CBS 30,00 (meio para cima).
      await tx.insert(sales).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        terminalId,
        storeId: loja.id,
        terminalSeq: 2,
        sessionId,
        kind: 'return',
        status: 'completed',
        originalSaleId: vendaId,
        subtotalCents: 33_333,
        discountCents: 0,
        totalCents: 33_333,
        operatorId: ctx.userId,
        occurredAt: quando,
        data: {
          items: [{ line: 1, productId: produto.id, quantityMilli: 333, refundCents: 33_333 }],
        },
      });
      const nota = (authorized: boolean, ibsCbs: unknown, n: number) => ({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: loja.id,
        supplierId: fornecedor.id,
        accessKey: String(n).padStart(44, '4'),
        number: n,
        series: 1,
        issuedAt: quando,
        totalCents: 50_000,
        authorized,
        signatureValid: true,
        xml: '<nfeProc/>',
        items: [
          {
            line: 1,
            supplierCode: 'C1',
            description: 'Café',
            productId: produto.id,
            factor: '1',
            quantityMilli: 1000,
            unitCostCents: 50_000,
            created: false,
            taxes: { pisCents: 0, cofinsCents: 0, ...(ibsCbs ? { ibsCbs } : {}) },
          },
        ],
        importedBy: ctx.userId,
      });
      await tx.insert(purchaseInvoices).values([
        nota(true, { cst: '000', cClassTrib: '000001', ibsCents: 500, cbsCents: 4500 }, 1),
        // Nota sem autorização não dá crédito; nota sem o grupo IBS/CBS fica pendente.
        nota(false, { cst: '000', cClassTrib: '000001', ibsCents: 999, cbsCents: 999 }, 2),
        nota(true, null, 3),
      ]);
    });

    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxRegime: 'real',
    });
    const r = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)
    ).json();
    expect(r).toMatchObject({
      mode: 'regular',
      totals: {
        salesIbsCents: 1000,
        salesCbsCents: 9000,
        returnsIbsCents: 333,
        returnsCbsCents: 3000,
        purchasesIbsCents: 500,
        purchasesCbsCents: 4500,
      },
      ibs: { debitCents: 667, creditCents: 500, payableCents: 167, creditLeftCents: 0 },
      cbs: { debitCents: 6000, creditCents: 4500, payableCents: 1500 },
      period: null,
      pending: {
        saleItemsWithoutTax: 1,
        purchaseItemsWithoutIbsCbs: 2,
        purchaseItemsPersonalUse: 0,
      },
    });
    expect(r.sources.join(' ')).toContain('art. 47');

    // Uso ou consumo pessoal (LC 214/2025, art. 57): a nota sai do crédito, e a marcação é auditada.
    const compras = (await admin.get('/purchases')).json() as { id: string; number: number }[];
    const notaComCredito = compras.find((c) => c.number === 1)!;
    const marcar = await admin.put(`/purchases/${notaComCredito.id}/personal-use`, {
      personalUse: true,
    });
    expect(marcar.statusCode).toBe(200);
    expect((await admin.get('/purchases')).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ number: 1, personalUse: true })]),
    );
    const pessoal = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)
    ).json();
    expect(pessoal.totals).toMatchObject({ purchasesIbsCents: 0, purchasesCbsCents: 0 });
    expect(pessoal.ibs).toMatchObject({ creditCents: 0, payableCents: 667 });
    expect(pessoal.pending).toMatchObject({ purchaseItemsPersonalUse: 1 });
    const auditoria = (await admin.get('/audit?action=purchase.personal_use')).json();
    expect(JSON.stringify(auditoria)).toContain('purchase.personal_use');
    await admin.put(`/purchases/${notaComCredito.id}/personal-use`, { personalUse: false });
    expect(
      (await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)).json()
        .totals.purchasesIbsCents,
    ).toBe(500);
    expect(
      (await admin.put(`/purchases/${notaComCredito.id}/personal-use`, { personalUse: 'sim' }))
        .statusCode,
    ).toBe(400);

    // Outro mês não mistura.
    const abril = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=2027-04`)
    ).json();
    expect(abril.totals.salesIbsCents).toBe(0);

    // Simples: vai no DAS, a menos que a empresa tenha optado pelo regime regular.
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxRegime: 'simples',
    });
    const simples = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)
    ).json();
    expect(simples).toMatchObject({ mode: 'simples', ibs: null });
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxRegime: 'simples',
      ibsCbsRegular: true,
    });
    expect(
      (await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=${mes}`)).json()
        .mode,
    ).toBe('regular');

    // 2026: fase de teste, com a dispensa de recolhimento e a fonte.
    const teste = (
      await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=2026-10`)
    ).json();
    expect(teste.period).toMatchObject({ paymentWaived: true });

    expect(
      (await admin.get(`/fiscal/ibs-cbs/settlement?companyId=${empresa.id}&month=2027-13`))
        .statusCode,
    ).toBe(422);
  });
});
