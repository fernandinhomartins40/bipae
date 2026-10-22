import { inflateRawSync } from 'node:zlib';
import { uuidv7, type SyncPullResult, type SyncPushResult, type TerminalEvent } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { addItem, EMPTY_CART, PdvService } from '@bipae/pdv-core';
import { SyncClient, type SyncTransport } from '@bipae/sync';
import { brasiliaDateTime, buildSaleNfceContingency, signNfe } from '@bipae/fiscal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '../src/db/client';
import { stockMovements } from '../src/db/schema';
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
  return { admin, empresa, caixa, vender, ctx, dono, pdv, sync };
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

/** Espera o cancelamento da nota sair do lugar (roda em segundo plano). */
async function cancelamento(
  admin: ReturnType<typeof api>,
  saleId: string,
  until: (doc: { status: string; cancellation: { status: string } | null }) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const doc = (await admin.get(`/sales/${saleId}/fiscal`)).json();
    if (doc && until(doc)) return doc;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('O cancelamento não saiu do lugar.');
}

describe('cancelamento da NFC-e e inutilização (F3-17.b)', () => {
  it('venda cancelada no caixa cancela a nota autorizada na SEFAZ', async () => {
    sefaz.mode = 'normal';
    const { admin, vender, pdv, sync } = await loja();
    const venda = await vender();
    const autorizada = await nota(admin, venda.id, (s) => s === 'authorized');
    await pdv.cancelSale(venda.id, 'Cliente desistiu', null);
    expect((await sync.sync()).lastError).toBeNull();
    const doc = await cancelamento(admin, venda.id, (d) => d.status === 'cancelled');
    expect(doc.cancellation).toMatchObject({
      status: 'registered',
      cStat: '135',
      protocol: '135260000888888',
      reason: 'Venda cancelada no caixa: Cliente desistiu',
    });
    const evento = sefaz.calls.find(
      (c) => c.service === 'evento' && c.body.includes(autorizada.accessKey),
    );
    expect(evento?.body).toContain('<tpEvento>110111</tpEvento>');
    expect(evento?.body).toContain(`<nProt>${autorizada.protocol}</nProt>`);
    expect(evento?.body).toContain('<Signature');
    // Nota cancelada não volta para a fila.
    expect((await admin.post(`/fiscal/documents/${doc.id}/retry`)).statusCode).toBe(409);
  });

  it('fora do prazo a SEFAZ recusa: a nota continua valendo e a tela explica o que fazer', async () => {
    sefaz.mode = 'prazo';
    const { admin, vender, pdv, sync } = await loja();
    const venda = await vender();
    await nota(admin, venda.id, (s) => s === 'authorized');
    await pdv.cancelSale(venda.id, 'Cliente desistiu', null);
    await sync.sync();
    const doc = await cancelamento(admin, venda.id, (d) => d.cancellation?.status === 'rejected');
    expect(doc.status).toBe('authorized');
    expect(doc.cancellation).toMatchObject({ cStat: '501', help: { next: 'suporte' } });
    expect(doc.cancellation.help.fix).toContain('devolução');
    sefaz.mode = 'normal';
  });

  it('venda cancelada antes de a nota sair: a nota não é emitida e não vai à SEFAZ', async () => {
    sefaz.mode = 'normal';
    const { admin, vender, pdv, sync } = await loja(false);
    const venda = await vender();
    await nota(admin, venda.id, (s) => s === 'not_configured');
    const antes = sefaz.calls.length;
    await pdv.cancelSale(venda.id, 'Erro no item', null);
    await sync.sync();
    const doc = await cancelamento(admin, venda.id, (d) => d.status === 'voided');
    expect(doc.cancellation).toBeNull();
    expect(sefaz.calls.length).toBe(antes);
    expect((await admin.post(`/fiscal/documents/${doc.id}/retry`)).statusCode).toBe(409);
  });

  it('a resposta da autorização se perdeu: consulta pela chave e cancela a nota autorizada', async () => {
    sefaz.mode = 'perde';
    const { admin, vender, pdv, sync } = await loja();
    const venda = await vender();
    const erro = await nota(admin, venda.id, (s) => s === 'error');
    sefaz.mode = 'normal';
    await pdv.cancelSale(venda.id, 'Cliente desistiu', null);
    await sync.sync();
    const doc = await cancelamento(admin, venda.id, (d) => d.status === 'cancelled');
    expect(doc.protocol).toBe('135260000999999');
    const daChave = sefaz.calls.filter((c) => c.body.includes(erro.accessKey));
    // Uma autorização só (a que se perdeu), a consulta e o cancelamento.
    expect(daChave.filter((c) => c.service === 'autorizacao')).toHaveLength(1);
    expect(daChave.some((c) => c.service === 'consulta')).toBe(true);
    expect(daChave.some((c) => c.service === 'evento')).toBe(true);
  });

  it('número que ficou sem nota (devolução) aparece como buraco e é inutilizado', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, caixa, vender, pdv, sync } = await loja();
    const primeira = await vender();
    await nota(admin, primeira.id, (s) => s === 'authorized');
    // A devolução usa o número seguinte do caixa e não vira NFC-e.
    await pdv.returnItems(primeira.id, [{ line: 1, quantityMilli: 1000 }], 'cash', 'Defeito');
    await sync.sync();
    const terceira = await vender();
    await nota(admin, terceira.id, (s) => s === 'authorized');
    const buraco = primeira.terminalSeq + 1;

    const gaps = (await admin.get(`/fiscal/inutilizations/gaps?companyId=${empresa.id}`)).json();
    expect(gaps).toEqual([{ model: '65', series: caixa.nfceSeries, from: buraco, to: buraco }]);

    // Número com nota não se inutiliza.
    const comNota = await admin.post('/fiscal/inutilizations', {
      companyId: empresa.id,
      series: caixa.nfceSeries,
      from: primeira.terminalSeq,
      to: buraco,
      reason: 'Número usado em devolução, sem NFC-e',
    });
    expect(comNota.statusCode).toBe(409);
    expect(comNota.json().message).toContain(`O número ${primeira.terminalSeq}`);
    expect(
      (
        await admin.post('/fiscal/inutilizations', {
          companyId: empresa.id,
          series: caixa.nfceSeries,
          from: buraco,
          to: buraco,
          reason: 'curta',
        })
      ).json().message,
    ).toBe('A justificativa precisa ter pelo menos 15 caracteres.');

    const feita = await admin.post('/fiscal/inutilizations', {
      companyId: empresa.id,
      series: caixa.nfceSeries,
      from: buraco,
      to: buraco,
      reason: 'Número usado em devolução, sem NFC-e',
    });
    expect(feita.statusCode).toBe(201);
    expect(feita.json()).toMatchObject({
      status: 'registered',
      cStat: '102',
      protocol: '135260000777777',
      from: buraco,
      to: buraco,
    });
    const pedido = sefaz.calls.filter((c) => c.service === 'inutilizacao').at(-1)!;
    expect(pedido.body).toContain('<xServ>INUTILIZAR</xServ>');
    expect(pedido.body).toContain(`<nNFIni>${buraco}</nNFIni>`);
    expect(pedido.body).toContain('<Signature');
    expect((await admin.get(`/fiscal/inutilizations/gaps?companyId=${empresa.id}`)).json()).toEqual(
      [],
    );
    expect((await admin.get(`/fiscal/inutilizations?companyId=${empresa.id}`)).json()).toHaveLength(
      1,
    );
    // Ação fiscal sensível fica na trilha de auditoria.
    const trilha = (await admin.get('/audit')).json();
    expect(JSON.stringify(trilha)).toContain('fiscal.inutilization');
  });

  it('SEFAZ fora do ar no cancelamento: a varredura da manutenção tenta de novo', async () => {
    sefaz.mode = 'normal';
    const { admin, vender, pdv, sync, ctx } = await loja();
    const venda = await vender();
    await nota(admin, venda.id, (s) => s === 'authorized');
    sefaz.mode = 'fora';
    await pdv.cancelSale(venda.id, 'Cliente desistiu', null);
    await sync.sync();
    const falhou = await cancelamento(admin, venda.id, (d) => d.cancellation?.status === 'error');
    expect(falhou.status).toBe('authorized');
    sefaz.mode = 'normal';
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(
        sql`update fiscal_documents set updated_at = now() - interval '5 minutes' where id = ${falhou.id}`,
      ),
    );
    expect(await t.app.get(MaintenanceService).sweepNfce()).toBeGreaterThanOrEqual(1);
    const doc = await cancelamento(admin, venda.id, (d) => d.status === 'cancelled');
    expect(doc.cancellation.status).toBe('registered');
  });

  it('a SEFAZ recusa a inutilização: fica registrada a recusa com a explicação', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, caixa } = await loja();
    sefaz.mode = 'rejeita';
    const recusada = (
      await admin.post('/fiscal/inutilizations', {
        companyId: empresa.id,
        series: caixa.nfceSeries,
        from: 50,
        to: 60,
        reason: 'Números pulados por erro do caixa',
      })
    ).json();
    sefaz.mode = 'normal';
    expect(recusada).toMatchObject({
      status: 'rejected',
      cStat: '241',
      help: { next: 'corrigir' },
    });
  });
});

describe('pacote do mês para o contador (F4-14.a)', () => {
  /** Lê o ZIP gerado (método deflate, sem pastas). */
  function unzip(zip: Buffer) {
    const files: Record<string, string> = {};
    let at = 0;
    while (zip.readUInt32LE(at) === 0x04034b50) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
      const start = at + 30 + nameLength;
      files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
      at = start + size;
    }
    return files;
  }

  it('traz as NFC-e autorizadas, o cancelamento, a inutilização e o resumo em CSV', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, caixa, vender, pdv, sync } = await loja();
    const primeira = await vender('12345678909');
    const a = await nota(admin, primeira.id, (s) => s === 'authorized');
    await pdv.returnItems(primeira.id, [{ line: 1, quantityMilli: 1000 }], 'cash', 'Defeito');
    await sync.sync();
    const segunda = await vender();
    const b = await nota(admin, segunda.id, (s) => s === 'authorized');
    await pdv.cancelSale(segunda.id, 'Cliente desistiu', null);
    await sync.sync();
    await cancelamento(admin, segunda.id, (d) => d.status === 'cancelled');
    const buraco = primeira.terminalSeq + 1;
    await admin.post('/fiscal/inutilizations', {
      companyId: empresa.id,
      series: caixa.nfceSeries,
      from: buraco,
      to: buraco,
      reason: 'Número usado em devolução, sem NFC-e',
    });

    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const res = await admin.get(`/fiscal/accountant-export?companyId=${empresa.id}&month=${mes}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(
      `bipae-contador-11222333000181-${mes}.zip`,
    );
    const files = unzip(res.rawPayload);
    expect(Object.keys(files).sort()).toEqual(
      [
        `Eventos/${b.accessKey}-cancelamento.xml`,
        `Inutilizacoes/serie${caixa.nfceSeries}-${buraco}-a-${buraco}.xml`,
        `NFCe/${a.accessKey}-procNFCe.xml`,
        `NFCe/${b.accessKey}-procNFCe.xml`,
        'resumo.csv',
      ].sort(),
    );
    expect(files[`NFCe/${a.accessKey}-procNFCe.xml`]).toContain('<nfeProc');
    expect(files[`Eventos/${b.accessKey}-cancelamento.xml`]).toContain('<procEventoNFe');
    expect(files[`Inutilizacoes/serie${caixa.nfceSeries}-${buraco}-a-${buraco}.xml`]).toContain(
      '<procInutNFe',
    );
    const linhas = files['resumo.csv']!.replace('﻿', '').trim().split('\r\n');
    expect(linhas[0]).toBe(
      'chave;modelo;serie;numero;emissao;situacao;valor;protocolo;protocolo_cancelamento',
    );
    expect(linhas).toContainEqual(
      expect.stringMatching(new RegExp(`^${a.accessKey};65;.*;Autorizada;57,80;135260000999999;$`)),
    );
    expect(linhas).toContainEqual(
      expect.stringMatching(
        new RegExp(`^${b.accessKey};65;.*;Cancelada;57,80;135260000999999;135260000888888$`),
      ),
    );
    // Mês sem movimento: só o resumo, com o cabeçalho.
    const vazio = unzip(
      (await admin.get(`/fiscal/accountant-export?companyId=${empresa.id}&month=2020-01`))
        .rawPayload,
    );
    expect(Object.keys(vazio)).toEqual(['resumo.csv']);
    expect(
      (await admin.get(`/fiscal/accountant-export?companyId=${empresa.id}&month=2026-13`)).json()
        .message,
    ).toBe('Mês inválido (use AAAA-MM)');
  });
});

describe('arquivo da EFD ICMS/IPI do mês (F4-14.b.3)', () => {
  it('configura o contador e o vencimento, confere a apuração e baixa o arquivo', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, vender } = await loja();
    const venda = await vender();
    const a = await nota(admin, venda.id, (s) => s === 'authorized');
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const q = `companyId=${empresa.id}&month=${mes}`;

    // Sem configuração: perfil A e o aviso do contador que falta.
    expect((await admin.get(`/fiscal/efd/settings?companyId=${empresa.id}`)).json()).toMatchObject({
      profile: 'A',
      accountantName: null,
    });
    const antes = (await admin.get(`/fiscal/efd/summary?${q}`)).json();
    expect(antes.documents).toBe(1);
    expect(antes.warnings.join(' ')).toMatch(/contador responsável/);

    const ruim = await admin.put('/fiscal/efd/settings', {
      companyId: empresa.id,
      accountantName: 'Contábil Exemplo',
      accountantCpf: '123.456.789-00',
    });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().issues[0].path).toBe('accountantCpf');
    const salvo = await admin.put('/fiscal/efd/settings', {
      companyId: empresa.id,
      profile: 'B',
      accountantName: 'Contábil Exemplo',
      accountantCpf: '529.982.247-25',
      accountantCrc: 'SP123456',
      icmsDueDay: 31,
      icmsRevenueCode: '046-2',
    });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json()).toMatchObject({ profile: 'B', accountantCpf: '52998224725' });

    const resumo = (await admin.get(`/fiscal/efd/summary?${q}&previousCreditCents=0`)).json();
    expect(resumo.warnings.join(' ')).not.toMatch(/contador responsável/);
    expect(resumo.fileName).toBe(`EFD-ICMS-IPI-11222333000181-${mes}.txt`);

    const arquivo = await admin.get(`/fiscal/efd/file?${q}`);
    expect(arquivo.statusCode).toBe(200);
    expect(arquivo.headers['content-type']).toContain('iso-8859-1');
    expect(arquivo.headers['content-disposition']).toContain(resumo.fileName);
    const linhas = arquivo.rawPayload
      .toString('latin1')
      .split('\r\n')
      .filter(Boolean)
      .map((l) => l.slice(1, -1).split('|'));
    expect(linhas[0]![0]).toBe('0000');
    expect(linhas[0]![13]).toBe('B'); // perfil
    expect(linhas.find((l) => l[0] === '0100')!.slice(1, 4)).toEqual([
      'Contábil Exemplo',
      '52998224725',
      'SP123456',
    ]);
    expect(linhas.find((l) => l[0] === 'C100')![8]).toBe(a.accessKey);
    expect(linhas.at(-1)).toEqual(['9999', String(linhas.length)]);
    const e110 = linhas.find((l) => l[0] === 'E110')!;
    const centavos = (v: string) => Number(v.replace(',', ''));
    expect(centavos(e110[1]!)).toBe(resumo.settlement.debitsCents);
    if (resumo.settlement.dueCents > 0) {
      // Vencimento no dia 31 do mês seguinte vira o último dia dele.
      const e116 = linhas.find((l) => l[0] === 'E116')!;
      expect(e116[3]).toMatch(/^(28|29|30|31)\d{6}$/);
      expect(e116[4]).toBe('046-2');
    }
    const audit = JSON.stringify((await admin.get('/audit?limit=10')).json());
    expect(audit).toContain('fiscal.efd_export');
    expect(audit).toContain('fiscal.efd_settings');

    expect(
      (await admin.get(`/fiscal/efd/summary?companyId=${empresa.id}&month=2026-13`)).json().message,
    ).toBe('Mês inválido (use AAAA-MM)');
  });
});

describe('inventário no arquivo da EFD ICMS/IPI (F4-14.b.5)', () => {
  it('fevereiro leva o estoque de 31/12 a custo médio; outros meses só a pedido', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, ctx } = await loja();
    const [store] = (await admin.get('/stores')).json();
    const arroz = (
      await admin.post('/products', {
        name: 'Arroz do inventário',
        sku: 'ARZ-INV',
        priceCents: 3000,
        costCents: 1999,
        ncm: '10063021',
      })
    ).json();
    const semCusto = (await admin.post('/products', { name: 'Sem custo', priceCents: 500 })).json();
    const mov = (productId: string, deltaMilli: number, quando: string) => ({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      storeId: store.id,
      productId,
      deltaMilli,
      reason: 'adjustment' as const,
      occurredAt: new Date(quando),
    });
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.insert(stockMovements).values([
        mov(arroz.id, 10_000, '2025-12-20T12:00:00-03:00'),
        mov(arroz.id, -2_000, '2025-12-31T20:00:00-03:00'),
        // Depois de 31/12: não entra no inventário de fevereiro.
        mov(arroz.id, 5_000, '2026-01-05T12:00:00-03:00'),
        mov(semCusto.id, 1_000, '2025-12-20T12:00:00-03:00'),
      ]),
    );
    const leitura = async (query: string) => {
      const arquivo = await admin.get(`/fiscal/efd/file?companyId=${empresa.id}&${query}`);
      expect(arquivo.statusCode, arquivo.body).toBe(200);
      return arquivo.rawPayload
        .toString('latin1')
        .split('\r\n')
        .filter(Boolean)
        .map((l) => l.slice(1, -1).split('|'));
    };

    const fev = await leitura('month=2026-02');
    expect(fev.find((l) => l[0] === 'H001')).toEqual(['H001', '0']);
    // 8 unidades (10 − 2) a R$ 19,99 = R$ 159,92.
    expect(fev.find((l) => l[0] === 'H005')).toEqual(['H005', '31122025', '159,92', '01']);
    expect(fev.filter((l) => l[0] === 'H010').map((l) => l.slice(1, 7))).toEqual([
      ['ARZ-INV', 'UN', '8,000', '19,990000', '159,92', '0'],
    ]);
    expect(fev.find((l) => l[0] === '0200' && l[1] === 'ARZ-INV')![7]).toBe('10063021');
    expect(fev.find((l) => l[0] === 'H990')).toEqual(['H990', '4']);
    const resumo = (await admin.get(`/fiscal/efd/summary?companyId=${empresa.id}&month=2026-02`)).json();
    expect(resumo.warnings.join(' ')).toMatch(/1 produto\(s\) com estoque em 31\/12\/2025 estão sem custo/);
    expect(resumo.warnings.join(' ')).not.toMatch(/Fevereiro pede o inventário/);

    // Outro mês: sem pedido, o bloco H fica sem movimento.
    const mar = await leitura('month=2026-03');
    expect(mar.find((l) => l[0] === 'H001')).toEqual(['H001', '1']);
    // A pedido, com data explícita: entra a compra de janeiro (8 + 5 = 13 unidades).
    const pedido = await leitura('month=2026-03&inventoryDate=2026-02-28');
    expect(pedido.find((l) => l[0] === 'H005')).toEqual(['H005', '28022026', '259,87', '01']);

    // Data fora do prazo do motivo 01: recusa em português.
    const velho = await admin.get(
      `/fiscal/efd/summary?companyId=${empresa.id}&month=2026-03&inventoryDate=2025-12-31`,
    );
    expect(velho.statusCode).toBe(422);
    expect(velho.json().message).toMatch(/segundo mês seguinte/);

    // Sem estoque na data: o arquivo não afirma "sem estoque", só avisa.
    const vazio = await leitura('month=2026-03&inventoryDate=2020-01-31');
    expect(vazio.find((l) => l[0] === 'H001')).toEqual(['H001', '1']);
  });
});

describe('delivery com taxa por bairro (F5-10)', () => {
  it('o bairro chega ao caixa; a venda para entrega soma a taxa e a NFC-e leva o frete', async () => {
    sefaz.mode = 'normal';
    const { admin, caixa, ctx, pdv, sync } = await loja();
    const [store] = (await admin.get('/stores')).json();
    const bairro = await admin.post('/delivery-zones', {
      storeId: store.id,
      name: 'Jardim Paulista',
      feeCents: 700,
    });
    expect(bairro.statusCode).toBe(201);
    expect(
      (
        await admin.post('/delivery-zones', {
          storeId: store.id,
          name: 'jardim paulista',
          feeCents: 1,
        })
      ).json().message,
    ).toBe('O bairro jardim paulista já está cadastrado.');
    await sync.sync();
    expect(await pdv.deliveryZones()).toEqual([
      { id: bairro.json().id, name: 'Jardim Paulista', feeCents: 700 },
    ]);

    const produto = (await pdv.findByCode('7891000315507'))!;
    const carrinho = {
      ...addItem(EMPTY_CART, produto, 2000),
      customerTaxId: '12345678909',
      delivery: {
        zoneId: bairro.json().id,
        zoneName: 'Jardim Paulista',
        feeCents: 700,
        name: 'Carla Cliente',
        phone: '11988887777',
        address: {
          street: 'Rua das Acácias',
          number: '45',
          complement: 'Apto 12',
          district: 'Jardim Paulista',
          cityCode: '3550308',
          cityName: 'São Paulo',
          uf: 'SP',
          cep: '01415000',
        },
      },
    };
    const venda = await pdv.completeSale(carrinho, [{ method: 'pix', receivedCents: 5780 + 700 }], {
      discountLimitPercent: 10,
    });
    expect(venda.totalCents).toBe(6480);
    expect((await sync.sync()).lastError).toBeNull();

    const doc = await nota(admin, venda.id, (s) => s !== 'pending');
    expect(doc.status).toBe('authorized');
    const xml = (await admin.get(`/fiscal/documents/${doc.id}/xml`)).body;
    expect(xml).toContain('<indPres>4</indPres><indIntermed>0</indIntermed>');
    expect(xml).toContain('<vFrete>7.00</vFrete>');
    expect(xml).toContain('<xLgr>Rua das Acácias</xLgr>');
    expect(xml).toContain('<vNF>64.80</vNF>');

    const entregas = (await admin.get('/deliveries')).json();
    expect(entregas).toEqual([
      expect.objectContaining({
        saleId: venda.id,
        status: 'pending',
        totalCents: 6480,
        delivery: expect.objectContaining({ zoneName: 'Jardim Paulista', phone: '11988887777' }),
      }),
    ]);
    expect((await admin.post(`/deliveries/${venda.id}/out`)).json().status).toBe('out');
    expect((await admin.post(`/deliveries/${venda.id}/out`)).statusCode).toBe(409);
    expect((await admin.post(`/deliveries/${venda.id}/delivered`)).json().status).toBe('delivered');

    // A taxa é preço: mudar fica na auditoria e chega ao caixa.
    await admin.put(`/delivery-zones/${bairro.json().id}`, {
      storeId: store.id,
      name: 'Jardim Paulista',
      feeCents: 900,
    });
    expect(JSON.stringify((await admin.get('/audit')).json())).toContain('delivery_zone.updated');
    await sync.sync();
    expect((await pdv.deliveryZones())[0]!.feeCents).toBe(900);
    expect(caixa.id).toBeTruthy();
    expect(ctx.tenantId).toBeTruthy();
  });
});
