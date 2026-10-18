import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SefazSimulator, SENHA_A1, testPfx } from './support/sefaz-simulator';

/** F3-20.b: notas emitidas contra o CNPJ da empresa, pela distribuição do Ambiente Nacional. */

let t: TestApp;
const sefaz = new SefazSimulator();
const NS = 'http://www.portalfiscal.inf.br/nfe';

beforeAll(async () => {
  await sefaz.start();
  t = await createTestApp();
  Object.assign(t.app.get(SefazService), { transport: sefaz.transport() });
});
afterAll(async () => {
  await t.close();
  await sefaz.stop();
});

let seq = 0;
/** Chave de uma nota de um fornecedor de SP, diferente a cada teste. */
const chave = () =>
  `3526101144477700016155001${String(++seq).padStart(9, '0')}1000012345`.slice(0, 44);

const resumo = (key: string) =>
  `<resNFe xmlns="${NS}" versao="1.01"><chNFe>${key}</chNFe><CNPJ>11444777000161</CNPJ>` +
  '<xNome>Distribuidora Fornecedora LTDA</xNome><IE>111222333444</IE>' +
  '<dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1530.75</vNF>' +
  '<dhRecbto>2026-10-15T10:00:05-03:00</dhRecbto><nProt>135260000123456</nProt><cSitNFe>1</cSitNFe></resNFe>';

const notaCompleta = (key: string) =>
  `<nfeProc xmlns="${NS}" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">` +
  '<ide><dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>' +
  '<emit><CNPJ>11444777000161</CNPJ><xNome>Distribuidora Fornecedora LTDA</xNome><IE>111222333444</IE></emit>' +
  '<total><ICMSTot><vNF>1530.75</vNF></ICMSTot></total></infNFe></NFe>' +
  `<protNFe versao="4.00"><infProt><chNFe>${key}</chNFe><nProt>135260000123456</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;

const cancelamento = (key: string) =>
  `<resEvento xmlns="${NS}" versao="1.01"><cOrgao>35</cOrgao><CNPJ>11444777000161</CNPJ>` +
  `<chNFe>${key}</chNFe><dhEvento>2026-10-15T11:00:00-03:00</dhEvento><tpEvento>110111</tpEvento>` +
  '<nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento><dhRecbto>2026-10-15T11:00:02-03:00</dhRecbto>' +
  '<nProt>135260000123457</nProt></resEvento>';

async function empresa() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [e] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${e.id}`, {
    legalName: 'Mercadinho Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'simples',
  });
  const cert = await admin.post(`/fiscal/certificates/${e.id}`, {
    pfxBase64: testPfx(),
    password: SENHA_A1,
  });
  expect(cert.statusCode).toBe(201);
  const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
  /** Como se a última busca tivesse sido há mais de uma hora. */
  const liberar = () =>
    withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(sql`update companies set dfe_next_query_at = null where id = ${e.id}`),
    );
  return { admin, empresa: e, liberar };
}

describe('notas recebidas pelo Ambiente Nacional (F3-20.b)', () => {
  it('busca, ciência com a nota completa, confirmação e cancelamento pelo emitente', async () => {
    sefaz.distribution.length = 0;
    const key = chave();
    sefaz.distribution.push({ schema: 'resNFe_v1.01.xsd', xml: resumo(key) });
    const { admin, empresa: e, liberar } = await empresa();

    const busca = await admin.post(`/fiscal/dfe/sync/${e.id}`);
    expect(busca.statusCode).toBe(200);
    expect(busca.json()).toMatchObject({ received: 1, message: '1 nota(s) recebida(s).' });
    // Logo depois, o Ambiente Nacional pede uma hora: o Bipaê não insiste.
    const deNovo = (await admin.post(`/fiscal/dfe/sync/${e.id}`)).json();
    expect(deNovo.received).toBe(0);
    expect(deNovo.message).toContain('uma hora');
    expect(sefaz.calls.filter((c) => c.service === 'distribuicao')).toHaveLength(1);

    const [nota] = (await admin.get('/fiscal/dfe')).json();
    expect(nota).toMatchObject({
      accessKey: key,
      issuerName: 'Distribuidora Fornecedora LTDA',
      totalCents: 153_075,
      situation: 'autorizada',
      hasXml: false,
      manifestation: null,
      purchaseId: null,
    });
    expect((await admin.get(`/fiscal/dfe/${nota.id}/xml`)).statusCode).toBe(409);

    // Ciência: o Ambiente Nacional libera a nota completa, pedida pela chave.
    sefaz.distribution.push({ schema: 'procNFe_v4.00.xsd', xml: notaCompleta(key) });
    const ciencia = (
      await admin.post(`/fiscal/dfe/${nota.id}/manifest`, { type: 'ciencia' })
    ).json();
    expect(ciencia).toMatchObject({
      manifestation: 'ciencia',
      manifestationStatus: 'registered',
      hasXml: true,
    });
    expect(sefaz.manifestations).toContainEqual({ key, type: '210210' });
    const xml = await admin.get(`/fiscal/dfe/${nota.id}/xml`);
    expect(xml.body).toContain('<nfeProc');

    const confirma = (
      await admin.post(`/fiscal/dfe/${nota.id}/manifest`, { type: 'confirmacao' })
    ).json();
    expect(confirma).toMatchObject({
      manifestation: 'confirmacao',
      manifestationStatus: 'registered',
    });
    // Confirmada é definitiva.
    expect(
      (await admin.post(`/fiscal/dfe/${nota.id}/manifest`, { type: 'desconhecimento' })).statusCode,
    ).toBe(409);

    // O emitente cancelou a nota: na próxima busca ela aparece como cancelada.
    sefaz.distribution.push({ schema: 'resEvento_v1.01.xsd', xml: cancelamento(key) });
    await liberar();
    await admin.post(`/fiscal/dfe/sync/${e.id}`);
    expect((await admin.get('/fiscal/dfe')).json()[0].situation).toBe('cancelada');
    const trilha = (await admin.get('/audit?entity=dfe_document')).json().items;
    expect(
      trilha.filter((a: { action: string }) => a.action === 'dfe.manifested'),
    ).toHaveLength(2);
  });

  it('operação não realizada pede o motivo; a manutenção busca sozinha; outra empresa não vê', async () => {
    sefaz.distribution.length = 0;
    const key = chave();
    sefaz.distribution.push({ schema: 'resNFe_v1.01.xsd', xml: resumo(key) });
    const { admin, empresa: e } = await empresa();
    expect(await t.app.get(MaintenanceService).sweepDfe()).toBeGreaterThanOrEqual(1);
    let notas = [];
    for (let i = 0; i < 50 && notas.length === 0; i++) {
      notas = (await admin.get('/fiscal/dfe')).json();
      if (notas.length === 0) await new Promise((ok) => setTimeout(ok, 100));
    }
    expect(notas).toHaveLength(1);
    const semMotivo = await admin.post(`/fiscal/dfe/${notas[0].id}/manifest`, {
      type: 'naoRealizada',
    });
    expect(semMotivo.statusCode).toBe(400);
    expect(semMotivo.body).toContain('não foi realizada');
    const ok = (
      await admin.post(`/fiscal/dfe/${notas[0].id}/manifest`, {
        type: 'naoRealizada',
        reason: 'A mercadoria nunca chegou na loja',
      })
    ).json();
    expect(ok.manifestationStatus).toBe('registered');
    expect(sefaz.manifestations).toContainEqual({ key, type: '210240' });

    const outro = api(t.app, (await signup(t.app)).auth);
    expect((await outro.get('/fiscal/dfe')).json()).toEqual([]);
    expect(
      (await outro.post(`/fiscal/dfe/${notas[0].id}/manifest`, { type: 'ciencia' })).statusCode,
    ).toBe(404);
    expect(e.id).toBeTruthy();
  });
});
