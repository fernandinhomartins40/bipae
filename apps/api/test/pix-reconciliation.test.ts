import { buildSimulatedPixStatement, type PixChargeView } from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/common/di';
import { asPlatform, withTenant, type Db } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import type { PixHttpRequest, PixTransport } from '../src/modules/payments/pix-api';
import { PixChargesService } from '../src/modules/payments/pix-charges.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F6-02: conciliação automática do Pix recebido, com extrato simulado e parceiro simulado. O Pix de
 * verdade (banco e parceiro) depende do item E9.
 */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const E2E = 'E00000000202610271200abcdefghij1';

/** Mercado Pago de mentira: cria o QR e só "aprova" depois que o teste mandar. */
function partner() {
  const state = { paid: false };
  const transport: PixTransport = {
    send: (req: PixHttpRequest) =>
      Promise.resolve({
        status: req.method === 'POST' ? 201 : 200,
        body: JSON.stringify(
          req.method === 'POST'
            ? {
                id: 4242,
                status: 'pending',
                point_of_interaction: { transaction_data: { qr_code: '00020101mp4242' } },
              }
            : { id: 4242, status: state.paid ? 'approved' : 'pending' },
        ),
      }),
  };
  return { state, transport };
}

const platform = <T>(query: ReturnType<typeof sql>) =>
  asPlatform(t.app.get<Db>(DB), async (tx) => rowsOf<T>(await tx.execute(query)));

/** Escreve como o próprio cliente (a plataforma não insere em pix_charges). */
const asTenant = (tenantId: string, query: ReturnType<typeof sql>) =>
  withTenant(t.app.get<Db>(DB), { tenantId }, (tx) => tx.execute(query));

async function newClient() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const store = (await admin.get('/stores')).json()[0];
  return { dono, admin, store };
}

const receivable = (
  admin: ReturnType<typeof api>,
  description: string,
  amountCents: number,
  dueDate: string,
  customerId?: string,
) =>
  admin
    .post('/finance/entries', {
      kind: 'receivable',
      description,
      amountCents,
      dueDate,
      ...(customerId && { customerId }),
    })
    .then((r) => (r.json() as { id: string }[])[0]!);

describe('Pix cobrado para uma conta a receber (F6-02)', () => {
  it('cria o QR para a conta, e o pagamento confirmado dá baixa sozinho, só uma vez', async () => {
    const mp = partner();
    Object.assign(t.app.get(PixChargesService), { transport: mp.transport });
    const { dono, admin, store } = await newClient();
    await admin.put(`/stores/${store.id}/payment-settings`, {
      pix: 'psp',
      pixPsp: {
        provider: 'mercadopago',
        accessToken: 'APP_USR-segredo-mp',
        payerEmail: 'caixa@loja.com.br',
      },
    });
    const conta = await receivable(admin, 'Venda a prazo', 12_345, '2026-10-30');

    const sem = await admin.post(`/payments/pix/charges/entries/${conta.id}`, {});
    expect(sem.statusCode).toBe(400);
    const res = await admin.post(`/payments/pix/charges/entries/${conta.id}`, {
      storeId: store.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    const charge = res.json() as PixChargeView;
    expect(charge).toMatchObject({ amountCents: 12_345, status: 'pending' });
    expect((await admin.get('/finance/entries?status=open')).json()).toHaveLength(1);

    mp.state.paid = true;
    const ctx = {
      tenantId: dono.me.tenant.id,
      userId: dono.me.user.id,
      permissions: [],
      storeIds: null,
    } as never;
    const service = t.app.get(PixChargesService);
    expect(await service.get(ctx, charge.txid, new Date(Date.now() + 3000))).toMatchObject({
      status: 'paid',
    });
    // Aviso repetido ou nova consulta não mudam nada.
    await service.get(ctx, charge.txid, new Date(Date.now() + 9000));
    const pagas = (await admin.get('/finance/entries?status=paid')).json();
    expect(pagas).toEqual([
      expect.objectContaining({ id: conta.id, paidCents: 12_345, paymentMethod: 'pix' }),
    ]);

    // Conta a pagar e conta já paga não geram cobrança.
    const pagar = (
      await admin.post('/finance/entries', {
        kind: 'payable',
        description: 'Luz',
        amountCents: 100,
        dueDate: '2026-10-30',
      })
    ).json()[0];
    const errada = await admin.post(`/payments/pix/charges/entries/${pagar.id}`, {
      storeId: store.id,
    });
    expect(errada.json().code).toBe('not_receivable');
    const fechada = await admin.post(`/payments/pix/charges/entries/${conta.id}`, {
      storeId: store.id,
    });
    expect(fechada.statusCode).toBe(409);
    const naoExiste = await admin.post(
      '/payments/pix/charges/entries/0192abcd-0000-7000-8000-000000000001',
      { storeId: store.id },
    );
    expect(naoExiste.statusCode).toBe(404);
  });
});

describe('conciliação automática do extrato (F6-02)', () => {
  it('concilia pelo código fim a fim e pelo nome do pagador; na dúvida, deixa pendente', async () => {
    const { dono, admin, store } = await newClient();
    const tenantId = dono.me.tenant.id as string;
    const cliente = (
      await admin.post('/customers', { name: 'João da Silva', taxId: '12345678909' })
    ).json();
    const outro = (
      await admin.post('/customers', { name: 'Maria Souza', taxId: '52998224725' })
    ).json();
    const joao = await receivable(admin, 'Fiado do João', 25_000, '2026-10-26', cliente.id);
    const maria1 = await receivable(admin, 'Fiado da Maria 1', 9_900, '2026-10-27', outro.id);
    const maria2 = await receivable(admin, 'Fiado da Maria 2', 9_900, '2026-10-28', outro.id);
    const semNome = await receivable(admin, 'Venda avulsa', 7_700, '2026-10-27');

    // Cobrança Pix de uma venda no caixa, já paga, com o código fim a fim guardado.
    await asTenant(
      tenantId,
      sql`
      insert into pix_charges (id, tenant_id, store_id, txid, provider, amount_cents, copy_paste,
        status, end_to_end_id, created_by, paid_at)
      values (gen_random_uuid(), ${tenantId}, ${store.id}, 'TXID0123456789012345678901234',
        'pix_api', 10005, '000201', 'paid', ${E2E}, ${dono.me.user.id}, now())
    `,
    );

    const extrato = buildSimulatedPixStatement([
      {
        fitId: 'P1',
        postedOn: '2026-10-27',
        amountCents: 10_005,
        payer: 'CLIENTE X',
        endToEndId: E2E,
      },
      { fitId: 'P2', postedOn: '2026-10-27', amountCents: 25_000, payer: 'JOAO SILVA' },
      { fitId: 'P3', postedOn: '2026-10-27', amountCents: 9_900, payer: 'MARIA SOUZA' },
      { fitId: 'P4', postedOn: '2026-10-27', amountCents: 7_700, payer: 'FULANO' },
      { fitId: 'P5', postedOn: '2026-10-27', amountCents: 3_000, payer: 'ALGUEM' },
    ]);
    const result = await admin.post('/finance/bank/import', { content: extrato });
    expect(result.json()).toMatchObject({ imported: 5, pixAutoMatched: 2 });

    const pendentes = (await admin.get('/finance/bank/transactions')).json() as {
      amountCents: number;
      suggestions: { id: string }[];
    }[];
    // Maria tem duas contas iguais: ambíguo. Sem nome ou sem conta: pendente.
    expect(pendentes.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([
      3_000, 7_700, 9_900,
    ]);
    expect(pendentes.find((p) => p.amountCents === 7_700)!.suggestions[0]!.id).toBe(semNome.id);
    expect(pendentes.find((p) => p.amountCents === 9_900)!.suggestions).toHaveLength(2);

    const conciliados = (await admin.get('/finance/bank/transactions?status=matched')).json() as {
      amountCents: number;
      autoMatched: boolean;
      matchReason: string;
      entryId: string | null;
    }[];
    expect(conciliados).toHaveLength(2);
    expect(conciliados.every((c) => c.autoMatched)).toBe(true);
    const porJoao = conciliados.find((c) => c.amountCents === 25_000)!;
    expect(porJoao.entryId).toBe(joao.id);
    expect(porJoao.matchReason).toContain('nome');
    expect(conciliados.find((c) => c.amountCents === 10_005)!.matchReason).toContain('fim a fim');

    const pagas = (await admin.get('/finance/entries?status=paid')).json();
    expect(pagas).toEqual([
      expect.objectContaining({
        id: joao.id,
        paymentMethod: 'pix',
        paidAt: '2026-10-27',
        paidCents: 25_000,
      }),
    ]);

    // Rodar de novo não muda nada (e o botão da tela faz isso).
    const again = await admin.post('/finance/bank/reconcile-pix', {});
    expect(again.json()).toEqual({ pixAutoMatched: 0 });

    // Resolver a ambiguidade à mão continua possível pelo caminho de sempre.
    const maria = pendentes.find((p) => p.amountCents === 9_900) as unknown as { id: string };
    const manual = await admin.post(`/finance/bank/transactions/${maria.id}/match`, {
      entryId: maria1.id,
    });
    expect(manual.statusCode).toBe(201);
    expect(maria2.id).not.toBe(maria1.id);

    const audit = await platform<{ action: string }>(
      sql`select action from audit_log where tenant_id = ${tenantId} and action = 'finance.pix_auto_matched'`,
    );
    expect(audit).toHaveLength(2);
  });

  it('um valor diferente do da cobrança não concilia pelo código fim a fim', async () => {
    const { dono, admin, store } = await newClient();
    const e2e = 'E00000000202610271300zzzzzzzzzz2';
    await asTenant(
      dono.me.tenant.id,
      sql`
      insert into pix_charges (id, tenant_id, store_id, txid, provider, amount_cents, copy_paste,
        status, end_to_end_id, created_by, paid_at)
      values (gen_random_uuid(), ${dono.me.tenant.id}, ${store.id}, 'TXID9999999999999999999999999',
        'pix_api', 5000, '000201', 'paid', ${e2e}, ${dono.me.user.id}, now())
    `,
    );
    const extrato = buildSimulatedPixStatement([
      {
        fitId: 'Q1',
        postedOn: '2026-10-27',
        amountCents: 4_000,
        payer: 'CLIENTE',
        endToEndId: e2e,
      },
    ]);
    expect((await admin.post('/finance/bank/import', { content: extrato })).json()).toMatchObject({
      pixAutoMatched: 0,
    });
  });
});
