import { inflateRawSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { nfeEndpoints } from '@bipae/fiscal/tables';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SefazSimulator, SENHA_A1, testPfx } from './support/sefaz-simulator';

/** F3-33.b: NF-e da retaguarda, do rascunho à autorização na SEFAZ simulada. */

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

/** Empresa emitente pronta (com ou sem certificado), um produto e a loja. */
async function retaguarda(certificado = true) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  const dados = await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Distribuidora Bipaê LTDA',
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
  expect(dados.statusCode).toBe(200);
  if (certificado) {
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
      cfopInterestadual: '6102',
      csosn: '102',
      cClassTrib: '000001',
    })
  ).json();
  const produto = (
    await admin.post('/products', {
      name: 'Arroz tipo 1 5kg',
      priceCents: 2500,
      barcodes: ['7891000315507'],
      ncm: '10063021',
      fiscalProfileId: perfil.id,
    })
  ).json();
  const [loja] = (await admin.get('/stores')).json();
  const rascunho = (over: Record<string, unknown> = {}) => ({
    companyId: empresa.id,
    storeId: loja.id,
    presence: 'teleatendimento',
    recipient: {
      taxId: '11.444.777/0001-61',
      name: 'Mercado do Bairro LTDA',
      ieIndicator: 1,
      ie: '111.222.333.444',
      email: 'compras@mercado.com.br',
      address: {
        cep: '01430-000',
        street: 'Avenida Brasil',
        number: '2000',
        district: 'Jardim América',
        city: 'São Paulo',
        uf: 'SP',
        ibgeCode: '3550308',
      },
    },
    items: [{ productId: produto.id, quantityMilli: 10_000, unitPriceCents: 2500 }],
    transport: { freight: 'porContaDoRemetente', freightCents: 1000 },
    installments: [
      { dueDate: '2026-11-15', amountCents: 13_000 },
      { dueDate: '2026-12-15', amountCents: 13_000 },
    ],
    payments: [{ code: '15', amountCents: 26_000 }],
    ...over,
  });
  return { admin, empresa, loja, produto, rascunho, dono };
}

/** Espera a fila mexer na nota (a emissão roda em segundo plano). */
async function nota(
  admin: ReturnType<typeof api>,
  id: string,
  until: (status: string | undefined) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const view = (await admin.get(`/fiscal/nfe/${id}`)).json();
    if (until(view.document?.status)) return view;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('A NF-e não saiu do lugar.');
}

describe('NF-e da retaguarda (F3-33.b)', () => {
  it('rascunho conferido, emitido com o número da série e autorizado; XML, DANFE e auditoria', async () => {
    sefaz.mode = 'normal';
    const { admin, rascunho, produto } = await retaguarda();
    const criada = await admin.post('/fiscal/nfe', rascunho());
    expect(criada.statusCode).toBe(201);
    const view = criada.json();
    expect(view).toMatchObject({
      status: 'draft',
      totalCents: 26_000,
      check: { ok: true, pending: [], totalCents: 26_000 },
      document: null,
    });
    // A prévia do DANFE sai do rascunho, antes de emitir.
    const previa = await admin.get(`/fiscal/nfe/${view.id}/danfe`);
    expect(previa.statusCode).toBe(200);
    expect(previa.headers['content-disposition']).toContain('Previa-DANFE-NFe');
    expect(previa.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const emitida = await admin.post(`/fiscal/nfe/${view.id}/issue`);
    expect(emitida.statusCode).toBe(200);
    const pronta = await nota(admin, view.id, (s) => s !== undefined && s !== 'pending');
    expect(pronta).toMatchObject({
      status: 'issued',
      document: { status: 'authorized', model: '55', series: 1, number: 1, cStat: '100' },
    });
    expect(pronta.document.accessKey).toMatch(/^35\d{18}55001000000001\d{10}$/);

    const xml = await admin.get(`/fiscal/nfe/${view.id}/xml`);
    expect(xml.headers['content-disposition']).toContain(`NFe${pronta.document.accessKey}.xml`);
    expect(xml.body).toContain('<nfeProc');
    expect(xml.body).toContain('<mod>55</mod>');
    expect(xml.body).toContain('<nDup>002</nDup>');
    const danfe = await admin.get(`/fiscal/nfe/${view.id}/danfe`);
    expect(danfe.headers['content-disposition']).toContain(
      `"DANFE-NFe${pronta.document.accessKey}.pdf"`,
    );

    // F3-33.e: a venda tirou do estoque e as parcelas viraram contas a receber.
    const saldo = (await admin.get(`/stock?productId=${produto.id}`))
      .json()
      .reduce((t: number, r: { quantityMilli: number }) => t + r.quantityMilli, 0);
    expect(saldo).toBe(-10_000);
    const contas = (await admin.get('/finance/entries?kind=receivable')).json() as {
      description: string;
      amountCents: number;
      dueDate: string;
    }[];
    expect(contas.map((c) => [c.description, c.amountCents, c.dueDate])).toEqual(
      expect.arrayContaining([
        ['NF-e nº 1 · Mercado do Bairro LTDA · parcela 1/2', 13_000, '2026-11-15'],
        ['NF-e nº 1 · Mercado do Bairro LTDA · parcela 2/2', 13_000, '2026-12-15'],
      ]),
    );

    // Emitida não muda mais, não sai de novo e não vai para a fila de novo.
    expect((await admin.put(`/fiscal/nfe/${view.id}`, rascunho())).statusCode).toBe(409);
    expect((await admin.post(`/fiscal/nfe/${view.id}/issue`)).statusCode).toBe(409);
    expect((await admin.post(`/fiscal/nfe/${view.id}/retry`)).statusCode).toBe(409);
    // A rota de nova tentativa da NFC-e não mexe na NF-e.
    expect((await admin.post(`/fiscal/documents/${pronta.document.id}/retry`)).statusCode).toBe(
      409,
    );

    // A próxima nota da empresa pega o número seguinte.
    const segunda = (await admin.post('/fiscal/nfe', rascunho())).json();
    await admin.post(`/fiscal/nfe/${segunda.id}/issue`);
    const outra = await nota(admin, segunda.id, (s) => s === 'authorized');
    expect(outra.document.number).toBe(2);

    const eventos = (await admin.get('/audit?entity=nfe_invoice')).json().items as {
      action: string;
    }[];
    expect(eventos.filter((e) => e.action === 'nfe.issued')).toHaveLength(2);
    expect((await admin.get('/fiscal/nfe')).json()).toHaveLength(2);
  });

  it('o que falta aparece no rascunho e impede a emissão; corrigido, sai', async () => {
    sefaz.mode = 'normal';
    const { admin, rascunho } = await retaguarda();
    const base = rascunho();
    const incompleto = (
      await admin.post(
        '/fiscal/nfe',
        rascunho({
          recipient: { ...base.recipient, ie: null },
          payments: [{ code: '98', amountCents: 26_000 }],
        }),
      )
    ).json();
    expect(incompleto.check.ok).toBe(false);
    expect(incompleto.check.pending).toEqual(
      expect.arrayContaining([
        'Destinatário contribuinte do ICMS precisa da inscrição estadual.',
        expect.stringContaining('Meio de pagamento 98'),
      ]),
    );
    const recusada = await admin.post(`/fiscal/nfe/${incompleto.id}/issue`);
    expect(recusada.statusCode).toBe(422);
    expect(recusada.json().message).toContain('inscrição estadual');
    // Nenhum número foi gasto com a recusa.
    const corrigida = await admin.put(`/fiscal/nfe/${incompleto.id}`, rascunho());
    expect(corrigida.json().check.ok).toBe(true);
    await admin.post(`/fiscal/nfe/${incompleto.id}/issue`);
    const pronta = await nota(admin, incompleto.id, (s) => s === 'authorized');
    expect(pronta.document.number).toBe(1);
  });

  it('sem certificado fica em "falta configurar"; com ele, a nova tentativa autoriza', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, rascunho } = await retaguarda(false);
    const view = (await admin.post('/fiscal/nfe', rascunho())).json();
    await admin.post(`/fiscal/nfe/${view.id}/issue`);
    const parada = await nota(admin, view.id, (s) => s === 'not_configured');
    expect(parada.document.pendingItems).toEqual([
      'A empresa ainda não tem certificado digital A1 cadastrado.',
    ]);
    await admin.post(`/fiscal/certificates/${empresa.id}`, { pfxBase64, password: SENHA_A1 });
    const retentada = await admin.post(`/fiscal/nfe/${view.id}/retry`);
    expect(retentada.json().document.status).toBe('authorized');
  });

  it('a NF-e autorizada vai no pacote do mês para o contador (F4-14.a)', async () => {
    sefaz.mode = 'normal';
    const { admin, empresa, rascunho } = await retaguarda();
    const view = (await admin.post('/fiscal/nfe', rascunho())).json();
    await admin.post(`/fiscal/nfe/${view.id}/issue`);
    const pronta = await nota(admin, view.id, (s) => s === 'authorized');
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const res = await admin.get(`/fiscal/accountant-export?companyId=${empresa.id}&month=${mes}`);
    expect(res.statusCode).toBe(200);
    // ZIP com método deflate e sem pastas: lê cada arquivo pelo cabeçalho local.
    const files: Record<string, string> = {};
    const zip = res.rawPayload;
    let at = 0;
    while (zip.readUInt32LE(at) === 0x04034b50) {
      const size = zip.readUInt32LE(at + 18);
      const nameLength = zip.readUInt16LE(at + 26);
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
      const start = at + 30 + nameLength;
      files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
      at = start + size;
    }
    const key = pronta.document.accessKey as string;
    expect(files[`NFe/${key}-procNFe.xml`]).toContain('<nfeProc');
    const linha = files['resumo.csv']!.split('\r\n').find((l) => l.startsWith(key));
    expect(linha).toMatch(new RegExp(`^${key};55;1;1;2026-\\d{2}-\\d{2}T[^;]+;Autorizada;260,00;`));
  });

  it('SEFAZ fora do ar: a varredura da manutenção põe a NF-e de volta na fila', async () => {
    sefaz.mode = 'fora';
    const { admin, rascunho, dono } = await retaguarda();
    const view = (await admin.post('/fiscal/nfe', rascunho())).json();
    await admin.post(`/fiscal/nfe/${view.id}/issue`);
    const erro = await nota(admin, view.id, (s) => s === 'error');
    expect(erro.document.lastError).toContain('SEFAZ');
    sefaz.mode = 'normal';
    // Como se a falha tivesse sido há alguns minutos.
    const ctx = { tenantId: dono.me.tenant.id as string, userId: dono.me.user.id as string };
    await withTenant(t.database.db, ctx as never, (tx) =>
      tx.execute(
        sql`update fiscal_documents set updated_at = now() - interval '5 minutes' where id = ${erro.document.id}`,
      ),
    );
    expect(await t.app.get(MaintenanceService).sweepNfce()).toBeGreaterThanOrEqual(1);
    const pronta = await nota(admin, view.id, (s) => s === 'authorized');
    // Consultou pela chave antes de reenviar: a nota nunca é autorizada duas vezes.
    const daChave = sefaz.calls.filter((c) => c.body.includes(pronta.document.accessKey));
    expect(daChave.filter((c) => c.service === 'consulta').length).toBeGreaterThanOrEqual(1);
  });

  it('rascunho descartado sai da lista; outra empresa não vê a nota', async () => {
    const { admin, rascunho } = await retaguarda();
    const view = (await admin.post('/fiscal/nfe', rascunho())).json();
    const outro = api(t.app, (await signup(t.app)).auth);
    expect((await outro.get(`/fiscal/nfe/${view.id}`)).statusCode).toBe(404);
    expect((await admin.delete(`/fiscal/nfe/${view.id}`)).statusCode).toBe(204);
    expect((await admin.get('/fiscal/nfe')).json()).toEqual([]);
  });

  it('a tela recebe os meios de pagamento da tabela oficial em vigor', async () => {
    const { admin } = await retaguarda(false);
    const meios = (await admin.get('/fiscal/nfe/payment-means')).json() as { code: string }[];
    expect(meios.map((m) => m.code)).toEqual(expect.arrayContaining(['01', '15', '17', '90']));
  });

  it('destinatário e itens são validados com mensagem em português', async () => {
    const { admin, rascunho } = await retaguarda();
    const ruim = await admin.post(
      '/fiscal/nfe',
      rascunho({ items: [], recipient: { ...rascunho().recipient, taxId: '111' } }),
    );
    expect(ruim.statusCode).toBe(400);
    expect(ruim.body).toContain('CPF ou CNPJ inválido');
    expect(ruim.body).toContain('Escolha pelo menos um produto');
  });
});

describe('contingência SVC da NF-e (F3-16)', () => {
  const host = (url: string | undefined) => new URL(url!).host;
  const sp = nfeEndpoints('SP')!;
  const uf = host(sp.webservices.homologacao.NFeAutorizacao);
  const svc = host(sp.contingencyWebservices.homologacao.NFeAutorizacao);

  it('a SEFAZ de SP fora do ar: a nota vai à SVC-AN com tpEmis 6 e a chave anterior é conferida', async () => {
    sefaz.mode = 'normal';
    sefaz.down.add(uf);
    try {
      const { admin, rascunho, dono } = await retaguarda();
      const view = (await admin.post('/fiscal/nfe', rascunho())).json();
      await admin.post(`/fiscal/nfe/${view.id}/issue`);
      const parada = await nota(admin, view.id, (s) => s === 'error');
      const anterior = parada.document.accessKey as string;
      // Sem motivo, não entra em contingência.
      expect(
        (await admin.post(`/fiscal/nfe/${view.id}/contingency`, { reason: 'curto' })).statusCode,
      ).toBe(400);
      const svcView = (
        await admin.post(`/fiscal/nfe/${view.id}/contingency`, {
          reason: 'SEFAZ de SP sem resposta para a autorização',
        })
      ).json();
      expect(svcView.document).toMatchObject({
        status: 'authorized',
        contingency: true,
        contingencyMode: 'SVC-AN',
        replacedAccessKey: anterior,
        number: parada.document.number,
      });
      const chave = svcView.document.accessKey as string;
      expect(chave.charAt(34)).toBe('6');
      expect(chave).not.toBe(anterior);
      expect(sefaz.hosts).toContain(svc);
      const xml = (await admin.get(`/fiscal/nfe/${view.id}/xml`)).body;
      expect(xml).toContain('<tpEmis>6</tpEmis>');
      expect(xml).toContain('<xJust>SEFAZ de SP sem resposta para a autorização</xJust>');
      expect(
        (
          await admin.post(`/fiscal/nfe/${view.id}/contingency`, {
            reason: 'De novo, a SEFAZ caiu outra vez',
          })
        ).statusCode,
      ).toBe(409);

      // A UF voltou e a tentativa normal não existe lá: tudo certo, sem aviso.
      sefaz.down.delete(uf);
      await t.app.get(MaintenanceService).sweepNfce();
      const conferida = (await admin.get(`/fiscal/nfe/${view.id}`)).json();
      expect(conferida.document.lastError).toBeNull();
      expect(sefaz.calls.some((c) => c.service === 'consulta' && c.body.includes(anterior))).toBe(
        true,
      );
      expect(dono).toBeTruthy();
    } finally {
      sefaz.down.delete(uf);
    }
  });

  it('se a tentativa normal também foi autorizada, a nota avisa para cancelar uma das duas', async () => {
    sefaz.mode = 'normal';
    sefaz.down.add(uf);
    try {
      const { admin, rascunho } = await retaguarda();
      const view = (await admin.post('/fiscal/nfe', rascunho())).json();
      await admin.post(`/fiscal/nfe/${view.id}/issue`);
      const parada = await nota(admin, view.id, (s) => s === 'error');
      await admin.post(`/fiscal/nfe/${view.id}/contingency`, {
        reason: 'SEFAZ de SP sem resposta para a autorização',
      });
      // A SEFAZ de SP tinha autorizado a tentativa normal, sem a resposta chegar.
      sefaz.authorized.add(parada.document.accessKey);
      sefaz.down.delete(uf);
      await t.app.get(MaintenanceService).sweepNfce();
      const conferida = (await admin.get(`/fiscal/nfe/${view.id}`)).json();
      expect(conferida.document.lastError).toContain('cancele uma das duas notas');
    } finally {
      sefaz.down.delete(uf);
    }
  });
});
