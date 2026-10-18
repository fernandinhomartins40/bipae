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

async function esperarEmail(to: string) {
  for (let i = 0; i < 50; i++) {
    const found = sent.find((m) => m.to === to);
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
    expect((await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode).toBe(
      401,
    );
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
