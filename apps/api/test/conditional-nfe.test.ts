import type { NfeInvoiceView } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { SefazSimulator, SENHA_A1, testPfx } from './support/sefaz-simulator';

/** F5-12.c.2: as notas do Ajuste SINIEF 02/18 saem com o condicional, na SEFAZ simulada. */

let t: TestApp;
const sefaz = new SefazSimulator();

beforeAll(async () => {
  await sefaz.start();
  t = await createTestApp();
  Object.assign(t.app.get(SefazService), { transport: sefaz.transport() });
});
afterAll(async () => {
  await t.close();
  await sefaz.stop();
});

/** Loja de moda no Simples, com certificado, duas peças em estoque e uma cliente com endereço. */
async function ateliê(comPerfil = true) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  const [loja] = (await admin.get('/stores')).json();
  const perfilVenda = (
    await admin.post('/fiscal-profiles', {
      name: 'Confecções',
      cfopInterna: '5102',
      cfopInterestadual: '6102',
      csosn: '102',
      cClassTrib: '000001',
    })
  ).json();
  // O perfil das notas com imposto suspenso, escolhido com o contador (dúvida D-033).
  const perfilDemonstracao = (
    await admin.post('/fiscal-profiles', {
      name: 'Condicional (demonstração)',
      cfopInterna: '5912',
      cfopInterestadual: '6912',
      csosn: '400',
      cClassTrib: '000001',
    })
  ).json();
  const dados = await admin.patch(`/companies/${empresa.id}`, {
    legalName: 'Ateliê Bipaê LTDA',
    taxId: '11.222.333/0001-81',
    uf: 'SP',
    taxRegime: 'simples',
    ie: '111.222.333.444',
    street: 'Rua das Flores',
    streetNumber: '100',
    district: 'Centro',
    cityCode: '3550308',
    cep: '01001-000',
    ...(comPerfil && { demonstrationProfileId: perfilDemonstracao.id }),
  });
  expect(dados.statusCode).toBe(200);
  await admin.post(`/fiscal/certificates/${empresa.id}`, {
    pfxBase64: testPfx(),
    password: SENHA_A1,
  });
  const pecas = [];
  for (const [name, priceCents] of [
    ['Vestido Floral — M', 18_990],
    ['Blusa Seda — P', 9_990],
  ] as const) {
    const p = (
      await admin.post('/products', {
        name,
        priceCents,
        ncm: '62044200',
        fiscalProfileId: perfilVenda.id,
      })
    ).json();
    await admin.post('/stock/adjustments', {
      productId: p.id,
      storeId: loja.id,
      mode: 'adjustment',
      quantityMilli: 3000,
    });
    pecas.push(p);
  }
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
  const saldo = async (productId: string) =>
    (await admin.get(`/stock?productId=${productId}`))
      .json()
      .reduce((s: number, r: { quantityMilli: number }) => s + r.quantityMilli, 0);
  return { admin, loja, pecas, cliente, saldo, perfilDemonstracao, empresa };
}

/** Espera as notas do condicional chegarem a uma situação. */
async function notas(
  admin: ReturnType<typeof api>,
  id: string,
  until: (n: { demonstration: string; documentStatus: string | null }[]) => boolean,
) {
  for (let i = 0; i < 100; i++) {
    const c = (await admin.get(`/conditionals/${id}`)).json();
    if (until(c.invoices)) return c;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('As notas do condicional não saíram do lugar.');
}

describe('notas do condicional pela NF-e (F5-12.c.2)', () => {
  it('remessa ao sair; na volta, retorno, entrada simbólica e a venda com a chave da remessa', async () => {
    sefaz.mode = 'normal';
    const { admin, loja, pecas, cliente, saldo } = await ateliê();
    const [vestido, blusa] = pecas;
    const criado = await admin.post('/conditionals', {
      storeId: loja.id,
      customerId: cliente.id,
      items: [
        { productId: vestido.id, quantityMilli: 1000 },
        { productId: blusa.id, quantityMilli: 1000 },
      ],
    });
    expect(criado.statusCode).toBe(201);
    const cond = criado.json();
    const saiu = await notas(admin, cond.id, (n) => n[0]?.documentStatus === 'authorized');
    expect(saiu.invoices).toEqual([
      expect.objectContaining({ demonstration: 'remessa', status: 'issued', number: 1 }),
    ]);
    const remessa = (
      await admin.get(`/fiscal/nfe/${saiu.invoices[0].id}`)
    ).json() as NfeInvoiceView;
    const chave = remessa.document!.accessKey!;
    const xml = (await admin.get(`/fiscal/nfe/${remessa.id}/xml`)).body;
    expect(xml).toContain('<CFOP>5912</CFOP>');
    expect(xml).toContain('<tPag>90</tPag>');
    // A remessa não mexe de novo no estoque: o condicional já tirou as peças.
    expect(await saldo(vestido.id)).toBe(2000);

    // Ficou com o vestido e devolveu a blusa.
    const fechado = await admin.post(`/conditionals/${cond.id}/close`, {
      items: [{ productId: vestido.id, keptMilli: 1000 }],
    });
    expect(fechado.statusCode).toBe(201);
    expect(fechado.json().tabOrderId).toBeNull();
    const volta = await notas(admin, cond.id, (n) =>
      n.some((x) => x.demonstration === 'retorno' && x.documentStatus === 'authorized'),
    );
    const por = (d: string) =>
      volta.invoices.find((n: { demonstration: string }) => n.demonstration === d);
    expect(por('retorno')).toMatchObject({ status: 'issued', documentStatus: 'authorized' });
    // A natureza da entrada simbólica passa dos 60 caracteres: a empresa escreve a abreviada (D-035).
    expect(por('entradaSimbolica')).toMatchObject({ status: 'draft' });
    expect(por('entradaSimbolica').pending.join(' ')).toContain('60 caracteres');
    expect(por('venda')).toMatchObject({ status: 'draft', pending: [] });

    const venda = (await admin.get(`/fiscal/nfe/${por('venda').id}`)).json() as NfeInvoiceView;
    expect(venda.references).toEqual([chave]);
    expect(venda.items).toEqual([
      expect.objectContaining({ productId: vestido.id, quantityMilli: 1000 }),
    ]);
    // Estoque: as duas voltaram; a venda tira o vestido quando for emitida.
    expect(await saldo(vestido.id)).toBe(3000);
    await admin.post(`/fiscal/nfe/${venda.id}/issue`);
    await notas(admin, cond.id, (n) =>
      n.some((x) => x.demonstration === 'venda' && x.documentStatus === 'authorized'),
    );
    expect(await saldo(vestido.id)).toBe(2000);
    const vendaXml = (await admin.get(`/fiscal/nfe/${venda.id}/xml`)).body;
    expect(vendaXml).toContain(`<refNFe>${chave}</refNFe>`);
    expect(vendaXml).toContain(
      'Transmissão da Propriedade de mercadoria remetida para Demonstração',
    );

    // A entrada simbólica sai depois que a natureza abreviada é escrita na nota.
    const simbolica = (
      await admin.get(`/fiscal/nfe/${por('entradaSimbolica').id}`)
    ).json() as NfeInvoiceView;
    const corpo = {
      companyId: simbolica.companyId,
      storeId: simbolica.storeId,
      nature: 'Entrada simbólica em retorno de demonstração',
      presence: simbolica.presence,
      finalConsumer: simbolica.finalConsumer,
      references: simbolica.references,
      recipient: simbolica.recipient,
      items: simbolica.items.map((i) => ({
        productId: i.productId,
        quantityMilli: i.quantityMilli,
        unitPriceCents: i.unitPriceCents,
      })),
      payments: simbolica.payments,
    };
    const salva = await admin.put(`/fiscal/nfe/${simbolica.id}`, corpo);
    expect(salva.json()).toMatchObject({ demonstration: 'entradaSimbolica', check: { ok: true } });
    await admin.post(`/fiscal/nfe/${simbolica.id}/issue`);
    await notas(admin, cond.id, (n) =>
      n.some((x) => x.demonstration === 'entradaSimbolica' && x.documentStatus === 'authorized'),
    );
    const simbolicaXml = (await admin.get(`/fiscal/nfe/${simbolica.id}/xml`)).body;
    expect(simbolicaXml).toContain('<tpNF>0</tpNF>');
    expect(simbolicaXml).toContain('<CFOP>1949</CFOP>');
    expect(simbolicaXml).toContain(
      'Natureza da operação: Entrada Simbólica em Retorno de Mercadoria remetida para Demonstração',
    );
  });

  it('devolveu tudo: o cancelamento emite o retorno da remessa', async () => {
    sefaz.mode = 'normal';
    const { admin, loja, pecas, cliente } = await ateliê();
    const cond = (
      await admin.post('/conditionals', {
        storeId: loja.id,
        customerId: cliente.id,
        items: [{ productId: pecas[0].id, quantityMilli: 2000 }],
      })
    ).json();
    await notas(admin, cond.id, (n) => n[0]?.documentStatus === 'authorized');
    await admin.post(`/conditionals/${cond.id}/cancel`, {});
    const c = await notas(admin, cond.id, (n) =>
      n.some((x) => x.demonstration === 'retorno' && x.documentStatus === 'authorized'),
    );
    expect(c.invoices.map((n: { demonstration: string }) => n.demonstration)).toEqual([
      'remessa',
      'retorno',
    ]);
  });

  it('sem o perfil da venda condicional na empresa, nada de NF-e: o que ficou vai ao caixa', async () => {
    const { admin, loja, pecas, cliente } = await ateliê(false);
    const cond = (
      await admin.post('/conditionals', {
        storeId: loja.id,
        customerId: cliente.id,
        items: [{ productId: pecas[0].id, quantityMilli: 1000 }],
      })
    ).json();
    expect(cond.invoices).toEqual([]);
    const fechado = (
      await admin.post(`/conditionals/${cond.id}/close`, {
        items: [{ productId: pecas[0].id, keptMilli: 1000 }],
      })
    ).json();
    expect(fechado.tabOrderId).not.toBeNull();
    expect(fechado.invoices).toEqual([]);
    expect((await admin.get('/fiscal/nfe')).json()).toEqual([]);
  });

  it('o perfil escolhido precisa existir nesta conta', async () => {
    const { admin, empresa } = await ateliê(false);
    const outro = await ateliê(false);
    const r = await admin.patch(`/companies/${empresa.id}`, {
      legalName: 'Ateliê Bipaê LTDA',
      demonstrationProfileId: outro.perfilDemonstracao.id,
    });
    expect(r.statusCode).toBe(404);
  });
});
