import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTenant } from '../src/db/client';
import { mercadoflowOutbox } from '../src/db/schema';
import { MercadoflowOutbox } from '../src/modules/mercadoflow/mercadoflow.outbox';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { item, notaDoFornecedor } from './support/supplier-nfe';

/** MF-02: catálogo nativo no cadastro de produto, contra um MercadoFlow simulado. */

const ACUCAR = {
  gtin: '7891910000197',
  found: true,
  description: 'Açúcar União Refinado 1kg',
  brand: 'União',
  manufacturer: 'Camil',
  department: 'Mercearia',
  category: 'Açúcar e Adoçantes > Açúcar',
  unit: 'UN',
  weighable: false,
  packageDescription: '1 kg',
  content: { quantity: '1', unit: 'KG', packs: 1 },
  ncm: '17019900',
  ncmConfidence: 0.92,
  cest: '1710300',
  packs: [
    { packGtin: '17891910000194', unitsPerPack: 10 },
    { packGtin: 'x', unitsPerPack: 0 },
  ],
  imageUrl: 'https://mercadoflow.com/api/v1/catalog/images/products/7891910000197.jpg',
  source: 'TESTE',
  spec: { ingredients: 'Açúcar.' },
};

let mf: Server;
let t: TestApp;
let modo: 'ok' | 'fora' | 'lento' = 'ok';
const chamadas: string[] = [];
const contribuicoes: { items: Record<string, unknown>[] }[] = [];

beforeAll(async () => {
  mf = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://x');
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (url.pathname.endsWith('/oauth/token'))
        return send(200, { access_token: 'mfp_t', expires_in: 3600 });
      chamadas.push(`${req.method} ${url.pathname}${url.search}`);
      if (modo === 'fora') return send(503, {});
      const responder = () => {
        const path = url.pathname.replace('/api/v1/partner', '');
        if (path === '/catalog/contributions') {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            items: Record<string, unknown>[];
          };
          contribuicoes.push(body);
          return send(200, {
            items: body.items.map((i) =>
              i.gtin === '7891000100103'
                ? { gtin: i.gtin, status: 'RECUSADO', error: 'Descrição muito curta' }
                : { gtin: i.gtin, status: 'CRIADO' },
            ),
          });
        }
        if (path === '/catalog/products/lookup') {
          const { gtins } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            gtins: string[];
          };
          return send(200, {
            items: gtins.map((gtin) =>
              gtin === ACUCAR.gtin ? ACUCAR : { gtin, found: false, reason: 'NAO_ENCONTRADO' },
            ),
          });
        }
        if (path === '/catalog/search') {
          const q = (url.searchParams.get('q') ?? '').toLowerCase();
          return send(200, {
            items: q.includes('acucar')
              ? [{ ...ACUCAR, ncm: undefined, cest: undefined, packs: undefined }]
              : [],
            genericImages: [],
          });
        }
        const gtin = path.replace('/catalog/products/', '');
        if (gtin === ACUCAR.gtin) return send(200, ACUCAR);
        if (gtin === '12345678') return send(200, { gtin, found: false, reason: 'GTIN_INVALIDO' });
        if (gtin === '7890000000000')
          return send(200, { ...ACUCAR, gtin, ncm: '99999999', cest: '0000000' });
        return send(200, { gtin, found: false, reason: 'NAO_ENCONTRADO' });
      };
      if (modo === 'lento') setTimeout(responder, 2200);
      else responder();
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
  modo = 'ok';
  chamadas.length = 0;
  contribuicoes.length = 0;
});

const cliente = async () => api(t.app, (await signup(t.app)).auth);

/** Dono com o contexto do cliente, para ler a fila. */
async function dono() {
  const d = await signup(t.app);
  return {
    c: api(t.app, d.auth),
    ctx: { tenantId: d.me.tenant.id as string, userId: d.me.user.id as string },
  };
}
const fila = (ctx: { tenantId: string }) =>
  withTenant(t.database.db, ctx as never, (tx) =>
    tx.select().from(mercadoflowOutbox).where(eq(mercadoflowOutbox.kind, 'catalog.contribution')),
  );

describe('catálogo nativo (MF-02)', () => {
  it('acha o produto pelo código, confere NCM e CEST na tabela oficial e usa o cache', async () => {
    const c = await cliente();
    expect((await c.get('/product-catalog/status')).json()).toEqual({ enabled: true });
    const res = await c.get(`/product-catalog/products/${ACUCAR.gtin}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      gtin: ACUCAR.gtin,
      found: true,
      description: 'Açúcar União Refinado 1kg',
      brand: 'União',
      manufacturer: 'Camil',
      department: 'Mercearia',
      unit: 'UN',
      content: { quantity: '1', unit: 'KG', packs: 1 },
      ncm: '17019900',
      ncmConfidence: 0.92,
      packs: [{ packGtin: '17891910000194', unitsPerPack: 10 }],
      source: 'TESTE',
    });
    // Nada de credencial, imagem externa ou ficha crua indo para a tela.
    expect(JSON.stringify(res.json())).not.toMatch(/mfp_|imageUrl|spec/);
    await c.get(`/product-catalog/products/${ACUCAR.gtin}`);
    // Outra loja também aproveita o cache: o catálogo é igual para todos.
    await (await cliente()).get(`/product-catalog/products/${ACUCAR.gtin}`);
    expect(chamadas.filter((x) => x.includes(ACUCAR.gtin))).toHaveLength(1);
  });

  it('NCM e CEST que não existem na tabela oficial não são sugeridos', async () => {
    const produto = (await (await cliente()).get('/product-catalog/products/7890000000000')).json();
    expect(produto).toMatchObject({ found: true, ncm: null, cest: null });
  });

  it('não encontrado, código inválido e formato errado', async () => {
    const c = await cliente();
    expect((await c.get('/product-catalog/products/7891000100103')).json()).toEqual({
      gtin: '7891000100103',
      found: false,
      reason: 'NAO_ENCONTRADO',
    });
    expect((await c.get('/product-catalog/products/12345678')).json()).toMatchObject({
      found: false,
      reason: 'GTIN_INVALIDO',
    });
    const ruim = await c.get('/product-catalog/products/abc');
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().message).toBe('Código de barras deve ter de 8 a 14 dígitos');
  });

  it('no caixa a consulta desiste em 1,5 s e o MercadoFlow fora do ar não quebra nada', async () => {
    const c = await cliente();
    modo = 'lento';
    const inicio = Date.now();
    const lento = await c.get('/product-catalog/products/7891000055120?quick=1');
    expect(Date.now() - inicio).toBeLessThan(2100);
    expect(lento.json()).toEqual({ gtin: '7891000055120', found: false, reason: 'SEM_RESPOSTA' });
    modo = 'fora';
    expect((await c.get('/product-catalog/products/7891000055120?quick=1')).json().reason).toBe(
      'SEM_RESPOSTA',
    );
    expect((await c.get('/product-catalog/search?q=acucar')).json()).toEqual({ items: [] });
    // "Sem resposta" não fica no cache: quando volta, a consulta funciona.
    modo = 'ok';
    expect((await c.get('/product-catalog/products/7891000055120')).json().reason).toBe(
      'NAO_ENCONTRADO',
    );
  });

  it('busca por nome, com acento, e guarda por 10 minutos', async () => {
    const c = await cliente();
    const res = await c.get(
      `/product-catalog/search?q=${encodeURIComponent('acucar união')}&limit=5`,
    );
    expect(res.json().items).toEqual([
      expect.objectContaining({
        gtin: ACUCAR.gtin,
        description: 'Açúcar União Refinado 1kg',
        ncm: null,
      }),
    ]);
    await c.get(`/product-catalog/search?q=${encodeURIComponent('acucar união')}&limit=5`);
    expect(chamadas.filter((x) => x.includes('/catalog/search'))).toHaveLength(1);
    expect(chamadas[0]).toContain('limit=5');
    expect((await c.get('/product-catalog/search?q=a')).json().message).toBe(
      'Digite pelo menos 2 letras',
    );
  });

  it('vários códigos de uma vez (até 200), aproveitando o cache', async () => {
    const c = await cliente();
    await c.get(`/product-catalog/products/${ACUCAR.gtin}`);
    chamadas.length = 0;
    const gtins = [ACUCAR.gtin, '7891000100103', '7896004000015'];
    const res = await c.post('/product-catalog/lookup', { gtins });
    expect(
      res.json().items.map((i: { gtin: string; found: boolean }) => [i.gtin, i.found]),
    ).toEqual([
      [ACUCAR.gtin, true],
      ['7891000100103', false],
      ['7896004000015', false],
    ]);
    const demais = (
      await c.post('/product-catalog/lookup', {
        gtins: Array.from({ length: 201 }, () => '7891000100103'),
      })
    ).statusCode;
    expect(demais).toBe(400);
  });

  it('o produto guarda os dados do catálogo e as embalagens de compra', async () => {
    const c = await cliente();
    const criado = await c.post('/products', {
      name: 'Açúcar União Refinado 1kg',
      priceCents: 599,
      barcodes: [ACUCAR.gtin],
      ncm: '17019900',
      catalog: {
        brand: 'União',
        manufacturer: 'Camil',
        department: 'Mercearia',
        content: { quantity: '1', unit: 'kg' },
        source: 'TESTE',
      },
      packs: [{ packGtin: '17891910000194', unitsPerPack: 10 }],
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json()).toMatchObject({
      catalog: { brand: 'União', content: { quantity: '1', unit: 'KG', packs: 1 } },
      packs: [{ packGtin: '17891910000194', unitsPerPack: 10 }],
    });
    const semPacks = await c.put(`/products/${criado.json().id}`, {
      ...(criado.json() as object),
      packs: [],
    });
    expect(semPacks.json().packs).toEqual([]);
    const invalido = await c.post('/products', {
      name: 'X',
      priceCents: 1,
      packs: [{ packGtin: '123', unitsPerPack: 0 }],
    });
    expect(invalido.statusCode).toBe(400);
  });
});

describe('devolução ao catálogo e compra com o catálogo (MF-03)', () => {
  it('produto criado ou alterado com GTIN válido vai ao catálogo, sem preço, e a recusa não se repete', async () => {
    const { c, ctx } = await dono();
    const criado = (
      await c.post('/products', {
        name: 'Biscoito Recheado Chocolate 130g',
        priceCents: 399,
        costCents: 210,
        barcodes: ['7891000100103', '2000001000005', '78912342'],
        ncm: '19053100',
        catalog: {
          brand: 'Marca X',
          department: 'Mercearia > Biscoitos',
          packageDescription: '130 g',
        },
      })
    ).json();
    let itens = await fila(ctx);
    // Código interno de peso (começa com 2) não vai.
    expect(itens.map((i) => i.dedupeKey).sort()).toEqual(['7891000100103', '78912342']);
    expect(itens[0]!.payload).toMatchObject({
      storeId: ctx.tenantId,
      description: 'Biscoito Recheado Chocolate 130g',
      brand: 'Marca X',
      department: 'Mercearia > Biscoitos',
      unit: 'UN',
      packageDescription: '130 g',
      ncm: '19053100',
    });
    // Sem preço nem custo no envio. O id da loja fica fora da conferência: por ser aleatório,
    // ele às vezes contém "399" ou "210" e derrubava o teste por acaso.
    const semId = itens.map((i) => {
      const { storeId: _loja, ...resto } = i.payload as Record<string, unknown>;
      return resto;
    });
    expect(JSON.stringify(semId)).not.toMatch(/price|cost|\b399\b|\b210\b/i);

    const outbox = t.app.get(MercadoflowOutbox);
    const agora = new Date(Date.now() + 10 * 60_000);
    await outbox.flush(agora);
    expect(contribuicoes).toHaveLength(1);
    // Recusado não volta: o próximo envio não manda nada deste cliente.
    await outbox.flush(new Date(agora.getTime() + 10 * 60_000));
    expect(contribuicoes).toHaveLength(1);
    itens = await fila(ctx);
    expect(itens.find((i) => i.dedupeKey === '78912342')).toMatchObject({ status: 'sent' });
    expect(itens.find((i) => i.dedupeKey === '7891000100103')).toMatchObject({
      status: 'rejected',
      lastError: 'Descrição muito curta',
    });

    // Só mudar o preço não manda nada de novo ao catálogo.
    await c.put(`/products/${criado.id}`, { ...(criado as object), priceCents: 449 });
    expect((await fila(ctx)).filter((i) => i.status === 'pending')).toEqual([]);
    // Mudar o nome manda de novo (e volta para a fila mesmo o que tinha sido recusado).
    await c.put(`/products/${criado.id}`, {
      ...(criado as object),
      name: 'Biscoito Recheado de Chocolate Marca X 130g',
    });
    expect((await fila(ctx)).filter((i) => i.status === 'pending')).toHaveLength(2);
  });

  it('a compra pelo XML mostra o que o catálogo sabe e cadastra o produto novo com nome, marca e caixa', async () => {
    const { c, ctx } = await dono();
    const [empresa] = (await c.get('/companies')).json();
    await c.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'SP',
    });
    const [loja] = (await c.get('/stores')).json();
    const xml = await notaDoFornecedor(5001, {
      items: [
        item({
          code: 'F-ACU',
          gtin: ACUCAR.gtin,
          description: 'ACUCAR REF UNIAO 1KG',
          unit: 'UN',
          quantityMilli: 10_000,
          unitPriceCents: 400,
          grossCents: 4000,
        }),
      ],
      payments: [{ code: '15', amountCents: 4000 }],
    });
    const previa = (await c.post('/purchases/preview', { xml })).json();
    expect(previa.items[0].catalog).toEqual({
      description: 'Açúcar União Refinado 1kg',
      brand: 'União',
      packageDescription: '1 kg',
    });
    const entrada = await c.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [{ line: 1, productId: null, priceCents: 599 }],
    });
    expect(entrada.statusCode).toBe(201);
    const [produto] = (await c.get(`/products?q=${ACUCAR.gtin}`)).json().items;
    expect(produto).toMatchObject({
      name: 'Açúcar União Refinado 1kg',
      priceCents: 599,
      catalog: { brand: 'União', manufacturer: 'Camil', department: 'Mercearia' },
      packs: [{ packGtin: '17891910000194', unitsPerPack: 10 }],
    });
    expect((await fila(ctx)).map((i) => i.dedupeKey)).toEqual([ACUCAR.gtin]);
  });
});

describe('catálogo com a integração desligada', () => {
  it('avisa que está desligado e responde "sem resposta", sem erro', async () => {
    const semMf = await createTestApp();
    try {
      const c = api(semMf.app, (await signup(semMf.app)).auth);
      expect((await c.get('/product-catalog/status')).json()).toEqual({ enabled: false });
      expect((await c.get(`/product-catalog/products/${ACUCAR.gtin}`)).json()).toMatchObject({
        found: false,
        reason: 'SEM_RESPOSTA',
      });
      expect((await c.get('/product-catalog/search?q=acucar')).json()).toEqual({ items: [] });
      expect(
        (await c.post('/product-catalog/lookup', { gtins: [ACUCAR.gtin] })).json().items[0].reason,
      ).toBe('SEM_RESPOSTA');
    } finally {
      await semMf.close();
    }
  });
});
