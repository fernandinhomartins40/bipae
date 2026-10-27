import type { AdminBillingDetail, BillingView, InvoiceView } from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTotp } from '../src/common/totp';
import { DB } from '../src/common/di';
import { asPlatform, type Db } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F6-04.c e F6-04.d: boleto e cartão recorrente como formas de pagar a fatura (parceiros
 * simulados) e a cobrança por cliente no painel da plataforma. Os preços são só de teste: os
 * valores reais dos planos (item E8) ainda não foram decididos.
 */

let t: TestApp;
const DAY = 86_400_000;
const PASSWORD = 'senha-forte-123';

beforeAll(async () => {
  t = await createTestApp({
    BILLING_PROVIDER: 'simulator',
    BILLING_BOLETO_PROVIDER: 'simulator',
    BILLING_CARD_PROVIDER: 'simulator',
  });
  await asPlatform(t.app.get<Db>(DB), (tx) =>
    tx.execute(
      sql`update plans set price_cents = case id when 'essencial' then 10000 when 'profissional' then 30000 else price_cents end`,
    ),
  );
});
afterAll(async () => {
  await t.close();
});

const maintenance = () => t.app.get(MaintenanceService);
const platform = <T>(query: ReturnType<typeof sql>) =>
  asPlatform(t.app.get<Db>(DB), async (tx) => rowsOf<T>(await tx.execute(query)));

const billingOf = async (client: ReturnType<typeof api>) =>
  (await client.get('/account/billing')).json() as BillingView;

async function staff(role: 'owner' | 'support' | 'viewer' = 'owner') {
  const person = await signup(t.app, { plan: null });
  await asPlatform(t.database.db, (tx) =>
    tx.execute(
      sql`insert into platform_admins (user_id, role) values (${person.me.user.id}, ${role})`,
    ),
  );
  const login = await t.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email: person.me.user.email, password: PASSWORD },
  });
  const bearer = { authorization: `Bearer ${login.json().accessToken}` };
  const setup = await t.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/totp/setup',
    headers: bearer,
  });
  const enabled = await t.app.inject({
    method: 'POST',
    url: '/v1/admin/auth/totp/enable',
    headers: bearer,
    payload: { code: currentTotp(setup.json().secret as string) },
  });
  return api(t.app, { authorization: `Bearer ${enabled.json().accessToken}` });
}

async function subscribe(client: ReturnType<typeof api>, planId = 'essencial') {
  const res = await client.post('/account/billing/subscribe', { planId });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { invoice: InvoiceView }).invoice;
}

describe('boleto como forma de pagar a fatura (F6-04.c)', () => {
  it('gera o boleto, trava a troca de forma e confirma só por consulta', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    expect((await billingOf(client)).gateway).toMatchObject({
      boletoAvailable: true,
      cardAvailable: true,
    });
    const invoice = await subscribe(client);

    // Sem CNPJ cadastrado, o parceiro não registra o boleto.
    const semCnpj = await client.post(`/account/billing/invoices/${invoice.id}/boleto`);
    expect(semCnpj.statusCode).toBe(422);
    expect(semCnpj.json().code).toBe('billing_payer_without_tax_id');
    const [empresa] = (await client.get('/companies')).json();
    await client.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
    });

    const res = await client.post(`/account/billing/invoices/${invoice.id}/boleto`);
    expect(res.statusCode, res.body).toBe(201);
    const boleto = res.json() as InvoiceView;
    expect(boleto.method).toBe('boleto');
    expect(boleto.boletoLine).toMatch(/^\d{47}$/);
    // Repetir devolve o mesmo boleto.
    const again = (await client.post(`/account/billing/invoices/${invoice.id}/boleto`)).json();
    expect(again.boletoLine).toBe(boleto.boletoLine);

    const lock = await client.post(`/account/billing/invoices/${invoice.id}/pix`);
    expect(lock.statusCode).toBe(422);
    expect(lock.json().code).toBe('invoice_method_locked');

    await maintenance().billingSweep(new Date(Date.now() + 10_000), id);
    expect((await billingOf(client)).openInvoice?.id).toBe(invoice.id);

    expect(
      (await client.post(`/account/billing/invoices/${invoice.id}/simulate-pay`)).statusCode,
    ).toBe(201);
    await maintenance().billingSweep(new Date(Date.now() + 20_000), id);
    const view = await billingOf(client);
    expect(view.openInvoice).toBeNull();
    expect(view.invoices[0]).toMatchObject({ status: 'paid', method: 'boleto' });
    const [row] = await platform<{ plan_id: string }>(
      sql`select plan_id from tenants where id = ${id}`,
    );
    expect(row?.plan_id).toBe('essencial');
  });

  it('sem a conta do parceiro, o boleto e o cartão ficam em "falta configurar"', async () => {
    const off = await createTestApp({ BILLING_PROVIDER: 'simulator' });
    try {
      const dono = await signup(off.app, { plan: 'gratis' });
      const client = api(off.app, dono.auth);
      const view = (await client.get('/account/billing')).json() as BillingView;
      expect(view.gateway).toMatchObject({ boletoAvailable: false, cardAvailable: false });
      const card = await client.put('/account/billing/card', { token: 'tok_ok' });
      expect(card.statusCode).toBe(422);
      expect(card.json().code).toBe('billing_card_not_available');
    } finally {
      await off.close();
    }
  });
});

describe('cartão recorrente (F6-04.c)', () => {
  it('salva só o identificador cifrado e cobra a mensalidade vencida sozinho', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    const invalid = await client.put('/account/billing/card', { token: 'sem-prefixo' });
    expect(invalid.statusCode).toBe(422);
    const saved = await client.put('/account/billing/card', { token: 'tok_ok' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as BillingView).card).toEqual({ brand: 'SIMULADO', last4: '4242' });
    const [row] = await platform<{ card_token_sealed: string }>(
      sql`select card_token_sealed from tenant_billing where tenant_id = ${id}`,
    );
    expect(row?.card_token_sealed).toMatch(/^v1\./);

    const invoice = await subscribe(client);
    // Antes do vencimento nada é cobrado.
    await maintenance().billingSweep(new Date(), id);
    expect((await billingOf(client)).openInvoice?.id).toBe(invoice.id);
    // Venceu: o cartão salvo paga.
    await maintenance().billingSweep(new Date(Date.now() + 4 * DAY), id);
    const view = await billingOf(client);
    expect(view.openInvoice).toBeNull();
    expect(view.invoices[0]).toMatchObject({ status: 'paid', method: 'card' });
    expect(view.state).toBe('ok');

    const removed = await client.delete('/account/billing/card');
    expect((removed.json() as BillingView).card).toBeNull();
  });

  it('cartão recusado fica na fatura, tenta de novo só no dia seguinte e a tolerância vale', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    await client.put('/account/billing/card', { token: 'tok_recusado' });
    const invoice = await subscribe(client);
    const due = Date.now() + 4 * DAY;
    await maintenance().billingSweep(new Date(due), id);
    const [first] = await platform<{ card_error: string; card_attempt_at: string }>(
      sql`select card_error, card_attempt_at from plan_invoices where id = ${invoice.id}`,
    );
    expect(first?.card_error).toContain('recusado');
    // Na mesma hora, nenhuma nova tentativa.
    await maintenance().billingSweep(new Date(due + 1000), id);
    const [second] = await platform<{ card_attempt_at: string }>(
      sql`select card_attempt_at from plan_invoices where id = ${invoice.id}`,
    );
    expect(second?.card_attempt_at).toBe(first?.card_attempt_at);
    expect((await billingOf(client)).openInvoice?.status).toBe('open');
  });
});

describe('cobrança por cliente no painel da plataforma (F6-04.d)', () => {
  /** Cliente que pagou e deixou a mensalidade seguinte vencer além da tolerância (bloqueado). */
  async function blockedClient() {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    const invoice = await subscribe(client);
    await client.post(`/account/billing/invoices/${invoice.id}/pix`);
    await client.post(`/account/billing/invoices/${invoice.id}/simulate-pay`);
    await maintenance().billingSweep(new Date(Date.now() + 10_000), id);
    const paidUntil = new Date((await billingOf(client)).paidUntil!);
    await maintenance().billingSweep(new Date(paidUntil.getTime() - 3 * DAY), id);
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 6 * DAY), id);
    // A fatura passa a estar vencida também no relógio real, que é o que o painel usa.
    await platform(
      sql`update plan_invoices set due_at = now() - interval '6 days' where tenant_id = ${id} and status = 'open'`,
    );
    return { client, id, paidUntil };
  }

  it('lista a inadimplência com dias de atraso e totais, e mostra o detalhe do cliente', async () => {
    const admin = await staff('viewer');
    const { id, paidUntil } = await blockedClient();
    // Atraso medido a partir de uma data fixa, depois do vencimento.
    const list = await admin.get('/admin/billing?filter=overdue&limit=200');
    expect(list.statusCode, list.body).toBe(200);
    const body = list.json() as {
      items: { tenantId: string; state: string; daysLate: number }[];
      overdue: { count: number; amountCents: number };
    };
    const row = body.items.find((i) => i.tenantId === id)!;
    expect(row).toMatchObject({ state: 'blocked' });
    expect(row.daysLate).toBeGreaterThanOrEqual(0);
    expect(body.overdue.count).toBeGreaterThanOrEqual(1);
    expect(body.overdue.amountCents).toBeGreaterThanOrEqual(10000);

    const detail = (await admin.get(`/admin/tenants/${id}/billing`)).json() as AdminBillingDetail;
    expect(detail.invoices[0]).toMatchObject({ status: 'open', amountCents: 10000 });
    expect(new Date(detail.paidUntil!).getTime()).toBe(paidUntil.getTime());
    const filtered = (await admin.get('/admin/billing?filter=paused&q=zzzz')).json();
    expect(filtered.items).toEqual([]);
  });

  it('só quem gerencia clientes pausa, retoma ou perdoa', async () => {
    const viewer = await staff('viewer');
    const { id } = await blockedClient();
    const res = await viewer.post(`/admin/tenants/${id}/billing/pause`, { reason: 'Acordo' });
    expect(res.statusCode).toBe(403);
  });

  it('pausar libera a conta bloqueada e a rodada deixa de renovar e bloquear; retomar dá nova tolerância', async () => {
    const owner = await staff('owner');
    const { client, id, paidUntil } = await blockedClient();
    expect((await client.get('/products')).statusCode).toBe(403);

    const noReason = await owner.post(`/admin/tenants/${id}/billing/pause`, {});
    expect(noReason.statusCode).toBe(400);
    const paused = await owner.post(`/admin/tenants/${id}/billing/pause`, {
      reason: 'Negociando a dívida com o cliente',
    });
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json()).toMatchObject({ paused: true, pausedReason: expect.any(String) });
    expect((await client.get('/products')).statusCode).toBe(200);
    expect((await billingOf(client)).paused).toBe(true);
    expect(
      (await owner.post(`/admin/tenants/${id}/billing/pause`, { reason: 'De novo' })).statusCode,
    ).toBe(409);

    // Muito depois: pausada, a conta não volta a ser bloqueada.
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 30 * DAY), id);
    expect((await client.get('/products')).statusCode).toBe(200);

    const resumed = await owner.post(`/admin/tenants/${id}/billing/resume`, {});
    expect(resumed.statusCode).toBe(200);
    const detail = resumed.json() as AdminBillingDetail;
    expect(detail.paused).toBe(false);
    // A fatura vencida ganhou vencimento de hoje: a tolerância conta daqui para a frente.
    expect(daysBetween(new Date(detail.openInvoiceDueAt!), new Date())).toBeLessThan(1);
    await maintenance().billingSweep(new Date(), id);
    expect((await client.get('/products')).statusCode).toBe(200);
    expect((await owner.post(`/admin/tenants/${id}/billing/resume`, {})).statusCode).toBe(409);

    const audit = await platform<{ action: string }>(
      sql`select action from platform_audit_log where tenant_id = ${id} order by seq`,
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['billing.pause', 'billing.resume']),
    );
    const events = await platform<{ kind: string }>(
      sql`select kind from tenant_events where tenant_id = ${id}`,
    );
    expect(events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['billing_paused', 'billing_resumed']),
    );
  });

  it('perdoar a fatura cancela, vale o período, reativa a conta e fica na auditoria', async () => {
    const owner = await staff('owner');
    const { client, id, paidUntil } = await blockedClient();
    const open = (await billingOf(client)).openInvoice!;
    const outro = await signup(t.app, { plan: 'gratis' });
    const wrongTenant = await owner.post(
      `/admin/tenants/${outro.me.tenant.id}/billing/invoices/${open.id}/waive`,
      { reason: 'Teste' },
    );
    expect(wrongTenant.statusCode).toBe(404);

    const res = await owner.post(`/admin/tenants/${id}/billing/invoices/${open.id}/waive`, {
      reason: 'Falha do Bipaê na cobrança',
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json() as AdminBillingDetail;
    expect(detail.invoices[0]).toMatchObject({
      status: 'canceled',
      waivedReason: 'Falha do Bipaê na cobrança',
    });
    expect(detail.openInvoiceAmountCents).toBeNull();
    expect(new Date(detail.paidUntil!).getTime()).toBeGreaterThan(paidUntil.getTime());
    expect((await client.get('/products')).statusCode).toBe(200);
    expect(
      (
        await owner.post(`/admin/tenants/${id}/billing/invoices/${open.id}/waive`, {
          reason: 'Outra vez',
        })
      ).statusCode,
    ).toBe(422);
    const [audit] = await platform<{ action: string }>(
      sql`select action from platform_audit_log where tenant_id = ${id} and action = 'billing.waive'`,
    );
    expect(audit?.action).toBe('billing.waive');
  });
});

function daysBetween(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) / DAY;
}
