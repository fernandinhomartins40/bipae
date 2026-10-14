import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@bipae/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { mercadoflowLinks } from '../src/db/schema';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** MF-10: card do Tino com as decisões de cada loja vinculada, contra um MercadoFlow simulado. */

let mf: Server;
let t: TestApp;
let chamadas: string[] = [];
let fora = false;

beforeAll(async () => {
  mf = createServer((req, res) => {
    const path = (req.url ?? '').replace('/api/v1/partner', '');
    const send = (status: number, payload: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    if (path.startsWith('/oauth/token'))
      return send(200, { access_token: 'mfp_in', expires_in: 3600 });
    chamadas.push(path);
    if (fora) return send(503, { error: 'fora do ar' });
    return send(200, {
      total: 7,
      byActionType: { COMPRAR: 4, PRECIFICAR: 3 },
      expectedImpactValue: 1234.5,
      lockedByPlan: false,
      url: 'https://mercadoflow.com/app/decisoes',
      items: [
        {
          id: 'd1',
          actionType: 'COMPRAR',
          title: 'Comprar arroz antes de acabar',
          rationale: 'Gira 30 por semana e restam 8',
          gtin: '7891000315507',
          productName: 'Arroz 5kg',
          expectedImpactValue: '210.10',
          confidence: 0.8,
          suggestion: { quantidade: 40 },
          url: 'https://mercadoflow.com/app/decisoes/d1',
        },
        { id: 'd2', title: 'Link estranho', url: 'javascript:alert(1)' },
      ],
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});
beforeEach(() => {
  chamadas = [];
  fora = false;
});

let mercado = 0;
async function lojaVinculada(scopes: string[]) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const ctx = { tenantId: dono.me.tenant.id as string };
  const [empresa] = (await admin.get('/companies')).json();
  const [store] = (await admin.get('/stores')).json();
  const marketId = `mk_tino_${++mercado}`;
  await withTenant(t.database.db, ctx as never, (tx) =>
    tx.insert(mercadoflowLinks).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      companyId: empresa.id,
      storeId: store.id,
      marketId,
      status: 'ATIVA',
      createdVia: 'ACCOUNT',
      scopes,
    }),
  );
  return { admin, store, marketId };
}

describe('card do Tino (MF-10)', () => {
  it('mostra as decisões da loja em centavos e guarda por 15 minutos', async () => {
    const { admin, store, marketId } = await lojaVinculada(['insights:read']);
    const res = await admin.get('/mercadoflow/decisions');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.stores).toEqual([
      expect.objectContaining({
        storeId: store.id,
        status: 'ok',
        total: 7,
        expectedImpactCents: 123450,
        url: 'https://mercadoflow.com/app/decisoes',
      }),
    ]);
    expect(body.stores[0].items[0]).toEqual(
      expect.objectContaining({ id: 'd1', expectedImpactCents: 21010, gtin: '7891000315507' }),
    );
    // Link que não é http(s) não vai para a tela.
    expect(body.stores[0].items[1].url).toBeNull();

    await admin.get('/mercadoflow/decisions');
    expect(chamadas.filter((c) => c.startsWith(`/markets/${marketId}/decisions`))).toHaveLength(1);
  });

  it('sem a permissão insights:read a loja não aparece', async () => {
    const { admin } = await lojaVinculada(['catalog:write']);
    expect((await admin.get('/mercadoflow/decisions')).json().stores).toEqual([]);
    expect(chamadas).toEqual([]);
  });

  it('MercadoFlow fora do ar: a loja aparece como indisponível e o painel segue', async () => {
    fora = true;
    const { admin } = await lojaVinculada(['insights:read']);
    const res = await admin.get('/mercadoflow/decisions');
    expect(res.statusCode).toBe(200);
    expect(res.json().stores).toEqual([
      expect.objectContaining({ status: 'unavailable', total: 0, items: [] }),
    ]);
  });
});
