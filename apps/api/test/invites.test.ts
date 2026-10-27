import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTotp } from '../src/common/totp';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F1-06: convite de equipe por link, de uso único e com validade. */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const SENHA = 'senha-forte-123';

async function empresaComConvite(dados: Record<string, unknown> = {}) {
  const dono = await signup(t.app);
  const cliente = api(t.app, dono.auth);
  const papeis = (await cliente.get('/roles')).json() as {
    id: string;
    systemKey: string;
    name: string;
  }[];
  const caixa = papeis.find((p) => p.systemKey === 'cashier')!;
  const res = await cliente.post('/invites', { roleId: caixa.id, ...dados });
  expect(res.statusCode).toBe(201);
  return {
    dono,
    cliente,
    papeis,
    caixa,
    convite: res.json() as { id: string; token: string; path: string },
  };
}

const info = (token: string) => t.app.inject({ method: 'GET', url: `/v1/auth/invites/${token}` });
const aceitar = (token: string, payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: `/v1/auth/invites/${token}/accept`, payload });

describe('convite por link (F1-06)', () => {
  it('pessoa nova abre o link, cria a conta e entra com o papel do convite', async () => {
    const { dono, cliente, convite } = await empresaComConvite();
    expect(convite.path).toBe(`/convite/${convite.token}`);

    const visto = await info(convite.token);
    expect(visto.statusCode).toBe(200);
    expect(visto.json()).toMatchObject({ roleName: 'Operador de caixa', status: 'valid' });

    const email = `nova-${Date.now()}@exemplo.com.br`;
    const res = await aceitar(convite.token, { name: 'Nina Nova', email, password: SENHA });
    expect(res.statusCode).toBe(200);
    expect(res.json().me.tenant.id).toBe(dono.me.tenant.id);
    expect(res.json().me.permissions).toContain('pos.sell');
    expect(res.json().me.permissions).not.toContain('admin.users');

    // Uso único.
    expect((await info(convite.token)).json().status).toBe('used');
    const outra = await aceitar(convite.token, {
      name: 'Outra',
      email: `x-${Date.now()}@exemplo.com.br`,
      password: SENHA,
    });
    expect(outra.statusCode).toBe(410);
    expect(outra.json().message).toBe('Este convite já foi usado.');

    const auditoria = (await cliente.get('/audit')).json() as { items: { action: string }[] };
    expect(auditoria.items.map((i) => i.action)).toEqual(
      expect.arrayContaining(['invite.created', 'invite.accepted']),
    );
  });

  it('quem já tem conta aceita com a própria senha (e o código, se usar verificação em duas etapas)', async () => {
    const outraEmpresa = await signup(t.app);
    const email = outraEmpresa.me.user.email;
    const minha = api(t.app, outraEmpresa.auth);
    const { secret } = (await minha.post('/auth/totp/setup')).json();
    await minha.post('/auth/totp/enable', { code: currentTotp(secret) });

    const { dono, convite } = await empresaComConvite();
    expect((await aceitar(convite.token, { email, password: 'errada-123' })).statusCode).toBe(401);
    const semCodigo = await aceitar(convite.token, { email, password: SENHA });
    expect(semCodigo.json().code).toBe('totp_required');
    const ok = await aceitar(convite.token, { email, password: SENHA, totp: currentTotp(secret) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().me.tenant.id).toBe(dono.me.tenant.id);
    expect(ok.json().me.tenants).toHaveLength(2);
  });

  it('convite para um e-mail certo, com lojas, revogado ou vencido', async () => {
    const { cliente, caixa, convite } = await empresaComConvite({ email: 'certa@exemplo.com.br' });
    const errado = await aceitar(convite.token, {
      name: 'Intruso',
      email: 'outro@exemplo.com.br',
      password: SENHA,
    });
    expect(errado.statusCode).toBe(403);
    expect(errado.json().message).toBe('Este convite é para outro e-mail.');

    // Lojas do convite vão para a pessoa.
    const loja = (await cliente.get('/stores')).json()[0];
    const comLoja = (
      await cliente.post('/invites', { roleId: caixa.id, storeIds: [loja.id] })
    ).json();
    const email = `loja-${Date.now()}@exemplo.com.br`;
    expect(
      (await aceitar(comLoja.token, { name: 'Lia Loja', email, password: SENHA })).statusCode,
    ).toBe(200);
    const membros = (await cliente.get('/members')).json() as {
      email: string;
      storeIds: string[] | null;
    }[];
    expect(membros.find((m) => m.email === email)!.storeIds).toEqual([loja.id]);

    // Revogado.
    const revogar = (await cliente.post('/invites', { roleId: caixa.id })).json();
    expect(
      (await cliente.get('/invites')).json().some((i: { id: string }) => i.id === revogar.id),
    ).toBe(true);
    expect((await cliente.post(`/invites/${revogar.id}/revoke`)).statusCode).toBe(200);
    expect(
      (await cliente.get('/invites')).json().some((i: { id: string }) => i.id === revogar.id),
    ).toBe(false);
    const cancelado = await aceitar(revogar.token, {
      name: 'Tarde',
      email: `t-${Date.now()}@exemplo.com.br`,
      password: SENHA,
    });
    expect(cancelado.json().message).toBe('Este convite foi cancelado.');

    // Link inventado.
    expect((await info('nao-existe.abc')).statusCode).toBe(404);
  });

  it('não dá para convidar como Dono, e só quem gerencia a equipe convida', async () => {
    const { cliente, papeis } = await empresaComConvite();
    const dono = papeis.find((p) => p.systemKey === 'owner')!;
    const res = await cliente.post('/invites', { roleId: dono.id });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('O papel de Dono não pode ser dado por convite.');
  });

  it('o convite não serve para adivinhar a senha de outra pessoa: trava como o login (PIE R1-02)', async () => {
    const vitima = await signup(t.app);
    const email = vitima.me.user.email;
    const { convite } = await empresaComConvite();
    for (let i = 0; i < 10; i++) {
      expect((await aceitar(convite.token, { email, password: `chute-${i}-abc` })).statusCode).toBe(
        401,
      );
    }
    // A 11ª tentativa é barrada antes de conferir a senha, mesmo com a senha certa.
    const travado = await aceitar(convite.token, { email, password: SENHA });
    expect(travado.statusCode).toBe(429);
    expect((await info(convite.token)).json().status).toBe('valid');
  });
});
