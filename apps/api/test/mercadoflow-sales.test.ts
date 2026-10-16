import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { uuidv7 } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { mercadoflowLinks, mercadoflowOutbox } from '../src/db/schema';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { MercadoflowMarketSync } from '../src/modules/mercadoflow/mercadoflow.market-sync';
import { MercadoflowOutbox } from '../src/modules/mercadoflow/mercadoflow.outbox';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SefazSimulator, SENHA_A1, testPfx } from './support/sefaz-simulator';

/**
 * MF-08: a NFC-e autorizada vai para o MercadoFlow pela outbox, o cancelamento vai depois da
 * venda, LIMITE_DO_PLANO pausa a loja e a carga inicial manda os últimos 90 dias. SEFAZ e
 * MercadoFlow simulados.
 */

let mf: Server;
let t: TestApp;
const sefaz = new SefazSimulator();
const pfxBase64 = testPfx();
/** normal: GRAVADO; limite: LIMITE_DO_PLANO; recusa: RECUSADO; fora: erro 503. */
let modo: 'normal' | 'limite' | 'recusa' | 'fora' = 'normal';
const recebidos: { path: string; query: string; items: Record<string, unknown>[] }[] = [];

beforeAll(async () => {
  await sefaz.start();
  mf = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const [rawPath, query = ''] = (req.url ?? '').replace('/api/v1/partner', '').split('?');
      const path = rawPath!;
      const send = (status: number, payload: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      if (path === '/oauth/token')
        return send(200, { access_token: 'mfp_vendas', expires_in: 3600 });
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        items?: Record<string, unknown>[];
      };
      if (modo === 'fora') return send(503, { message: 'fora do ar' });
      recebidos.push({ path, query, items: body.items ?? [] });
      const status = path.endsWith('/sales/cancel')
        ? 'CANCELADA'
        : modo === 'limite'
          ? 'LIMITE_DO_PLANO'
          : modo === 'recusa'
            ? 'RECUSADO'
            : 'GRAVADO';
      return send(200, {
        items: (body.items ?? []).map((i) => ({
          chaveNFe: i.chaveNFe,
          status,
          ...(status === 'RECUSADO' && { error: 'NCM inválido' }),
        })),
      });
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
  });
  Object.assign(t.app.get(SefazService), { transport: sefaz.transport() });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
  await sefaz.stop();
});
beforeEach(() => {
  recebidos.length = 0;
  modo = 'normal';
  sefaz.mode = 'normal';
});

/** Relógio da fila: cada envio é uma hora depois do anterior (passa o intervalo de cada tipo). */
let relogio = Date.now();
const enviar = () => {
  relogio += 60 * 60_000;
  return t.app.get(MercadoflowOutbox).flush(new Date(relogio));
};

function transport(auth: Record<string, string>, terminalId: string): SyncTransport {
  const client = api(t.app, { ...auth, 'x-bipae-terminal': terminalId });
  return {
    async push(id, events: TerminalEvent[]) {
      const res = await client.post('/sync/events', { terminalId: id, events });
      if (res.statusCode !== 200) throw new Error(res.body);
      return res.json() as SyncPushResult;
    },
    async pull(cursor, _limit, pricingVersion, fiscalVersion) {
      const res = await client.get(
        `/sync/pull?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${
          pricingVersion ? `&pricingVersion=${pricingVersion}` : ''
        }${fiscalVersion ? `&fiscalVersion=${fiscalVersion}` : ''}`,
      );
      return res.json() as SyncPullResult;
    },
  };
}

let mercado = 0;
/** Empresa pronta para emitir, caixa aberto e, se `escopos`, loja vinculada ao MercadoFlow. */
async function loja(escopos: string[] | null = ['sales:write']) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Mercadinho Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'simples',
    ie: '111.222.333.444',
    street: 'Rua das Flores',
    streetNumber: '100',
    district: 'Centro',
    cityCode: '3550308',
    cep: '01001-000',
  });
  await admin.post(`/fiscal/certificates/${empresa.id}`, { pfxBase64, password: SENHA_A1 });
  const perfil = (
    await admin.post('/fiscal-profiles', {
      name: 'Mercearia',
      cfopInterna: '5102',
      csosn: '102',
      cClassTrib: '000001',
    })
  ).json();
  await admin.post('/products', {
    name: 'Arroz tipo 1 5kg',
    sku: 'ARROZ5',
    priceCents: 2890,
    barcodes: ['7891000315507'],
    ncm: '10063021',
    fiscalProfileId: perfil.id,
  });
  const [store] = (await admin.get('/stores')).json();
  const marketId = `mk_vendas_${++mercado}`;
  const vincular = (scopes: string[]) =>
    withTenant(t.database.db, ctx as never, (tx) =>
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
  if (escopos) await vincular(escopos);
  const caixa = (
    await admin.post('/terminals', { storeId: store.id, name: 'Caixa', platform: 'web' })
  ).json();
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  const pdv = new PdvService(storage, { terminalId: caixa.id, operatorId: dono.me.user.id });
  const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
  await sync.sync();
  await pdv.openSession(0);
  const vender = async () => {
    const produto = (await pdv.findByCode('7891000315507'))!;
    const venda = await pdv.completeSale(
      { ...addItem(EMPTY_CART, produto, 2000), customerTaxId: '12345678909' },
      [{ method: 'cash', receivedCents: 6000 }],
      { discountLimitPercent: 10 },
    );
    expect((await sync.sync()).lastError).toBeNull();
    return venda;
  };
  const cancelar = async (saleId: string) => {
    await pdv.cancelSale(saleId, 'Cliente desistiu', null);
    expect((await sync.sync()).lastError).toBeNull();
  };
  return { admin, ctx, store, marketId, vender, cancelar, vincular };
}

async function nota(
  admin: ReturnType<typeof api>,
  saleId: string,
  until: (d: { status: string }) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const doc = (await admin.get(`/sales/${saleId}/fiscal`)).json();
    if (doc && until(doc)) return doc;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('A nota não saiu do lugar.');
}

const doMercado = (marketId: string, recurso: string) =>
  recebidos.filter((r) => r.path === `/markets/${marketId}/${recurso}`);

const linha = (ctx: { tenantId: string; userId: string }, marketId: string) =>
  withTenant(t.database.db, ctx as never, async (tx) => {
    const [link] = await tx
      .select()
      .from(mercadoflowLinks)
      .where(eq(mercadoflowLinks.marketId, marketId));
    const fila = await tx
      .select()
      .from(mercadoflowOutbox)
      .where(eq(mercadoflowOutbox.tenantId, ctx.tenantId));
    return { link: link!, fila: fila.filter((f) => f.kind.startsWith('market.sales')) };
  });

describe('vendas no MercadoFlow (MF-08)', () => {
  it('a NFC-e autorizada vai no formato do contrato, em homologação só para validar', async () => {
    const { admin, ctx, marketId, vender } = await loja();
    const venda = await vender();
    const doc = await nota(admin, venda.id, (d) => d.status === 'authorized');
    await enviar();
    const [envio] = doMercado(marketId, 'sales');
    expect(envio?.query).toBe('dryRun=true');
    expect(envio?.items).toEqual([
      {
        chaveNFe: doc.accessKey,
        cnpjEmitente: '11222333000181',
        dataEmissao: expect.stringMatching(/^2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/),
        serie: String(doc.series),
        numero: String(doc.number),
        valorTotal: 57.8,
        cpfCnpjDestinatario: '12345678909',
        emitente: {
          logradouro: 'Rua das Flores',
          numero: '100',
          bairro: 'Centro',
          municipio: 'São Paulo',
          codigoMunicipio: '3550308',
          uf: 'SP',
          cep: '01001000',
        },
        items: [
          expect.objectContaining({
            codigoEAN: '7891000315507',
            codigoInterno: 'ARROZ5',
            ncm: '10063021',
            cfop: '5102',
            quantidade: 2,
            valorUnitario: 28.9,
            valorTotal: 57.8,
            valorDesconto: 0,
            valorLiquido: 57.8,
          }),
        ],
      },
    ]);
    const { link, fila } = await linha(ctx, marketId);
    expect(link.lastSalesSyncAt).not.toBeNull();
    expect(fila.map((f) => [f.kind, f.status])).toEqual([['market.sales', 'sent']]);
  });

  it('o cancelamento vai depois da venda, mesmo com a venda presa na fila', async () => {
    const { admin, marketId, vender, cancelar } = await loja();
    const venda = await vender();
    const doc = await nota(admin, venda.id, (d) => d.status === 'authorized');
    // O MercadoFlow está fora: a venda fica na fila.
    modo = 'fora';
    await enviar();
    await cancelar(venda.id);
    await nota(admin, venda.id, (d) => d.status === 'cancelled');
    modo = 'normal';
    // A venda ainda espera a nova tentativa; o cancelamento não passa na frente.
    await t.app.get(MercadoflowOutbox).flush(new Date(relogio + 30_000));
    expect(doMercado(marketId, 'sales/cancel')).toHaveLength(0);
    await enviar();
    await enviar();
    const ordem = recebidos
      .filter((r) => r.path.startsWith(`/markets/${marketId}/`))
      .map((r) => r.path.replace(`/markets/${marketId}/`, ''));
    expect(ordem).toEqual(['sales', 'sales/cancel']);
    expect(doMercado(marketId, 'sales/cancel')[0]!.items).toEqual([{ chaveNFe: doc.accessKey }]);
  });

  it('LIMITE_DO_PLANO pausa as vendas da loja por 6 horas e avisa', async () => {
    const { admin, ctx, marketId, vender } = await loja();
    const venda = await vender();
    await nota(admin, venda.id, (d) => d.status === 'authorized');
    modo = 'limite';
    await enviar();
    const { link, fila } = await linha(ctx, marketId);
    expect(link.lastError).toBe('Limite do plano do MercadoFlow: vendas em pausa por 6 horas.');
    expect(link.salesPausedUntil!.getTime()).toBeGreaterThan(relogio + 5 * 3_600_000);
    expect(fila[0]).toMatchObject({ status: 'pending' });
    modo = 'normal';
    recebidos.length = 0;
    // Uma hora depois, ainda em pausa: nada sai.
    await t.app.get(MercadoflowOutbox).flush(new Date(relogio + 3_600_000));
    expect(doMercado(marketId, 'sales')).toHaveLength(0);
  });

  it('venda recusada fica registrada e não se repete', async () => {
    const { admin, ctx, marketId, vender } = await loja();
    const venda = await vender();
    await nota(admin, venda.id, (d) => d.status === 'authorized');
    modo = 'recusa';
    await enviar();
    const { fila } = await linha(ctx, marketId);
    expect(fila[0]).toMatchObject({ status: 'rejected', lastError: 'NCM inválido' });
  });

  it('sem o escopo sales:write nada vai; a carga inicial manda o histórico depois do vínculo', async () => {
    const { admin, ctx, store, marketId, vender, vincular } = await loja(null);
    const primeira = await vender();
    const segunda = await vender();
    const a = await nota(admin, primeira.id, (d) => d.status === 'authorized');
    const b = await nota(admin, segunda.id, (d) => d.status === 'authorized');
    expect((await linha(ctx, marketId)).fila).toHaveLength(0);
    await vincular(['sales:write']);
    await t.app.get(MercadoflowMarketSync).initialLoad(ctx.tenantId, store.id);
    await enviar();
    expect(doMercado(marketId, 'sales').flatMap((r) => r.items.map((i) => i.chaveNFe))).toEqual([
      a.accessKey,
      b.accessKey,
    ]);
  });
});
