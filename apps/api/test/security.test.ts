import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F7-02: correções da revisão OWASP ASVS nível 2. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const novaConta = (email: string, password: string, ownerName = 'Rosa Dona') =>
  api(t.app, {}).post('/auth/signup', {
    ownerName,
    businessName: 'Loja da Rosa',
    email,
    password,
  });

describe('revisão de segurança (F7-02)', () => {
  it('o cadastro recusa senha comum ou que repete o e-mail ou o nome', async () => {
    const comum = await novaConta(`rosa-${Date.now()}@exemplo.com.br`, 'senha123');
    expect(comum.statusCode).toBe(400);
    expect(comum.json().message).toContain('muito comum');
    const email = `rosamaria${Date.now()}@exemplo.com.br`;
    const igual = await novaConta(email, `${email.split('@')[0]}!`);
    expect(igual.statusCode).toBe(400);
    expect(igual.json().message).toContain('e-mail');
    const nome = await novaConta(`r-${Date.now()}@exemplo.com.br`, 'rosa1234');
    expect(nome.statusCode).toBe(400);
    expect((await novaConta(`r2-${Date.now()}@exemplo.com.br`, 'cafe com pao')).statusCode).toBe(
      201,
    );
  });

  it('10 senhas erradas seguidas travam o e-mail por 15 minutos, mesmo com a senha certa', async () => {
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    const anon = api(t.app, {});
    for (let i = 0; i < 10; i++) {
      expect((await anon.post('/auth/login', { email, password: 'errada-123' })).statusCode).toBe(
        401,
      );
    }
    const travado = await anon.post('/auth/login', { email, password: 'senha-forte-123' });
    expect(travado.statusCode).toBe(429);
    expect(travado.json().message).toContain('Esqueci a senha');
    // E-mail sem conta trava do mesmo jeito (não revela quem é cliente).
    const fantasma = `ninguem-${Date.now()}@exemplo.com.br`;
    for (let i = 0; i < 10; i++) await anon.post('/auth/login', { email: fantasma, password: 'x' });
    expect((await anon.post('/auth/login', { email: fantasma, password: 'x' })).statusCode).toBe(
      429,
    );
    // Outra conta continua entrando normalmente.
    const outra = await signup(t.app);
    expect(
      (
        await anon.post('/auth/login', {
          email: outra.me.user.email,
          password: 'senha-forte-123',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('acerto zera as tentativas erradas', async () => {
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    const anon = api(t.app, {});
    for (let i = 0; i < 9; i++) await anon.post('/auth/login', { email, password: 'errada-123' });
    expect((await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode).toBe(
      200,
    );
    for (let i = 0; i < 9; i++) await anon.post('/auth/login', { email, password: 'errada-123' });
    expect((await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode).toBe(
      200,
    );
  });

  it('respostas da API não ficam em cache', async () => {
    const dono = await signup(t.app);
    const me = await api(t.app, dono.auth).get('/auth/me');
    expect(me.headers['cache-control']).toBe('no-store');
    const erro = await api(t.app, {}).get('/auth/me');
    expect(erro.headers['cache-control']).toBe('no-store');
  });
});
