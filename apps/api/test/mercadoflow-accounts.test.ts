import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPlatform } from '../src/db/client';
import { tenants } from '../src/db/schema';
import { MercadoflowAccounts } from '../src/modules/mercadoflow/mercadoflow.accounts';
import { signWebhook } from '../src/modules/mercadoflow/mercadoflow.webhook';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** MF-04: contas vinculadas e desconto, contra um MercadoFlow simulado. */

const SEGREDO = 'whsec_contas';
let mf: Server;
let t: TestApp;
const recebidos: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
let consulta: 'PENDENTE' | 'APROVADO' | 'RECUSADO' | 'EXPIRADO' = 'PENDENTE';

beforeAll(async () => {
  mf = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').replace('/api/v1/partner', '').split('?')[0]!;
      const text = Buffer.concat(chunks).toString('utf8');
      const body =
        text && req.headers['content-type']?.includes('json')
          ? (JSON.parse(text) as Record<string, unknown>)
          : null;
      const send = (status: number, payload: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      if (path === '/oauth/token') return send(200, { access_token: 'mfp_c', expires_in: 3600 });
      recebidos.push({ method: req.method ?? '', path, body });
      if (path === '/accounts') {
        if (body?.cnpj === '11444777000161') {
          return send(409, {
            status: 'JA_TEM_CONTA',
            reason: 'CNPJ_JA_TEM_CONTA',
            message: 'Este CNPJ já tem conta no MercadoFlow.',
            connect: {
              code: 'mfx_409',
              connectUrl: 'https://mercadoflow.com/conectar/mfx_409',
              expiresAt: '2026-10-20T00:00:00Z',
            },
          });
        }
        if (!body?.phone) return send(400, { erro: 'Telefone obrigatório' });
        return send(201, {
          status: 'CRIADA',
          marketId: 'mk_novo',
          scopes: body.scopes,
          welcomeEmailSent: true,
        });
      }
      if (path === '/connect') {
        return send(200, {
          code: 'mfx_ok',
          connectUrl: 'https://mercadoflow.com/conectar/mfx_ok',
          expiresAt: '2026-10-20T00:00:00Z',
        });
      }
      if (path.startsWith('/connect/')) {
        return send(200, {
          status: consulta,
          marketId: consulta === 'APROVADO' ? 'mk_vinc' : null,
          scopes: ['sales:write'],
        });
      }
      if (/^\/markets\/[^/]+\/customer$/.test(path)) {
        return send(200, {
          active: body?.active,
          discount: { active: !!body?.active, partner: 'Bipae', percent: 20 },
        });
      }
      if (/^\/markets\/[^/]+\/benefit$/.test(path))
        return send(200, { discount: { active: true, partner: 'Bipae', percent: 20 } });
      return send(404, { erro: 'não existe' });
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
    MERCADOFLOW_WEBHOOK_SECRET: SEGREDO,
    MERCADOFLOW_TERMS_URL: 'https://mercadoflow.com/termos',
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});
beforeEach(() => {
  recebidos.length = 0;
  consulta = 'PENDENTE';
});

async function loja(cnpj = '11.222.333/0001-81') {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  if (cnpj)
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: 'Mercado Exemplo LTDA',
      tradeName: 'Mercado Exemplo',
      taxId: cnpj,
    });
  const [store] = (await admin.get('/stores')).json();
  return {
    admin,
    store,
    tenantId: dono.me.tenant.id as string,
    email: dono.me.user.email as string,
  };
}

const situacao = async (admin: ReturnType<typeof api>, storeId: string) =>
  (await admin.get('/mercadoflow'))
    .json()
    .stores.find((s: { storeId: string }) => s.storeId === storeId);

describe('contas MercadoFlow (MF-04)', () => {
  it('criar a conta: pede o aceite, manda os dados da loja e liga o desconto', async () => {
    const { admin, store, email } = await loja();
    const semAceite = await admin.post('/mercadoflow/accounts', {
      storeId: store.id,
      phone: '41999990000',
    });
    expect(semAceite.json().message).toBe(
      'Para criar a conta, marque a autorização e o aceite dos termos do MercadoFlow',
    );

    const criada = await admin.post('/mercadoflow/accounts', {
      storeId: store.id,
      phone: '(41) 99999-0000',
      acceptTerms: true,
    });
    expect(criada.statusCode).toBe(201);
    expect(criada.json()).toEqual({ status: 'CRIADA', email });
    const enviado = recebidos.find((r) => r.path === '/accounts')!.body!;
    expect(enviado).toMatchObject({
      cnpj: '11222333000181',
      storeName: 'Mercado Exemplo',
      ownerEmail: email,
      phone: '41999990000',
      externalStoreId: store.id,
      customerActive: true,
    });
    expect(enviado.termsAcceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Nenhuma senha passa pelo Bipaê.
    expect(JSON.stringify(enviado)).not.toMatch(/senha|password/i);
    expect(recebidos.find((r) => r.path === '/markets/mk_novo/customer')?.body).toEqual({
      active: true,
    });

    const visao = (await admin.get('/mercadoflow')).json();
    expect(visao).toMatchObject({
      enabled: true,
      termsUrl: 'https://mercadoflow.com/termos',
      queue: { pending: 0 },
    });
    expect(await situacao(admin, store.id)).toMatchObject({
      status: 'ATIVA',
      marketId: 'mk_novo',
      createdVia: 'ACCOUNT',
      customerActive: true,
      discount: { active: true, percent: 20 },
    });
    const auditoria = JSON.stringify(
      (await admin.get('/audit?action=mercadoflow.account_created')).json(),
    );
    expect(auditoria).toContain('mercadoflow.account_created');
  });

  it('CNPJ que já tem conta leva ao vínculo, que fica ativo quando o dono aprova (consulta)', async () => {
    const { admin, store } = await loja('11.444.777/0001-61');
    const res = await admin.post('/mercadoflow/accounts', {
      storeId: store.id,
      phone: '41999990000',
      acceptTerms: true,
    });
    expect(res.json()).toEqual({
      status: 'JA_TEM_CONTA',
      message: 'Este CNPJ já tem conta no MercadoFlow.',
      connectUrl: 'https://mercadoflow.com/conectar/mfx_409',
    });
    expect(await situacao(admin, store.id)).toMatchObject({
      status: 'PENDENTE',
      connectUrl: 'https://mercadoflow.com/conectar/mfx_409',
    });

    expect((await admin.post(`/mercadoflow/links/${store.id}/refresh`)).json()).toMatchObject({
      status: 'PENDENTE',
      pollEveryMs: 30000,
    });
    consulta = 'APROVADO';
    expect((await admin.post(`/mercadoflow/links/${store.id}/refresh`)).json()).toMatchObject({
      status: 'ATIVA',
    });
    expect(recebidos.some((r) => r.path === '/connect/mfx_409')).toBe(true);
    expect(await situacao(admin, store.id)).toMatchObject({
      status: 'ATIVA',
      marketId: 'mk_vinc',
      scopes: ['sales:write'],
    });
    expect(recebidos.find((r) => r.path === '/markets/mk_vinc/customer')?.body).toEqual({
      active: true,
    });
    // Ativo, a consulta não chama mais o MercadoFlow.
    recebidos.length = 0;
    expect((await admin.post(`/mercadoflow/links/${store.id}/refresh`)).json()).toEqual({
      status: 'ATIVA',
    });
    expect(recebidos).toEqual([]);
  });

  it('"Já tenho conta": vínculo aprovado pelo aviso do MercadoFlow antes de a tela consultar', async () => {
    const { admin, store } = await loja();
    const link = await admin.post('/mercadoflow/connect', {
      storeId: store.id,
      returnUrl: 'https://www.bipae.com.br/app/mercadoflow',
    });
    expect(link.json()).toMatchObject({ connectUrl: 'https://mercadoflow.com/conectar/mfx_ok' });
    expect(recebidos.find((r) => r.path === '/connect')?.body).toMatchObject({
      cnpj: '11222333000181',
      externalStoreId: store.id,
      returnUrl: 'https://www.bipae.com.br/app/mercadoflow',
    });
    const evento = JSON.stringify({
      event: 'connection.authorized',
      marketId: 'mk_web',
      data: { externalStoreId: store.id, scopes: ['confere:use'] },
    });
    const aviso = await t.app.inject({
      method: 'POST',
      url: '/v1/integrations/mercadoflow/webhook',
      headers: {
        'content-type': 'application/json',
        'x-mercadoflow-signature': signWebhook(evento, SEGREDO),
        'x-mercadoflow-delivery': `d-${store.id}`,
      },
      payload: evento,
    });
    expect(aviso.statusCode).toBe(200);
    expect(await situacao(admin, store.id)).toMatchObject({ status: 'ATIVA', marketId: 'mk_web' });
    expect(recebidos.find((r) => r.path === '/markets/mk_web/customer')?.body).toEqual({
      active: true,
    });
    expect(
      (
        await admin.post('/mercadoflow/connect', {
          storeId: store.id,
          returnUrl: 'http://exemplo.com',
        })
      ).json().message,
    ).toBe('Endereço de volta inválido');
  });

  it('link expirado ou recusado aparece com o motivo', async () => {
    const { admin, store } = await loja();
    await admin.post('/mercadoflow/connect', {
      storeId: store.id,
      returnUrl: 'http://localhost:5173/mercadoflow',
    });
    consulta = 'EXPIRADO';
    expect((await admin.post(`/mercadoflow/links/${store.id}/refresh`)).json().status).toBe(
      'EXPIRADA',
    );
    expect(await situacao(admin, store.id)).toMatchObject({
      status: 'EXPIRADA',
      lastError: 'O link de vínculo expirou. Peça um novo.',
    });
    await admin.post('/mercadoflow/connect', {
      storeId: store.id,
      returnUrl: 'http://localhost:5173/mercadoflow',
    });
    consulta = 'RECUSADO';
    expect((await admin.post(`/mercadoflow/links/${store.id}/refresh`)).json().status).toBe(
      'RECUSADA',
    );
  });

  it('a assinatura do Bipaê mudou: o MercadoFlow fica sabendo (desliga e religa o desconto)', async () => {
    const { admin, store, tenantId } = await loja();
    await admin.post('/mercadoflow/accounts', {
      storeId: store.id,
      phone: '41999990000',
      acceptTerms: true,
    });
    recebidos.length = 0;
    await asPlatform(t.database.db, (tx) =>
      tx.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId)),
    );
    const contas = t.app.get(MercadoflowAccounts);
    await contas.syncCustomers(tenantId);
    expect(recebidos.find((r) => r.path === '/markets/mk_novo/customer')?.body).toEqual({
      active: false,
    });
    await asPlatform(t.database.db, (tx) =>
      tx.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenantId)),
    );
    await contas.syncAllCustomers();
    expect(recebidos.filter((r) => r.path === '/markets/mk_novo/customer').at(-1)?.body).toEqual({
      active: true,
    });
  });

  it('erros com mensagem clara: sem CNPJ e dado recusado pelo MercadoFlow', async () => {
    const semCnpj = await loja('');
    const r1 = await semCnpj.admin.post('/mercadoflow/accounts', {
      storeId: semCnpj.store.id,
      phone: '41999990000',
      acceptTerms: true,
    });
    expect(r1.json().message).toBe('Informe o CNPJ da empresa desta loja em Empresas e lojas.');
    const { admin, store } = await loja();
    expect(
      (
        await admin.post('/mercadoflow/accounts', {
          storeId: store.id,
          phone: '123',
          acceptTerms: true,
        })
      ).json().message,
    ).toBe('Telefone com DDD: 10 ou 11 dígitos');
  });
});

describe('contas com a integração desligada', () => {
  it('a tela mostra que está desligada e criar conta explica', async () => {
    const semMf = await createTestApp();
    try {
      const dono = await signup(semMf.app);
      const admin = api(semMf.app, dono.auth);
      const [store] = (await admin.get('/stores')).json();
      expect((await admin.get('/mercadoflow')).json()).toMatchObject({ enabled: false });
      const r = await admin.post('/mercadoflow/accounts', {
        storeId: store.id,
        phone: '41999990000',
        acceptTerms: true,
      });
      expect(r.json().message).toBe(
        'A integração com o MercadoFlow ainda não está ligada no Bipaê.',
      );
    } finally {
      await semMf.close();
    }
  });
});
