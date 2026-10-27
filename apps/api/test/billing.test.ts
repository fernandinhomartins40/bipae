import type { BillingView, InvoiceView } from '@bipae/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/common/di';
import { asPlatform, type Db } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { BillingGatewayHolder } from '../src/modules/billing/billing-gateway';
import { MailService, type MailMessage } from '../src/modules/mail/mail.service';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F6-04: cobrança automática dos planos, contra o meio de pagamento simulado. Os preços abaixo são
 * só de teste: os valores reais dos planos (item E8) ainda não foram decididos.
 */

let t: TestApp;
const DAY = 86_400_000;

beforeAll(async () => {
  t = await createTestApp({ BILLING_PROVIDER: 'simulator' });
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

async function tenantRow(id: string) {
  const [row] = await platform<{ plan_id: string; status: string; status_reason: string | null }>(
    sql`select plan_id, status, status_reason from tenants where id = ${id}`,
  );
  return row!;
}

const billingOf = async (client: ReturnType<typeof api>) =>
  (await client.get('/account/billing')).json() as BillingView;

/** Assina o plano, gera o Pix, "paga" pelo simulador e deixa a manutenção confirmar. */
async function assinarEPagar(
  client: ReturnType<typeof api>,
  tenantId: string,
  planId: string,
  now = new Date(Date.now() + 10_000),
) {
  const res = await client.post('/account/billing/subscribe', { planId });
  expect(res.statusCode, res.body).toBe(201);
  const invoice = (res.json() as { invoice: InvoiceView }).invoice;
  const pix = await client.post(`/account/billing/invoices/${invoice.id}/pix`);
  expect(pix.statusCode, pix.body).toBe(201);
  expect((pix.json() as InvoiceView).copyPaste).toContain('SIMULADOR-PIX');
  expect(
    (await client.post(`/account/billing/invoices/${invoice.id}/simulate-pay`)).statusCode,
  ).toBe(201);
  await maintenance().billingSweep(now, tenantId);
  return invoice;
}

describe('cobrança automática dos planos (F6-04)', () => {
  it('não vende plano sem preço definido: nunca inventa valor', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    await asPlatform(t.app.get<Db>(DB), (tx) =>
      tx.execute(sql`update plans set price_cents = null where id = 'rede'`),
    );
    const res = await client.post('/account/billing/subscribe', { planId: 'rede' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('plan_without_price');
    const view = await billingOf(client);
    expect(view.gateway.mode).toBe('simulator');
    expect(view.gateway.cardAvailable).toBe(false);
    expect(view.state).toBe('none');
  });

  it('assina, paga por Pix e o plano muda só depois da confirmação', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    const res = await client.post('/account/billing/subscribe', { planId: 'essencial' });
    const invoice = (res.json() as { invoice: InvoiceView }).invoice;
    expect(invoice).toMatchObject({ kind: 'subscription', amountCents: 10000, status: 'open' });
    await client.post(`/account/billing/invoices/${invoice.id}/pix`);

    await maintenance().billingSweep(new Date(), id);
    expect((await tenantRow(id)).plan_id).toBe('gratis');

    await client.post(`/account/billing/invoices/${invoice.id}/simulate-pay`);
    await maintenance().billingSweep(new Date(Date.now() + 10_000), id);
    // Repetir a rodada não estraga nada.
    await maintenance().billingSweep(new Date(Date.now() + 20_000), id);

    expect(await tenantRow(id)).toMatchObject({ plan_id: 'essencial', status: 'active' });
    const view = await billingOf(client);
    expect(view.state).toBe('ok');
    expect(view.paidUntil).not.toBeNull();
    expect(view.invoices[0]).toMatchObject({ status: 'paid' });
    const events = await platform<{ kind: string }>(
      sql`select kind from tenant_events where tenant_id = ${id}`,
    );
    expect(events.map((e) => e.kind)).toContain('billing_paid');
  });

  it('sobe de plano pagando só a diferença proporcional e desce no fim do período', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    await assinarEPagar(client, id, 'essencial');

    const up = (
      await client.post('/account/billing/subscribe', { planId: 'profissional' })
    ).json() as {
      invoice: InvoiceView;
    };
    expect(up.invoice.kind).toBe('upgrade');
    // Diferença de 20000 centavos, proporcional ao que falta (quase o mês inteiro).
    expect(up.invoice.amountCents).toBeGreaterThan(19000);
    expect(up.invoice.amountCents).toBeLessThanOrEqual(20000);
    await client.post(`/account/billing/invoices/${up.invoice.id}/pix`);
    await client.post(`/account/billing/invoices/${up.invoice.id}/simulate-pay`);
    await maintenance().billingSweep(new Date(Date.now() + 20_000), id);
    expect((await tenantRow(id)).plan_id).toBe('profissional');

    // Descer para o grátis fica agendado e não muda o plano agora.
    const down = await client.post('/account/billing/subscribe', { planId: 'gratis' });
    expect(down.statusCode, down.body).toBe(201);
    const view = (down.json() as { billing: BillingView }).billing;
    expect(view.pendingPlan?.id).toBe('gratis');
    expect((await tenantRow(id)).plan_id).toBe('profissional');

    const paidUntil = new Date(view.paidUntil!);
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 1000), id);
    expect((await tenantRow(id)).plan_id).toBe('gratis');
    const after = await billingOf(client);
    expect(after.paidUntil).toBeNull();
    expect(after.pendingPlan).toBeNull();
  });

  it('recusa descer para um plano que não comporta o uso atual', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    await assinarEPagar(client, dono.me.tenant.id, 'profissional');
    await asPlatform(t.app.get<Db>(DB), (tx) =>
      tx.execute(
        sql`update plans set limits = limits || '{"users": 0}'::jsonb where id = 'essencial'`,
      ),
    );
    const res = await client.post('/account/billing/subscribe', { planId: 'essencial' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('plan_too_small');
    await asPlatform(t.app.get<Db>(DB), (tx) =>
      tx.execute(
        sql`update plans set limits = limits || '{"users": 5}'::jsonb where id = 'essencial'`,
      ),
    );
  });

  it('renova: fatura antes do fim, tolerância, bloqueio gentil e reativação ao pagar', async () => {
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    await assinarEPagar(client, id, 'essencial');
    const paidUntil = new Date((await billingOf(client)).paidUntil!);

    // Longe do fim: nenhuma fatura nova.
    await maintenance().billingSweep(new Date(paidUntil.getTime() - 20 * DAY), id);
    expect((await billingOf(client)).openInvoice).toBeNull();

    // Três dias antes (dentro dos 7 de antecedência): sai a fatura, com o preço atual do plano.
    await maintenance().billingSweep(new Date(paidUntil.getTime() - 3 * DAY), id);
    const open = (await billingOf(client)).openInvoice!;
    expect(open).toMatchObject({ kind: 'subscription', amountCents: 10000, status: 'open' });
    expect(new Date(open.dueAt).getTime()).toBe(paidUntil.getTime());

    // Venceu, dentro da tolerância: tudo funciona.
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 2 * DAY), id);
    expect((await tenantRow(id)).status).toBe('active');

    // Passou da tolerância: bloqueio gentil. A retaguarda trava, a assinatura continua aberta.
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 6 * DAY), id);
    expect(await tenantRow(id)).toMatchObject({
      status: 'suspended',
      status_reason: 'Mensalidade em aberto',
    });
    expect((await client.get('/products')).statusCode).toBe(403);
    expect((await billingOf(client)).openInvoice?.id).toBe(open.id);

    // Trocar de plano com a conta pausada exige pagar antes.
    const swap = await client.post('/account/billing/subscribe', { planId: 'profissional' });
    expect(swap.statusCode).toBe(422);

    await client.post(`/account/billing/invoices/${open.id}/pix`);
    await client.post(`/account/billing/invoices/${open.id}/simulate-pay`);
    await maintenance().billingSweep(new Date(paidUntil.getTime() + 6 * DAY + 10_000), id);
    expect(await tenantRow(id)).toMatchObject({ status: 'active', status_reason: null });
    expect((await client.get('/products')).statusCode).toBe(200);
    const view = await billingOf(client);
    expect(view.state).toBe('ok');
    expect(new Date(view.paidUntil!).getTime()).toBeGreaterThan(paidUntil.getTime());
  });

  it('um cliente não vê nem paga a fatura do outro', async () => {
    const a = await signup(t.app, { plan: 'gratis' });
    const b = await signup(t.app, { plan: 'gratis' });
    const res = await api(t.app, a.auth).post('/account/billing/subscribe', {
      planId: 'essencial',
    });
    const invoice = (res.json() as { invoice: InvoiceView }).invoice;
    const other = api(t.app, b.auth);
    expect((await other.post(`/account/billing/invoices/${invoice.id}/pix`)).statusCode).toBe(404);
    expect((await billingOf(other)).invoices).toEqual([]);
  });

  it('avisa por e-mail uma vez por fatura: disponível e pagamento recebido', async () => {
    const sent: MailMessage[] = [];
    Object.assign(t.app.get(MailService), {
      transport: { send: async (m: MailMessage) => void sent.push(m) },
    });
    const dono = await signup(t.app, { plan: 'gratis' });
    const client = api(t.app, dono.auth);
    const id = dono.me.tenant.id;
    await assinarEPagar(client, id, 'essencial');
    const esperar = async (n: number) => {
      for (let i = 0; i < 60 && sent.length < n; i++) await new Promise((ok) => setTimeout(ok, 50));
    };

    // A própria tarefa de cobrança (disparada pelo pagamento) já mandou o recibo.
    await esperar(1);
    expect(sent.some((m) => m.subject.includes('pagamento recebido'))).toBe(true);
    expect(await maintenance().billingNotices()).toBe(0);

    const paidUntil = new Date((await billingOf(client)).paidUntil!);
    const antes = new Date(paidUntil.getTime() - 3 * DAY);
    await maintenance().billingSweep(antes, id);
    const total = sent.length;
    // Faturas abertas de outros testes também saem; o que importa é a desta conta e uma vez só.
    const novos = await maintenance().billingNotices(antes);
    expect(novos).toBeGreaterThan(0);
    await esperar(total + novos);
    expect(sent.some((m) => m.subject.includes('fatura do plano Essencial'))).toBe(true);
    expect(await maintenance().billingNotices(antes)).toBe(0);
    Object.assign(t.app.get(MailService), { transport: null });
  });
});

describe('cobrança dos planos pelo Pix do Mercado Pago (F6-04)', () => {
  it('cria o Pix com o token da conta do Bipaê e só confirma o que o parceiro diz estar aprovado', async () => {
    const mp = await createTestApp({
      BILLING_PROVIDER: 'mercadopago',
      BILLING_TOKEN: 'APP_USR-bipae',
    });
    try {
      await asPlatform(mp.app.get<Db>(DB), (tx) =>
        tx.execute(sql`update plans set price_cents = 10000 where id = 'essencial'`),
      );
      let status = 'pending';
      const requests: { method: string; url: string; auth?: string; body?: string }[] = [];
      mp.app.get(BillingGatewayHolder).transport = {
        async send(req) {
          requests.push({
            method: req.method,
            url: req.url,
            auth: req.headers.Authorization,
            body: req.body,
          });
          return {
            status: req.method === 'POST' ? 201 : 200,
            body: JSON.stringify({
              id: 9001,
              status,
              point_of_interaction: { transaction_data: { qr_code: '000201MP-PIX-DO-BIPAE' } },
            }),
          };
        },
      };
      const dono = await signup(mp.app, { plan: 'gratis' });
      const client = api(mp.app, dono.auth);
      const id = dono.me.tenant.id;
      const invoice = (
        (await client.post('/account/billing/subscribe', { planId: 'essencial' })).json() as {
          invoice: InvoiceView;
        }
      ).invoice;
      const pix = (
        await client.post(`/account/billing/invoices/${invoice.id}/pix`)
      ).json() as InvoiceView;
      expect(pix.copyPaste).toBe('000201MP-PIX-DO-BIPAE');
      expect(requests[0]).toMatchObject({ method: 'POST', auth: 'Bearer APP_USR-bipae' });
      expect(JSON.parse(requests[0]!.body!).transaction_amount).toBe(100);

      // O simulador não existe fora do modo de teste.
      expect(
        (await client.post(`/account/billing/invoices/${invoice.id}/simulate-pay`)).statusCode,
      ).toBe(422);

      const sweep = mp.app.get(MaintenanceService);
      await sweep.billingSweep(new Date(Date.now() + 10_000), id);
      expect((await billingOf(client)).openInvoice?.status).toBe('open');

      status = 'approved';
      await sweep.billingSweep(new Date(Date.now() + 20_000), id);
      expect((await billingOf(client)).state).toBe('ok');
    } finally {
      await mp.close();
    }
  });

  it('sem meio de pagamento configurado, mostra "falta configurar" e não gera Pix', async () => {
    const off = await createTestApp();
    try {
      await asPlatform(off.app.get<Db>(DB), (tx) =>
        tx.execute(sql`update plans set price_cents = 10000 where id = 'essencial'`),
      );
      const dono = await signup(off.app, { plan: 'gratis' });
      const client = api(off.app, dono.auth);
      const view = await billingOf(client);
      expect(view.gateway).toMatchObject({ mode: 'off' });
      const res = await client.post('/account/billing/subscribe', { planId: 'essencial' });
      const invoice = (res.json() as { invoice: InvoiceView }).invoice;
      const pix = await client.post(`/account/billing/invoices/${invoice.id}/pix`);
      expect(pix.statusCode).toBe(422);
      expect(pix.json().code).toBe('billing_not_configured');
    } finally {
      await off.close();
    }
  });
});
