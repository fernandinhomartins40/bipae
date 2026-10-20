import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { NfseReceivedService } from '../src/modules/fiscal/nfse-received.service';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SENHA_A1, testPfx } from './support/sefaz-simulator';
import { SefinSimulator } from './support/sefin-simulator';

/** F5-13.l: NFS-e em que a empresa aparece, pelo ADN Contribuinte simulado. */

let t: TestApp;
const sefin = new SefinSimulator();

beforeAll(async () => {
  await sefin.start();
  t = await createTestApp();
  Object.assign(t.app.get(NfseReceivedService), { transport: sefin.transport() });
});
afterAll(async () => {
  await t.close();
  await sefin.stop();
});

const CHAVE = '41094012242761086000115000000000000126104123456789';
const nfse = (key: string, vServ: string) =>
  `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${key}"><nNFSe>12</nNFSe><dhProc>2026-10-20T10:00:00-03:00</dhProc><emit><CNPJ>22333444000102</CNPJ><xNome>Gráfica Exemplo LTDA</xNome></emit><valores><vLiq>${vServ}</vLiq></valores><DPS versao="1.01"><infDPS Id="DPS1"><toma><CNPJ>11222333000181</CNPJ><xNome>Agência Bipaê LTDA</xNome></toma><serv><cServ><cTribNac>130501</cTribNac></cServ></serv><valores><vServPrest><vServ>${vServ}</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;

async function agencia() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Agência Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'presumido',
    cityCode: '3550308',
  });
  await admin.post(`/fiscal/certificates/${empresa.id}`, {
    pfxBase64: testPfx(),
    password: SENHA_A1,
  });
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  return { admin, empresa, ctx };
}

describe('NFS-e recebidas pelo ADN Contribuinte (F5-13.l)', () => {
  it('sem documento novo, espera uma hora; com documento, guarda e marca o cancelamento', async () => {
    const { admin, empresa, ctx } = await agencia();
    const vazio = (await admin.post(`/fiscal/nfse-received/sync/${empresa.id}`)).json();
    expect(vazio).toMatchObject({ received: 0, message: 'Nenhuma NFS-e nova.' });
    expect(vazio.nextQueryAt).toBeTruthy();
    expect(sefin.calls.some((c) => c.path === '/contribuintes/DFe/0?lote=true')).toBe(true);
    // Uma hora depois (aqui, a espera zerada), chega uma NFS-e tomada e depois o cancelamento.
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(sql`update companies set nfse_dist_next_query_at = null`),
    );
    sefin.distributed.push({ nsu: 7, key: CHAVE, type: 'NFSE', xml: nfse(CHAVE, '1000.00') });
    const veio = (await admin.post(`/fiscal/nfse-received/sync/${empresa.id}`)).json();
    expect(veio).toMatchObject({ received: 1, message: '1 NFS-e recebida(s).' });
    const lista = (await admin.get('/fiscal/nfse-received')).json();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      accessKey: CHAVE,
      role: 'tomador',
      issuerName: 'Gráfica Exemplo LTDA',
      valueCents: 100_000,
      serviceCode: '130501',
      cancelled: false,
    });
    const xml = await admin.get(`/fiscal/nfse-received/${lista[0].id}/xml`);
    expect(xml.headers['content-disposition']).toContain(`NFSe${CHAVE}.xml`);
    expect(xml.body).toContain('<NFSe');

    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(sql`update companies set nfse_dist_next_query_at = null`),
    );
    sefin.distributed.push({
      nsu: 9,
      key: CHAVE,
      type: 'EVENTO',
      event: 'CANCELAMENTO',
      xml: '<evento/>',
    });
    await admin.post(`/fiscal/nfse-received/sync/${empresa.id}`);
    // A busca seguinte começa depois do último NSU guardado (7), e o cancelamento chega.
    expect(sefin.calls.some((c) => c.path === '/contribuintes/DFe/8?lote=true')).toBe(true);
    expect((await admin.get('/fiscal/nfse-received')).json()[0].cancelled).toBe(true);

    // Antes da hora, o botão não pergunta de novo.
    const cedo = (await admin.post(`/fiscal/nfse-received/sync/${empresa.id}`)).json();
    expect(cedo.message).toContain('pergunta de novo');
    // Outra conta não vê as notas desta.
    const outra = api(t.app, (await signup(t.app)).auth);
    expect((await outra.get('/fiscal/nfse-received')).json()).toEqual([]);
  });

  it('a manutenção agenda a busca das empresas com certificado', async () => {
    await agencia();
    expect(await t.app.get(MaintenanceService).sweepDfe()).toBeGreaterThanOrEqual(2);
  });
});
