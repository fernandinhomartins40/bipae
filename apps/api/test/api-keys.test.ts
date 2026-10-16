import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F6-01.a: chaves da API pública (ADR-0016). */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const comChave = (key: string) => api(t.app, { authorization: `Bearer ${key}` });

describe('chaves da API pública (F6-01.a)', () => {
  it('a chave aparece uma vez, só abre rota pública e pode ser revogada', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);

    const criada = await admin.post('/api-keys', {
      name: 'Loja virtual',
      scopes: ['catalog.read', 'catalog.read'],
    });
    expect(criada.statusCode).toBe(201);
    const chave = criada.json();
    expect(chave.key).toMatch(/^bpk_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(chave).toMatchObject({
      name: 'Loja virtual',
      scopes: ['catalog.read'],
      revokedAt: null,
    });
    expect(chave.key.startsWith(chave.prefix.slice(0, 12))).toBe(true);

    // A lista nunca devolve a chave nem o hash.
    const lista = (await admin.get('/api-keys')).json();
    expect(lista).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain(chave.key);
    expect(lista[0]).not.toHaveProperty('key');
    expect(lista[0]).not.toHaveProperty('keyHash');

    // Com a chave: a rota pública responde de quem é e o que ela pode.
    const parceiro = comChave(chave.key);
    const eu = await parceiro.get('/public/me');
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toMatchObject({
      tenantId: dono.me.tenant.id,
      apiKey: { id: chave.id, name: 'Loja virtual' },
      scopes: ['catalog.read'],
    });
    expect((await admin.get('/api-keys')).json()[0].lastUsedAt).not.toBeNull();

    // Rota que não é pública não aceita chave, nem para leitura.
    const interna = await parceiro.get('/products');
    expect(interna.statusCode).toBe(403);
    expect(interna.json().message).toContain('API pública');

    // Chave adulterada, de formato errado ou de outro cliente: 401.
    // Troca o último caractere por outro (nunca o mesmo), para a chave ser de fato diferente.
    const adulterada = `${chave.key.slice(0, -1)}${chave.key.endsWith('A') ? 'B' : 'A'}`;
    expect((await comChave(adulterada).get('/public/me')).statusCode).toBe(401);
    expect((await comChave('bpk_errada').get('/public/me')).statusCode).toBe(401);
    const outro = await signup(t.app);
    const deOutro = chave.key.replace(
      dono.me.tenant.id.replace(/-/g, ''),
      outro.me.tenant.id.replace(/-/g, ''),
    );
    expect((await comChave(deOutro).get('/public/me')).statusCode).toBe(401);

    // Revogada, para na hora.
    const revogada = await admin.post(`/api-keys/${chave.id}/revoke`, {});
    expect(revogada.json().revokedAt).not.toBeNull();
    const depois = await parceiro.get('/public/me');
    expect(depois.statusCode).toBe(401);
    expect(depois.json().message).toBe('Chave de API inválida ou revogada.');

    const auditoria = JSON.stringify((await admin.get('/audit?entity=api_key')).json());
    expect(auditoria).toContain('api_key.created');
    expect(auditoria).toContain('api_key.revoked');
    expect(auditoria).not.toContain(chave.key);
  });

  it('só quem tem a permissão cria, e a chave morre com o acesso de quem a criou', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const entrar = async (key: string) => {
      const email = `${key}-${Date.now()}-${Math.random()}@exemplo.com.br`;
      const membro = (
        await admin.post('/members', {
          name: key,
          email,
          password: 'senha-forte-123',
          roleId: roles.find((r) => r.systemKey === key)!.id,
        })
      ).json();
      const login = await t.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'senha-forte-123' },
      });
      return {
        userId: membro.userId ?? membro.id,
        client: api(t.app, { authorization: `Bearer ${login.json().accessToken}` }),
      };
    };

    // O gerente não tem "Criar chaves de API e webhooks".
    const gerente = await entrar('manager');
    expect((await gerente.client.get('/api-keys')).statusCode).toBe(403);
    expect(
      (await gerente.client.post('/api-keys', { name: 'X', scopes: ['catalog.read'] })).statusCode,
    ).toBe(403);
    // Escopo fora da lista pública é recusado.
    expect(
      (await admin.post('/api-keys', { name: 'Tudo', scopes: ['finance.write'] })).statusCode,
    ).toBe(400);

    // Um segundo dono cria a chave; quando perde o acesso, a chave para.
    const socio = await entrar('owner');
    const chave = (
      await socio.client.post('/api-keys', { name: 'BI', scopes: ['parties.read'] })
    ).json();
    expect((await comChave(chave.key).get('/public/me')).statusCode).toBe(200);
    const membros = (await admin.get('/members')).json() as { userId: string; name: string }[];
    const doSocio = membros.find((m) => m.name === 'owner')!;
    expect((await admin.patch(`/members/${doSocio.userId}`, { active: false })).statusCode).toBe(
      200,
    );
    expect((await comChave(chave.key).get('/public/me')).statusCode).toBe(401);
  });
});
