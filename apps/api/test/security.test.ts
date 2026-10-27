import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { TokenService } from '../src/common/tokens';
import { isPrivateAddress } from '../src/modules/public-api/webhooks.service';
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
    expect(
      (await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode,
    ).toBe(200);
    for (let i = 0; i < 9; i++) await anon.post('/auth/login', { email, password: 'errada-123' });
    expect(
      (await anon.post('/auth/login', { email, password: 'senha-forte-123' })).statusCode,
    ).toBe(200);
  });

  it('respostas da API não ficam em cache', async () => {
    const dono = await signup(t.app);
    const me = await api(t.app, dono.auth).get('/auth/me');
    expect(me.headers['cache-control']).toBe('no-store');
    const erro = await api(t.app, {}).get('/auth/me');
    expect(erro.headers['cache-control']).toBe('no-store');
  });
});

describe('revisão de segurança (F7-02.c)', () => {
  it('autorização de supervisor e troca de operador travam o e-mail como o login', async () => {
    const dono = await signup(t.app);
    const email = dono.me.user.email as string;
    const caixa = api(t.app, dono.auth);
    for (let i = 0; i < 10; i++) {
      const r = await caixa.post('/auth/authorize', {
        email,
        password: 'errada-123',
        permission: 'pos.sale.cancel',
      });
      expect(r.statusCode).toBe(422);
    }
    const travado = await caixa.post('/auth/operator', { email, password: 'senha-forte-123' });
    expect(travado.statusCode).toBe(429);
    // O login do mesmo e-mail também fica travado: o contador é um só.
    const login = await api(t.app, {}).post('/auth/login', { email, password: 'senha-forte-123' });
    expect(login.statusCode).toBe(429);
  });

  it('código errado de 2FA ao desligar também trava depois de 10 erros', async () => {
    const dono = await signup(t.app);
    const caixa = api(t.app, dono.auth);
    await caixa.post('/auth/totp/setup');
    for (let i = 0; i < 10; i++) {
      expect((await caixa.post('/auth/totp/enable', { code: '000000' })).statusCode).toBe(422);
    }
    expect((await caixa.post('/auth/totp/enable', { code: '000000' })).statusCode).toBe(429);
  });

  it('sessão de suporte não troca de empresa (viraria sessão comum, sem marca nem leitura só)', async () => {
    const cliente = await signup(t.app);
    const token = await t.app.get(TokenService).signAccess({
      sub: cliente.me.user.id,
      tid: cliente.me.tenant.id,
      imp: cliente.me.user.id,
    });
    const suporte = api(t.app, { authorization: `Bearer ${token}` });
    const troca = await suporte.post('/auth/switch-tenant', { tenantId: cliente.me.tenant.id });
    expect(troca.statusCode).toBe(403);
    // Quem não é suporte continua trocando.
    const normal = await api(t.app, cliente.auth).post('/auth/switch-tenant', {
      tenantId: cliente.me.tenant.id,
    });
    expect(normal.statusCode).toBe(200);
  });

  it('endereços internos escritos em IPv6 com IPv4 embutido são recusados nos webhooks (SSRF)', () => {
    for (const ip of [
      '::ffff:7f00:1',
      '::ffff:a00:1',
      '::ffff:c0a8:101',
      '::ffff:a9fe:a9fe',
      '0:0:0:0:0:ffff:7f00:1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '::127.0.0.1',
      'fe90::1',
      'febf::1',
      'ff02::1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '192.0.0.8',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['::ffff:808:808', '2001:4860:4860::8888', '64:ff9b::808:808', '8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('configuração em produção (F7-02.c)', () => {
  it('não deixa desligar o 2FA da equipe nem usar o segredo de desenvolvimento', () => {
    const base = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) };
    expect(() => loadConfig({ ...base, PLATFORM_REQUIRE_TOTP: 'false' })).toThrow(/2FA|TOTP/);
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(loadConfig(base).PLATFORM_REQUIRE_TOTP).toBe(true);
    expect(
      loadConfig({ NODE_ENV: 'test', PLATFORM_REQUIRE_TOTP: 'false' }).PLATFORM_REQUIRE_TOTP,
    ).toBe(false);
  });
});
