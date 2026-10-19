import { inflateRawSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { NfseService } from '../src/modules/fiscal/nfse.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SENHA_A1, testPfx } from './support/sefaz-simulator';
import { SefinSimulator } from './support/sefin-simulator';

/** F5-13.d: NFS-e Nacional da ordem de serviço, contra a Sefin Nacional simulada. */

let t: TestApp;
const sefin = new SefinSimulator();

beforeAll(async () => {
  await sefin.start();
  t = await createTestApp();
  Object.assign(t.app.get(NfseService), { transport: sefin.transport() });
});
afterAll(async () => {
  await t.close();
  await sefin.stop();
});

async function oficina(over: Record<string, unknown> = {}) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  const dados = await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Oficina Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'simples',
    ie: '111.222.333.444',
    street: 'Rua das Flores',
    streetNumber: '100',
    district: 'Centro',
    cityCode: '3550308',
    cep: '01001-000',
    municipalRegistration: '12345',
    nfseSimplesPercent: '6',
    ...over,
  });
  expect(dados.statusCode).toBe(200);
  await admin.post(`/fiscal/certificates/${empresa.id}`, {
    pfxBase64: testPfx(),
    password: SENHA_A1,
  });
  const [loja] = (await admin.get('/stores')).json();
  const troca = (
    await admin.post('/services', {
      name: 'Troca de óleo',
      code: '140101',
      issRate: '2',
      priceCents: 8_000,
    })
  ).json();
  const oleo = (await admin.post('/products', { name: 'Óleo 5W30 1L', priceCents: 4_500 })).json();
  const cliente = (
    await admin.post('/customers', {
      name: 'Joana Prado',
      taxId: '12345678909',
      address: {
        cep: '01002000',
        street: 'Rua das Acácias',
        number: '45',
        district: 'Centro',
        city: 'São Paulo',
        uf: 'SP',
        ibgeCode: '3550308',
      },
    })
  ).json();
  const os = async (items?: unknown[]) =>
    (
      await admin.post('/service-orders', {
        storeId: loja.id,
        customerId: cliente.id,
        items: items ?? [
          { kind: 'service', serviceId: troca.id, quantityMilli: 1000, unitPriceCents: 8_000 },
          { kind: 'product', productId: oleo.id, quantityMilli: 2000, unitPriceCents: 4_500 },
        ],
      })
    ).json();
  return { admin, empresa, loja, troca, oleo, cliente, os, ctx };
}

async function nota(admin: ReturnType<typeof api>, osId: string, until: (s: string) => boolean) {
  for (let i = 0; i < 100; i++) {
    const doc = (await admin.get(`/service-orders/${osId}/nfse`)).json();
    if (doc && until(doc.status)) return doc;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('A NFS-e não saiu do lugar.');
}

describe('NFS-e Nacional da OS (F5-13.d)', () => {
  it('só os serviços vão na DPS; a Sefin gera a NFS-e; número pela série da empresa', async () => {
    sefin.mode = 'normal';
    sefin.agreementActive = true;
    const { admin, os } = await oficina();
    const ordem = await os();
    await admin.post(`/service-orders/${ordem.id}/deliver`, {});
    const emitida = await admin.post(`/service-orders/${ordem.id}/nfse`);
    expect(emitida.statusCode).toBe(200);
    const doc = await nota(admin, ordem.id, (s) => s !== 'pending');
    expect(doc).toMatchObject({ status: 'authorized', series: 1, number: 1, errors: [] });
    expect(doc.accessKey).toMatch(/^\d{50}$/);
    const enviada = sefin.calls.find((c) => c.method === 'POST')!.dps!;
    expect(enviada).toContain('<cTribNac>140101</cTribNac>');
    expect(enviada).toContain('<vServ>80.00</vServ>');
    expect(enviada).toContain('<pTotTribSN>6.00</pTotTribSN>');
    expect(enviada).toContain('<IM>12345</IM>');
    expect(enviada).toContain('<Signature');
    expect(enviada).not.toContain('<pAliq>');
    expect(sefin.calls.some((c) => c.path === '/parametros_municipais/3550308/convenio')).toBe(
      true,
    );
    const xml = await admin.get(`/service-orders/${ordem.id}/nfse/xml`);
    expect(xml.headers['content-disposition']).toContain(`NFSe${doc.accessKey}.xml`);
    expect(xml.body).toContain('<NFSe');
    const danfse = await admin.get(`/service-orders/${ordem.id}/nfse/danfse`);
    expect(danfse.statusCode).toBe(200);
    expect(danfse.headers['content-type']).toBe('application/pdf');
    expect(danfse.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await admin.post(`/service-orders/${ordem.id}/nfse`)).statusCode).toBe(409);
    expect((await admin.post(`/service-orders/${ordem.id}/nfse/retry`)).statusCode).toBe(409);
    // Pacote do mês para o contador: o XML da NFS-e e a linha no resumo.
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const [empresa] = (await admin.get('/companies')).json();
    const pacote = await admin.get(
      `/fiscal/accountant-export?companyId=${empresa.id}&month=${mes}`,
    );
    expect(pacote.statusCode).toBe(200);
    const files: Record<string, string> = {};
    const zip = pacote.rawPayload;
    let at = 0;
    while (zip.readUInt32LE(at) === 0x04034b50) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
      const start = at + 30 + nameLength;
      files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
      at = start + size;
    }
    expect(files[`NFSe/${doc.accessKey}-NFSe.xml`]).toContain('<NFSe');
    const linha = files['resumo.csv']!.split('\r\n').find((l) => l.startsWith(doc.accessKey));
    expect(linha).toMatch(/;NFS-e;1;1;[^;]+;Autorizada;80,00;/);
    const outra = await os();
    await admin.post(`/service-orders/${outra.id}/nfse`);
    expect((await nota(admin, outra.id, (s) => s === 'authorized')).number).toBe(2);
  });

  it('sem o percentual do Simples, falta configurar; com ele, a nova tentativa gera', async () => {
    sefin.mode = 'normal';
    const { admin, empresa, os } = await oficina({ nfseSimplesPercent: '' });
    const ordem = await os();
    await admin.post(`/service-orders/${ordem.id}/nfse`);
    const parada = await nota(admin, ordem.id, (s) => s === 'not_configured');
    expect(parada.pendingItems.join(' ')).toContain(
      'percentual aproximado dos tributos do Simples',
    );
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: 'Oficina Bipaê LTDA',
      nfseSimplesPercent: '6',
    });
    const depois = (await admin.post(`/service-orders/${ordem.id}/nfse/retry`)).json();
    expect(depois.status).toBe('authorized');
  });

  it('recusa da Sefin mostra o código e a mensagem; a resposta perdida não gera duas notas', async () => {
    sefin.mode = 'rejeita';
    const { admin, os } = await oficina();
    const recusada = await os();
    await admin.post(`/service-orders/${recusada.id}/nfse`);
    const doc = await nota(admin, recusada.id, (s) => s === 'rejected');
    expect(doc.errors).toEqual([
      { code: 'E0015', message: 'A data de competência não pode ser posterior à data de emissão.' },
    ]);

    sefin.mode = 'perde';
    const perdida = await os();
    await admin.post(`/service-orders/${perdida.id}/nfse`);
    await nota(admin, perdida.id, (s) => s === 'error');
    const postsAntes = sefin.calls.filter((c) => c.method === 'POST').length;
    sefin.mode = 'normal';
    const pronta = (await admin.post(`/service-orders/${perdida.id}/nfse/retry`)).json();
    expect(pronta.status).toBe('authorized');
    // Perguntou pela DPS e achou a nota gerada: não mandou de novo.
    expect(sefin.calls.filter((c) => c.method === 'POST').length).toBe(postsAntes);
    expect(sefin.calls.some((c) => c.path.startsWith('/dps/'))).toBe(true);
  });

  it('Sefin fora do ar: a varredura da manutenção põe a NFS-e de volta na fila', async () => {
    sefin.mode = 'fora';
    const { admin, os, ctx } = await oficina();
    const ordem = await os();
    await admin.post(`/service-orders/${ordem.id}/nfse`);
    const erro = await nota(admin, ordem.id, (s) => s === 'error');
    expect(erro.lastError).toContain('Sefin');
    sefin.mode = 'normal';
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(
        sql`update nfse_documents set updated_at = now() - interval '5 minutes' where id = ${erro.id}`,
      ),
    );
    expect(await t.app.get(MaintenanceService).sweepNfce()).toBeGreaterThanOrEqual(1);
    expect((await nota(admin, ordem.id, (s) => s === 'authorized')).status).toBe('authorized');
  });

  it('serviços de códigos diferentes pedem para separar; OS só com peças não tem NFS-e', async () => {
    sefin.mode = 'normal';
    const { admin, troca, oleo, os } = await oficina();
    const outro = (
      await admin.post('/services', { name: 'Programação', code: '010201', priceCents: 1000 })
    ).json();
    const mista = await os([
      { kind: 'service', serviceId: troca.id, quantityMilli: 1000, unitPriceCents: 8_000 },
      { kind: 'service', serviceId: outro.id, quantityMilli: 1000, unitPriceCents: 1_000 },
    ]);
    await admin.post(`/service-orders/${mista.id}/nfse`);
    const parada = await nota(admin, mista.id, (s) => s === 'not_configured');
    expect(parada.pendingItems[0]).toContain('códigos diferentes');
    const pecas = await os([
      { kind: 'product', productId: oleo.id, quantityMilli: 1000, unitPriceCents: 4_500 },
    ]);
    const semServico = await admin.post(`/service-orders/${pecas.id}/nfse`);
    expect(semServico.statusCode).toBe(422);
    expect(semServico.json().message).toContain('peças vão em NF-e ou NFC-e');
  });
});

describe('cancelamento da NFS-e (F5-13.g)', () => {
  it('cancela a gerada: pedido assinado à Sefin, nota cancelada, evento no pacote do contador', async () => {
    sefin.mode = 'normal';
    sefin.cancelExpired = false;
    const { admin, os } = await oficina();
    const ordem = await os();
    // Sem NFS-e gerada não há o que cancelar.
    const cedo = await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, {
      code: '2',
      reason: 'O serviço não foi prestado: cliente desistiu.',
    });
    expect(cedo.statusCode).toBe(409);
    await admin.post(`/service-orders/${ordem.id}/nfse`);
    const doc = await nota(admin, ordem.id, (s) => s === 'authorized');

    expect(
      (await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, { code: '4', reason: 'x' }))
        .statusCode,
    ).toBe(400);
    const pedido = await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, {
      code: '2',
      reason: 'O serviço não foi prestado: cliente desistiu.',
    });
    expect(pedido.statusCode).toBe(200);
    const cancelada = await nota(admin, ordem.id, (s) => s === 'cancelled');
    expect(cancelada.cancellation).toMatchObject({ status: 'registered', code: '2' });
    const enviado = sefin.cancelled.get(doc.accessKey)!;
    expect(enviado).toContain(`<infPedReg Id="PRE${doc.accessKey}101101">`);
    expect(enviado).toContain('<CNPJAutor>11222333000181</CNPJAutor>');
    expect(enviado).toContain('<Signature');
    expect(JSON.stringify((await admin.get('/audit?action=nfse.cancelled')).json())).toContain(
      doc.accessKey,
    );
    // De novo não pede: já foi cancelada.
    expect(
      (
        await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, {
          code: '2',
          reason: 'O serviço não foi prestado: cliente desistiu.',
        })
      ).statusCode,
    ).toBe(409);

    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const [empresa] = (await admin.get('/companies')).json();
    const pacote = (
      await admin.get(`/fiscal/accountant-export?companyId=${empresa.id}&month=${mes}`)
    ).rawPayload.toString('latin1');
    expect(pacote).toContain(`Eventos/${doc.accessKey}-cancelamento-NFSe.xml`);
  });

  it('o município recusa (prazo, E0822): a nota continua gerada e dá para pedir de novo', async () => {
    sefin.mode = 'normal';
    const { admin, os } = await oficina();
    const ordem = await os();
    await admin.post(`/service-orders/${ordem.id}/nfse`);
    await nota(admin, ordem.id, (s) => s === 'authorized');
    sefin.cancelExpired = true;
    await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, {
      code: '1',
      reason: 'Erro no valor do serviço na emissão da nota.',
    });
    let view = (await admin.get(`/service-orders/${ordem.id}/nfse`)).json();
    for (let i = 0; i < 100 && view.cancellation?.status !== 'rejected'; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      view = (await admin.get(`/service-orders/${ordem.id}/nfse`)).json();
    }
    expect(view).toMatchObject({
      status: 'authorized',
      cancellation: { status: 'rejected', errors: [{ code: 'E0822' }] },
    });
    sefin.cancelExpired = false;
    const outra = await admin.post(`/service-orders/${ordem.id}/nfse/cancel`, {
      code: '1',
      reason: 'Erro no valor do serviço na emissão da nota.',
    });
    expect(outra.statusCode).toBe(200);
  });
});
