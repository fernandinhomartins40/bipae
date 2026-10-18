import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService, type MailMessage } from '../src/modules/mail/mail.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** P-04.b: recuperar senha por e-mail, com link de uso único. */

let t: TestApp;
const sent: (MailMessage & { from: string })[] = [];

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ligarEmail = () =>
  Object.assign(t.app.get(MailService), {
    transport: { send: async (m: MailMessage & { from: string }) => void sent.push(m) },
  });
const desligarEmail = () => Object.assign(t.app.get(MailService), { transport: null });

async function esperarEmail(to: string, subject = 'Bipaê: crie uma senha nova') {
  for (let i = 0; i < 50; i++) {
    const found = sent.find((m) => m.to === to && m.subject === subject);
    if (found) return found;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error('O e-mail não chegou.');
}

describe('recuperar senha (P-04.b)', () => {
  it('sem o provedor de e-mail, a saúde diz e a rota explica', async () => {
    desligarEmail();
    const anon = api(t.app, {});
    expect((await anon.get('/health')).json().features).toEqual({ email: false });
    const r = await anon.post('/auth/password/forgot', { email: 'alguem@exemplo.com.br' });
    expect(r.statusCode).toBe(503);
    expect(r.json().message).toContain('ainda não está ligado');
  });

  it('o link chega, cria a senha nova uma vez só e derruba as sessões antigas', async () => {
    ligarEmail();
    const dono = await signup(t.app);
    const anon = api(t.app, {});
    expect((await anon.get('/health')).json().features).toEqual({ email: true });
    const email = dono.me.user.email as string;

    // E-mail sem conta: a mesma resposta, e nada é enviado.
    const nada = await anon.post('/auth/password/forgot', { email: 'ninguem@exemplo.com.br' });
    expect(nada.statusCode).toBe(202);
    const pedido = await anon.post('/auth/password/forgot', { email: email.toUpperCase() });
    expect(pedido.statusCode).toBe(202);
    expect(pedido.json().message).toBe(nada.json().message);

    const mensagem = await esperarEmail(email);
    expect(mensagem.subject).toBe('Bipaê: crie uma senha nova');
    expect(mensagem.text).toContain('vale por 1 hora');
    const token = /codigo=([\w-]+)/.exec(mensagem.text)![1]!;
    expect(sent.some((m) => m.to === 'ninguem@exemplo.com.br')).toBe(false);

    const curta = await anon.post('/auth/password/reset', { token, password: '123' });
    expect(curta.statusCode).toBe(400);
    const trocada = await anon.post('/auth/password/reset', {
      token,
      password: 'senha-nova-forte-1',
    });
    expect(trocada.statusCode).toBe(200);
    // A sessão antiga caiu; a senha antiga não entra mais; a nova entra.
    const refresh = await anon.post('/auth/refresh', { refreshToken: dono.refreshToken });
    expect(refresh.statusCode).toBe(401);
    expect(
      (await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode,
    ).toBe(401);
    expect(
      (await anon.post('/auth/login', { email, password: 'senha-nova-forte-1' })).statusCode,
    ).toBe(200);
    // O link é de uso único.
    const deNovo = await anon.post('/auth/password/reset', {
      token,
      password: 'outra-senha-forte',
    });
    expect(deNovo.statusCode).toBe(400);
    expect(deNovo.json().message).toContain('expirou ou já foi usado');
  });

  it('um pedido novo invalida o link anterior', async () => {
    ligarEmail();
    const dono = await signup(t.app);
    const anon = api(t.app, {});
    const email = dono.me.user.email as string;
    await anon.post('/auth/password/forgot', { email });
    const primeiro = /codigo=([\w-]+)/.exec((await esperarEmail(email)).text)![1]!;
    sent.length = 0;
    await anon.post('/auth/password/forgot', { email });
    const segundo = /codigo=([\w-]+)/.exec((await esperarEmail(email)).text)![1]!;
    expect(
      (await anon.post('/auth/password/reset', { token: primeiro, password: 'senha-nova-forte-1' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await anon.post('/auth/password/reset', { token: segundo, password: 'senha-nova-forte-1' }))
        .statusCode,
    ).toBe(200);
  });
});

describe('confirmar o e-mail da conta (P-04.c)', () => {
  it('o cadastro manda o link; confirmar muda o Me; o link é de uso único', async () => {
    ligarEmail();
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    expect((dono.me.user as { emailVerified?: boolean }).emailVerified).toBe(false);
    const mensagem = await esperarEmail(email, 'Bipaê: confirme o seu e-mail');
    const token = /confirmar-email\?codigo=([\w-]+)/.exec(mensagem.text)![1]!;
    const anon = api(t.app, {});
    const ok = await anon.post('/auth/email/verify', { token });
    expect(ok.statusCode).toBe(200);
    const me = (await api(t.app, dono.auth).get('/auth/me')).json();
    expect(me.user.emailVerified).toBe(true);
    expect((await anon.post('/auth/email/verify', { token })).statusCode).toBe(400);
    const reenviar = await api(t.app, dono.auth).post('/auth/email/resend');
    expect(reenviar.json().message).toBe('Este e-mail já está confirmado.');
  });

  it('reenviar o link; sem e-mail ligado o cadastro segue e o reenvio explica', async () => {
    ligarEmail();
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    await esperarEmail(email, 'Bipaê: confirme o seu e-mail');
    const antes = sent.filter((m) => m.to === email).length;
    const reenviar = await api(t.app, dono.auth).post('/auth/email/resend');
    expect(reenviar.statusCode).toBe(202);
    expect(reenviar.json().message).toContain(email);
    for (let i = 0; i < 50 && sent.filter((m) => m.to === email).length === antes; i++) {
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(sent.filter((m) => m.to === email).length).toBe(antes + 1);

    desligarEmail();
    const sem = await signup(t.app);
    expect(sent.some((m) => m.to === sem.me.user.email)).toBe(false);
    expect((await api(t.app, sem.auth).post('/auth/email/resend')).statusCode).toBe(503);
  });
});

describe('avisos da conta por e-mail (P-04.d)', () => {
  it('teste terminando avisa uma vez; suspensão avisa uma vez por suspensão', async () => {
    const { MaintenanceService } = await import('../src/modules/maintenance/maintenance.service');
    const { sql } = await import('drizzle-orm');
    const maintenance = t.app.get(MaintenanceService);
    desligarEmail();
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    // Como o painel do Bipaê faria (o aplicativo não muda a situação da conta).
    const set = (q: ReturnType<typeof sql>) => t.database.db.execute(q);
    await set(
      sql`update tenants set status = 'trial', trial_ends_at = now() + interval '2 days' where id = ${ctx.tenantId}`,
    );
    // Sem e-mail ligado, nada sai e nada é marcado.
    expect(await maintenance.accountNotices()).toBe(0);
    ligarEmail();
    expect(await maintenance.accountNotices()).toBeGreaterThanOrEqual(1);
    const fim = await esperarEmail(email, 'Bipaê: o seu teste termina em breve');
    expect(fim.text).toContain('Assinatura');
    const antes = sent.filter((m) => m.to === email).length;
    await maintenance.accountNotices();
    await new Promise((ok) => setTimeout(ok, 100));
    expect(sent.filter((m) => m.to === email).length).toBe(antes);

    await set(
      sql`update tenants set status = 'suspended', status_reason = 'pagamento em atraso', status_changed_at = now() where id = ${ctx.tenantId}`,
    );
    await maintenance.accountNotices();
    const suspensa = await esperarEmail(email, 'Bipaê: a sua conta foi suspensa');
    expect(suspensa.text).toContain('pagamento em atraso');
    const depois = sent.filter(
      (m) => m.subject === 'Bipaê: a sua conta foi suspensa' && m.to === email,
    ).length;
    await maintenance.accountNotices();
    await new Promise((ok) => setTimeout(ok, 100));
    expect(
      sent.filter((m) => m.subject === 'Bipaê: a sua conta foi suspensa' && m.to === email).length,
    ).toBe(depois);
    // Uma suspensão nova (depois de reativada) avisa de novo.
    await set(
      sql`update tenants set status_changed_at = now() + interval '1 second' where id = ${ctx.tenantId}`,
    );
    await maintenance.accountNotices();
    for (
      let i = 0;
      i < 50 &&
      sent.filter((m) => m.subject === 'Bipaê: a sua conta foi suspensa' && m.to === email)
        .length === depois;
      i++
    ) {
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(
      sent.filter((m) => m.subject === 'Bipaê: a sua conta foi suspensa' && m.to === email).length,
    ).toBe(depois + 1);
  });
});
