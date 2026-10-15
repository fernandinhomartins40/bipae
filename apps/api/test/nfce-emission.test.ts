import type { SyncPullResult, SyncPushResult, TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { brasiliaDateTime, buildSaleNfceContingency, signNfe } from '@bipae/fiscal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '../src/db/client';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SefazSimulator, SENHA_A1, testPfx } from './support/sefaz-simulator';

/** F3-14.b: a venda sincronizada vira NFC-e, emitida no servidor contra a SEFAZ simulada. */

let t: TestApp;
const sefaz = new SefazSimulator();
const pfxBase64 = testPfx();

beforeAll(async () => {
  await sefaz.start();
  t = await createTestApp();
  Object.assign(t.app.get(SefazService), { transport: sefaz.transport() });
});
afterAll(async () => {
  await t.close();
  await sefaz.stop();
});

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

/** Empresa e caixa prontos; `completa: false` deixa de fora a inscrição estadual e o endereço. */
/** `agora`: relógio do caixa (para simular a venda feita sem internet minutos antes). */
async function loja(completa = true, agora?: () => Date) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  const dados = await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Mercadinho Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'simples',
    ...(completa && {
      ie: '111.222.333.444',
      street: 'Rua das Flores',
      streetNumber: '100',
      district: 'Centro',
      cityCode: '3550308',
      cep: '01001-000',
    }),
  });
  expect(dados.statusCode).toBe(200);
  if (completa) {
    const cert = await admin.post(`/fiscal/certificates/${empresa.id}`, {
      pfxBase64,
      password: SENHA_A1,
    });
    expect(cert.statusCode).toBe(201);
  }
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
    priceCents: 2890,
    barcodes: ['7891000315507'],
    ncm: '10063021',
    fiscalProfileId: perfil.id,
  });
  const [store] = (await admin.get('/stores')).json();
  const caixa = (
    await admin.post('/terminals', { storeId: store.id, name: 'Caixa', platform: 'web' })
  ).json();
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  const pdv = new PdvService(storage, {
    terminalId: caixa.id,
    operatorId: dono.me.user.id,
    ...(agora && { now: agora }),
  });
  const sync = new SyncClient(storage, pdv, transport(dono.auth, caixa.id), caixa.id);
  await sync.sync();
  await pdv.openSession(0);
  /** `antesDeEnviar` mexe no evento da venda na outbox antes da sincronização. */
  const vender = async (
    cpf: string | null = null,
    antesDeEnviar?: (payload: Record<string, unknown>) => Promise<void>,
  ) => {
    const produto = (await pdv.findByCode('7891000315507'))!;
    const venda = await pdv.completeSale(
      { ...addItem(EMPTY_CART, produto, 2000), customerTaxId: cpf },
      [{ method: 'cash', receivedCents: 6000 }],
      { discountLimitPercent: 10 },
    );
    if (antesDeEnviar) {
      const [row] = await storage.query<{ seq: number; payload: string }>(
        "SELECT seq, payload FROM outbox WHERE sent_at IS NULL AND type = 'sale.completed' ORDER BY seq DESC LIMIT 1",
      );
      const event = JSON.parse(row!.payload) as { payload: Record<string, unknown> };
      await antesDeEnviar(event.payload);
      await storage.execute('UPDATE outbox SET payload = ? WHERE seq = ?', [
        JSON.stringify(event),
        row!.seq,
      ]);
    }
    expect((await sync.sync()).lastError).toBeNull();
    return venda;
  };
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  return { admin, empresa, caixa, vender, ctx, dono };
}

/** Espera a fila mexer na nota (a emissão roda em segundo plano). */
async function nota(admin: ReturnType<typeof api>, saleId: string, until: (s: string) => boolean) {
  for (let i = 0; i < 100; i++) {
    const doc = (await admin.get(`/sales/${saleId}/fiscal`)).json();
    if (doc && until(doc.status)) return doc;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('A nota não saiu do lugar.');
}

describe('emissão da NFC-e no servidor (F3-14.b)', () => {
  it('a venda sincronizada sai autorizada, com o XML autorizado para baixar', async () => {
    sefaz.mode = 'normal';
    const { admin, caixa, vender } = await loja();
    const venda = await vender('12345678909');
    const doc = await nota(admin, venda.id, (s) => s !== 'pending');
    expect(doc).toMatchObject({
      status: 'authorized',
      model: '65',
      series: caixa.nfceSeries,
      number: venda.terminalSeq,
      cStat: '100',
      protocol: '135260000999999',
      pendingItems: [],
    });
    expect(doc.accessKey).toMatch(/^35\d{42}$/);
    const xml = await admin.get(`/fiscal/documents/${doc.id}/xml`);
    expect(xml.headers['content-disposition']).toContain(`NFCe${doc.accessKey}.xml`);
    expect(xml.body).toContain('<nfeProc');
    expect(xml.body).toContain('<CPF>12345678909</CPF>');
    expect(xml.body).toContain('<protNFe');
    // Nota autorizada não volta para a fila.
    expect((await admin.post(`/fiscal/documents/${doc.id}/retry`)).statusCode).toBe(409);
  });

  it('o caixa recebe os dados do emitente e a série no retrato fiscal', async () => {
    const { caixa, dono } = await loja();
    const terminal = api(t.app, { ...dono.auth, 'x-bipae-terminal': caixa.id });
    const fiscal = (await terminal.get('/sync/pull?limit=1')).json().fiscal;
    expect(fiscal.issuer).toMatchObject({
      cnpj: '11222333000181',
      ie: '111222333444',
      nfceSeries: caixa.nfceSeries,
      address: { cityCode: '3550308', cityName: 'São Paulo', cep: '01001000' },
    });
  });

  it('a resposta se perde: a nova tentativa consulta pela chave e não autoriza duas vezes', async () => {
    sefaz.mode = 'perde';
    const { admin, vender } = await loja();
    const venda = await vender();
    const erro = await nota(admin, venda.id, (s) => s === 'error');
    expect(erro.lastError).toContain('SEFAZ');
    sefaz.mode = 'normal';
    // A fila tenta sozinha de novo; aqui a pessoa pede para não esperar.
    await admin.post(`/fiscal/documents/${erro.id}/retry`);
    const doc = await nota(admin, venda.id, (s) => s === 'authorized');
    const daChave = sefaz.calls.filter((c) => c.body.includes(doc.accessKey));
    expect(daChave.filter((c) => c.service === 'autorizacao')).toHaveLength(1);
    expect(daChave.some((c) => c.service === 'consulta')).toBe(true);
  });

  it('SEFAZ fora do ar: a varredura da manutenção põe a nota de volta na fila', async () => {
    sefaz.mode = 'fora';
    const { admin, vender, ctx } = await loja();
    const venda = await vender();
    const erro = await nota(admin, venda.id, (s) => s === 'error');
    sefaz.mode = 'normal';
    // Como se a falha tivesse sido há alguns minutos.
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(
        sql`update fiscal_documents set updated_at = now() - interval '5 minutes' where id = ${erro.id}`,
      ),
    );
    expect(await t.app.get(MaintenanceService).sweepNfce()).toBeGreaterThanOrEqual(1);
    expect((await nota(admin, venda.id, (s) => s === 'authorized')).status).toBe('authorized');
  });

  it('recusada pela SEFAZ mostra o motivo e pode ser enviada de novo', async () => {
    sefaz.mode = 'rejeita';
    const { admin, vender } = await loja();
    const venda = await vender();
    const recusada = await nota(admin, venda.id, (s) => s === 'rejected');
    expect(recusada).toMatchObject({
      cStat: '225',
      xMotivo: 'Rejeição: Falha no Schema XML da NFe',
    });
    // F3-18: a causa e o que fazer, em linguagem simples.
    expect(recusada.help).toMatchObject({
      cause: 'A nota tem um campo fora do formato oficial.',
      next: 'suporte',
    });
    sefaz.mode = 'normal';
    const depois = (await admin.post(`/fiscal/documents/${recusada.id}/retry`)).json();
    expect(depois.status).toBe('authorized');
    expect(depois.accessKey).toBe(recusada.accessKey);
  });

  it('venda que chega depois dos 5 minutos sai em contingência (tpEmis 9) e é autorizada', async () => {
    sefaz.mode = 'normal';
    const { admin, vender } = await loja(true, () => new Date(Date.now() - 10 * 60_000));
    const venda = await vender();
    const doc = await nota(admin, venda.id, (s) => s !== 'pending');
    expect(doc).toMatchObject({ status: 'authorized', contingency: true });
    expect(doc.accessKey[34]).toBe('9');
    const xml = (await admin.get(`/fiscal/documents/${doc.id}/xml`)).body;
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain(
      '<xJust>Venda registrada sem conexão com a internet; NFC-e transmitida ao reconectar</xJust>',
    );
  });

  it('a NFC-e que o caixa assinou em contingência é transmitida como veio', async () => {
    sefaz.mode = 'normal';
    const { admin, vender } = await loja();
    const chaves = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-1',
      },
      false,
      ['sign', 'verify'],
    )) as { privateKey: Parameters<typeof crypto.subtle.sign>[1] };
    const chave = { privateKey: chaves.privateKey, certificate: 'AAAA' };
    let enviada = { accessKey: '', xml: '' };
    const venda = await vender(null, async (payload) => {
      const r = await buildSaleNfceContingency(
        {
          saleId: payload.saleId as string,
          company: {
            cnpj: '11222333000181',
            legalName: 'Mercadinho Bipaê LTDA',
            ie: '111222333444',
            uf: 'SP',
            regime: 'simples',
            address: {
              street: 'Rua das Flores',
              number: '100',
              district: 'Centro',
              cityCode: '3550308',
              cityName: 'São Paulo',
              cep: '01001000',
            },
          },
          series: 1,
          terminalSeq: payload.terminalSeq as number,
          occurredAt: new Date().toISOString(),
          items: [
            {
              code: 'ARROZ',
              barcodes: [],
              description: 'Arroz tipo 1 5kg',
              ncm: '10063021',
              unit: 'UN',
              quantityMilli: 2000,
              unitPriceCents: 2890,
              grossCents: 5780,
              discountCents: 0,
              profile: { cfopInterna: '5102', cfopInterestadual: '6102', csosn: '102' },
            },
          ],
          payments: [{ method: 'cash', amountCents: 5780, changeCents: 220 }],
          appVersion: 'Bipaê caixa',
        },
        {
          enteredAt: brasiliaDateTime(new Date().toISOString()),
          reason: 'Caixa sem conexão com a internet',
        },
        chave,
      );
      if (!r.ok) throw new Error(r.pending.join('; '));
      enviada = { accessKey: r.document.accessKey, xml: await signNfe(r.document.xml, chave) };
      payload.nfce = enviada;
    });
    const doc = await nota(admin, venda.id, (s) => s !== 'pending');
    expect(doc).toMatchObject({
      status: 'authorized',
      contingency: true,
      accessKey: enviada.accessKey,
    });
    // O servidor mandou o XML do caixa, sem montar outro.
    const daChave = sefaz.calls.filter(
      (call) => call.service === 'autorizacao' && call.body.includes(enviada.accessKey),
    );
    expect(daChave).toHaveLength(1);
    expect(daChave[0]!.body).toContain('<xJust>Caixa sem conexão com a internet</xJust>');
  });

  it('empresa sem os dados do emitente: "falta configurar", com a lista, sem ir à SEFAZ', async () => {
    sefaz.mode = 'normal';
    const antes = sefaz.calls.length;
    const { admin, vender } = await loja(false);
    const venda = await vender();
    const doc = await nota(admin, venda.id, (s) => s !== 'pending');
    expect(doc.status).toBe('not_configured');
    expect(doc.pendingItems).toEqual(
      expect.arrayContaining([
        'Falta a inscrição estadual da empresa (Empresas e lojas).',
        'Falta o município da empresa (Empresas e lojas).',
      ]),
    );
    expect(sefaz.calls.length).toBe(antes);
    const lista = (await admin.get('/fiscal/documents?status=not_configured')).json();
    expect(lista.map((d: { id: string }) => d.id)).toEqual([doc.id]);
  });

  it('o município precisa ser da tabela do IBGE e da UF da empresa', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    const errado = await admin.patch(`/companies/${empresa.id}`, {
      legalName: 'Empresa X',
      uf: 'PR',
      cityCode: '3550308',
    });
    expect(errado.json().message).toBe('São Paulo não fica em PR: confira a UF ou o município.');
    expect(
      (
        await admin.patch(`/companies/${empresa.id}`, {
          legalName: 'Empresa X',
          nfcePaymentCodes: { pix: '01' },
        })
      ).statusCode,
    ).toBe(422);
  });
});
