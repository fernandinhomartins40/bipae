import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@bipae/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { mercadoflowLinks, productPacks } from '../src/db/schema';
import { signWebhook } from '../src/modules/mercadoflow/mercadoflow.webhook';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** MF-09: Confere dentro do Bipaê, contra um MercadoFlow simulado. */

const SEGREDO = 'whsec_confere';
const CHAVE = '41261012345678000199550010000123451000012345';
let mf: Server;
let t: TestApp;
const recebidos: { method: string; path: string; body: Record<string, unknown> | null }[] = [];

/** Entrada pronta (seção 6.4): 4 itens, cada um achado por um caminho diferente. */
function entrada(checkId: string, recebido1 = 90) {
  return {
    documentId: 'doc1',
    accessKey: CHAVE,
    number: '12345',
    series: '1',
    supplierCnpj: '12345678000199',
    supplierName: 'Distribuidora X',
    issuedAt: '2026-10-10T08:00:00',
    checkStatus: 'CONCLUIDA',
    checkId,
    items: [
      {
        item: 1,
        gtin: '7894900010015',
        packGtin: '7894900010220',
        supplierCode: '55406',
        description: 'Refrigerante Coca-Cola Lata 350ml',
        invoiceUnit: 'CX',
        invoiceQuantity: 16,
        unitsPerPack: 6,
        expectedUnits: 96,
        receivedUnits: recebido1,
        unitCost: 2.516979,
        divergence: 'AVARIA',
      },
      {
        item: 2,
        gtin: '7891000055120',
        packGtin: '17891000055127',
        supplierCode: '77',
        description: 'Leite em pó 400g',
        expectedUnits: 12,
        receivedUnits: 12,
        unitCost: 15.9,
      },
      {
        item: 3,
        gtin: null,
        packGtin: null,
        supplierCode: 'BAN-01',
        description: 'Bandeja de ovos',
        expectedUnits: 10,
        receivedUnits: 10,
        unitCost: 0.75,
      },
      {
        item: 4,
        gtin: '7896004000015',
        packGtin: null,
        supplierCode: 'NOVO',
        description: 'Produto que a loja ainda não tem',
        expectedUnits: 5,
        receivedUnits: 5,
        unitCost: 3,
      },
    ],
  };
}
let entradaAtual = entrada('chk1');

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
      if (path === '/oauth/token') return send(200, { access_token: 'mfp_conf', expires_in: 3600 });
      recebidos.push({ method: req.method ?? '', path, body });
      const base = '/markets/mk_conf/confere';
      if (path === `${base}/status`)
        return send(200, {
          enabled: true,
          termsAccepted: false,
          termsVersion: 'v1',
          termsText: 'Termos',
          balance: 10,
          certificate: null,
        });
      if (path === `${base}/certificate`) {
        if (body?.password !== 'certa')
          return send(400, { erro: 'Senha do certificado incorreta.' });
        return send(200, { cnpj: '11222333000181', holder: 'MERCADO', notAfter: '2027-10-01' });
      }
      if (path === `${base}/read`)
        return send(200, {
          documentId: 'doc1',
          accessKey: body?.accessKey,
          source: 'SEFAZ',
          charged: true,
          balance: 9,
        });
      if (path === `${base}/documents`)
        return send(200, {
          items: [
            {
              id: 'doc1',
              accessKey: CHAVE,
              completeness: 'FULL',
              emitterName: 'Distribuidora X',
              checkStatus: 'DONE',
            },
          ],
        });
      if (path === `${base}/documents/doc1/check`)
        return send(200, {
          check: { id: 'chk1', status: body?.finish ? 'CONCLUIDA' : 'EM_ANDAMENTO' },
          entry: entradaAtual,
        });
      if (path === `${base}/documents/doc1/entry`) return send(200, entradaAtual);
      return send(404, { erro: 'não existe' });
    });
  });
  await new Promise<void>((ok) => mf.listen(0, '127.0.0.1', () => ok()));
  t = await createTestApp({
    MERCADOFLOW_API_URL: `http://127.0.0.1:${(mf.address() as AddressInfo).port}/api/v1/partner`,
    MERCADOFLOW_CLIENT_ID: 'bipae',
    MERCADOFLOW_CLIENT_SECRET: 'segredo',
    MERCADOFLOW_WEBHOOK_SECRET: SEGREDO,
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => mf.close(ok));
});
beforeEach(() => {
  recebidos.length = 0;
});

async function lojaVinculada(vincular = true) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  const [empresa] = (await admin.get('/companies')).json();
  const [store] = (await admin.get('/stores')).json();
  if (vincular) {
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(mercadoflowLinks).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: store.id,
        marketId: 'mk_conf',
        status: 'ATIVA',
        createdVia: 'ACCOUNT',
        scopes: ['confere:use'],
      }),
    );
  }
  // O cadastro de teste usa o nome "Dono N".
  return { admin, store, ctx, nome: expect.stringMatching(/^Dono \d+$/) as unknown as string };
}

const saldo = async (admin: ReturnType<typeof api>, ids: string[]) => {
  const linhas = (
    await admin.get(`/stock?${ids.map((id) => `productId=${id}`).join('&')}`)
  ).json() as { productId: string; quantityMilli: number }[];
  return Object.fromEntries(
    ids.map((id) => [id, linhas.find((l) => l.productId === id)?.quantityMilli ?? 0]),
  );
};

describe('Confere no Bipaê (MF-09)', () => {
  it('sem vínculo pede para ativar; com vínculo repassa ao MercadoFlow com o nome de quem fez', async () => {
    const semVinculo = await lojaVinculada(false);
    const r = await semVinculo.admin.get(`/mercadoflow/confere/${semVinculo.store.id}/status`);
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe(
      'Ative o Confere: vincule esta loja ao MercadoFlow em Configurações → MercadoFlow.',
    );

    const { admin, store, nome } = await lojaVinculada();
    expect((await admin.get(`/mercadoflow/confere/${store.id}/status`)).json()).toMatchObject({
      enabled: true,
      balance: 10,
    });
    const lida = await admin.post(`/mercadoflow/confere/${store.id}/read`, { accessKey: CHAVE });
    expect(lida.json()).toMatchObject({ documentId: 'doc1', charged: true });
    expect(recebidos.at(-1)).toMatchObject({
      method: 'POST',
      path: '/markets/mk_conf/confere/read',
      body: { accessKey: CHAVE, actor: nome },
    });
    expect(
      (await admin.post(`/mercadoflow/confere/${store.id}/read`, { accessKey: '123' })).json()
        .message,
    ).toBe('A chave de acesso tem 44 números');

    await admin.put(`/mercadoflow/confere/${store.id}/documents/doc1/check`, {
      counts: { '1': { counted: 16 }, '2': { counted: 11, issue: 'AVARIA', note: '2 amassadas' } },
      blind: true,
    });
    expect(recebidos.at(-1)).toMatchObject({
      method: 'PUT',
      body: { counts: { '1': { counted: 16 } }, blind: true, finish: false, actor: nome },
    });
  });

  it('o certificado vai direto ao MercadoFlow e os erros dele aparecem para o usuário', async () => {
    const { admin, store } = await lojaVinculada();
    const pfx = Buffer.from('x'.repeat(200)).toString('base64');
    const errada = await admin.post(`/mercadoflow/confere/${store.id}/certificate`, {
      pfxBase64: pfx,
      password: 'errada',
      uf: 'pr',
    });
    expect(errada.statusCode).toBe(400);
    expect(errada.json().message).toBe('Senha do certificado incorreta.');
    const certa = await admin.post(`/mercadoflow/confere/${store.id}/certificate`, {
      pfxBase64: pfx,
      password: 'certa',
      uf: 'pr',
    });
    expect(certa.json()).toMatchObject({ holder: 'MERCADO' });
    expect(recebidos.at(-1)?.body).toMatchObject({ uf: 'PR' });
  });

  it('dá entrada: acha pelo GTIN, pela caixa e pelo código do fornecedor; produto novo espera; uma vez só', async () => {
    const { admin, store, ctx } = await lojaVinculada();
    const coca = (
      await admin.post('/products', {
        name: 'Coca-Cola Lata 350ml',
        priceCents: 450,
        barcodes: ['7894900010015'],
      })
    ).json();
    const leite = (
      await admin.post('/products', { name: 'Leite em pó 400g', priceCents: 2290 })
    ).json();
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(productPacks).values({
        tenantId: ctx.tenantId,
        packGtin: '17891000055127',
        productId: leite.id,
        unitsPerPack: 12,
      }),
    );
    const ovos = (await admin.post('/products', { name: 'Ovos bandeja', priceCents: 1290 })).json();
    const novo = (await admin.post('/products', { name: 'Produto novo', priceCents: 500 })).json();
    entradaAtual = entrada('chk1');

    // Primeira vez: ovos (só código do fornecedor) e o item 4 ainda não têm produto.
    const primeira = (
      await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {})
    ).json();
    expect(primeira).toMatchObject({ status: 'needs_products', applied: 0 });
    expect(primeira.missing.map((m: { item: number }) => m.item)).toEqual([3, 4]);

    // A tela associa os dois; o Bipaê aprende o código do fornecedor.
    const feita = (
      await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {
        mapping: { '3': ovos.id, '4': novo.id },
      })
    ).json();
    expect(feita).toEqual({ status: 'applied', missing: [], applied: 4 });
    expect(await saldo(admin, [coca.id, leite.id, ovos.id, novo.id])).toEqual({
      [coca.id]: 90_000,
      [leite.id]: 12_000,
      [ovos.id]: 10_000,
      [novo.id]: 5000,
    });
    expect((await admin.get(`/products/${coca.id}`)).json().costCents).toBe(252);

    // Mesma conferência de novo: nada muda.
    expect(
      (await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {})).json().status,
    ).toBe('already_applied');
    expect((await saldo(admin, [coca.id]))[coca.id]).toBe(90_000);

    // Conferência refeita: lança só a diferença (90 → 96).
    entradaAtual = entrada('chk2', 96);
    expect(
      (await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {})).json().status,
    ).toBe('applied');
    expect(await saldo(admin, [coca.id, ovos.id])).toEqual({
      [coca.id]: 96_000,
      [ovos.id]: 10_000,
    });

    // Fornecedor criado e pendências com ele (falta e avaria do item 1).
    const fornecedores = (await admin.get('/suppliers')).json();
    expect(JSON.stringify(fornecedores)).toContain('12345678000199');
    const pendencias = (await admin.get('/mercadoflow/supplier-issues')).json() as {
      id: string;
      kind: string;
      item: number;
      status: string;
    }[];
    expect(
      pendencias
        .filter((p) => p.item === 1)
        .map((p) => p.kind)
        .sort(),
    ).toEqual(['AVARIA', 'FALTA']);
    await admin.post(`/mercadoflow/supplier-issues/${pendencias[0]!.id}/resolve`, {
      note: 'Crédito recebido',
    });
    expect(
      ((await admin.get('/mercadoflow/supplier-issues')).json() as { status: string }[]).filter(
        (p) => p.status === 'resolvida',
      ),
    ).toHaveLength(1);

    const notas = (await admin.get(`/mercadoflow/confere/${store.id}/documents`)).json();
    expect(notas.items).toHaveLength(1);
    expect(
      notas.entries.map((e: { checkId: string; status: string }) => [e.checkId, e.status]).sort(),
    ).toEqual([
      ['chk1', 'applied'],
      ['chk2', 'applied'],
    ]);
  });

  it('conferência concluída em outro aparelho: o aviso do MercadoFlow dá entrada sozinho', async () => {
    const { admin, store, ctx } = await lojaVinculada();
    // Mercado só desta loja: o aviso chega pelo id do mercado.
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx
        .update(mercadoflowLinks)
        .set({ marketId: 'mk_aviso' })
        .where(eq(mercadoflowLinks.storeId, store.id)),
    );
    const coca = (
      await admin.post('/products', {
        name: 'Coca-Cola Lata',
        priceCents: 450,
        barcodes: ['7894900010015'],
      })
    ).json();
    const so1 = { ...entrada('chk-web'), items: [entrada('chk-web').items[0]!] };
    const evento = JSON.stringify({
      event: 'confere.check.finished',
      marketId: 'mk_aviso',
      data: { entry: so1 },
    });
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/integrations/mercadoflow/webhook',
      headers: {
        'content-type': 'application/json',
        'x-mercadoflow-signature': signWebhook(evento, SEGREDO),
        'x-mercadoflow-delivery': `fin-${store.id}`,
      },
      payload: evento,
    });
    expect(r.statusCode).toBe(200);
    expect((await saldo(admin, [coca.id]))[coca.id]).toBe(90_000);
    const auditoria = JSON.stringify(
      (await admin.get('/audit?action=confere.entry_applied')).json(),
    );
    expect(auditoria).toContain('confere.entry_applied');
  });

  it('nota sem conferência concluída só entra pela entrada direta', async () => {
    const { admin, store } = await lojaVinculada();
    await admin.post('/products', { name: 'Coca', priceCents: 450, barcodes: ['7894900010015'] });
    entradaAtual = {
      ...entrada('x'),
      checkStatus: 'NAO_INICIADA',
      checkId: null as unknown as string,
      items: [entrada('x').items[0]!],
    };
    const pendente = await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {});
    expect(pendente.json().message).toBe(
      'Conclua a conferência antes de dar entrada (ou use a entrada direta pela nota).',
    );
    const direta = await admin.post(`/mercadoflow/confere/${store.id}/documents/doc1/entry`, {
      direct: true,
    });
    expect(direta.json()).toMatchObject({ status: 'applied', applied: 1 });
  });
});

describe('vínculo sem permissão do Confere', () => {
  it('explica que o vínculo não autoriza o Confere', async () => {
    const { admin, store, ctx } = await lojaVinculada(false);
    const [empresa] = (await admin.get('/companies')).json();
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(mercadoflowLinks).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        companyId: empresa.id,
        storeId: store.id,
        marketId: 'mk_x',
        status: 'ATIVA',
        createdVia: 'CONNECT',
        scopes: ['sales:write'],
      }),
    );
    const r = await admin.get(`/mercadoflow/confere/${store.id}/status`);
    expect(r.statusCode).toBe(403);
    expect(
      await withTenant(t.database.db, ctx as never, (tx) =>
        tx.select().from(mercadoflowLinks).where(eq(mercadoflowLinks.storeId, store.id)),
      ),
    ).toHaveLength(1);
  });
});

describe('aviso de nota chegando (MF-14)', () => {
  it('guarda o aviso uma vez, conta no menu e zera quando a tela abre', async () => {
    const { admin, store, ctx } = await lojaVinculada();
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx
        .update(mercadoflowLinks)
        .set({ marketId: 'mk_nota' })
        .where(eq(mercadoflowLinks.storeId, store.id)),
    );
    const evento = JSON.stringify({
      event: 'confere.document.received',
      marketId: 'mk_nota',
      data: {
        documentId: 'doc-novo',
        accessKey: CHAVE,
        supplierName: 'Distribuidora X',
        number: '12345',
        issuedAt: '2026-10-14T08:00:00-03:00',
        totalValue: 1834.5,
        itemsCount: 12,
      },
    });
    const avisar = (entrega: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/integrations/mercadoflow/webhook',
        headers: {
          'content-type': 'application/json',
          'x-mercadoflow-signature': signWebhook(evento, SEGREDO),
          'x-mercadoflow-delivery': entrega,
        },
        payload: evento,
      });
    expect((await avisar(`nota-${store.id}-1`)).statusCode).toBe(200);
    // O MercadoFlow pode mandar o mesmo documento de novo (outra entrega): não duplica.
    expect((await avisar(`nota-${store.id}-2`)).statusCode).toBe(200);

    const avisos = (await admin.get('/mercadoflow/confere-notices')).json();
    expect(avisos.unseen).toBe(1);
    expect(avisos.items).toEqual([
      expect.objectContaining({
        storeId: store.id,
        supplierName: 'Distribuidora X',
        totalCents: 183450,
        itemsCount: 12,
      }),
    ]);

    // Outro cliente não vê o aviso.
    const outro = await lojaVinculada(false);
    expect((await outro.admin.get('/mercadoflow/confere-notices')).json().unseen).toBe(0);

    expect((await admin.post(`/mercadoflow/confere/${store.id}/notices/seen`, {})).statusCode).toBe(
      201,
    );
    expect((await admin.get('/mercadoflow/confere-notices')).json().unseen).toBe(0);
  });
});
