import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { readPurchaseNfe } from '@bipae/fiscal';
import { notaDoFornecedor } from './support/supplier-nfe';

/**
 * F3-19: entrada de compra pelo XML da NF-e do fornecedor. O fornecedor e o certificado dele são
 * gerados na hora (nada versionado); a nota é montada e assinada pelo próprio motor do Bipaê.
 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function mercado() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: empresa.legalName,
    taxId: '11.222.333/0001-81',
    uf: 'SP',
  });
  const [loja] = (await admin.get('/stores')).json();
  return { admin, empresa, loja };
}

describe('compra pelo XML da NF-e (F3-19)', () => {
  it('mostra a prévia, cria fornecedor e produto, associa pelo código de barras e dá entrada no estoque', async () => {
    const { admin, empresa, loja } = await mercado();
    const agua = (
      await admin.post('/products', {
        name: 'Água 500 ml',
        priceCents: 300,
        barcodes: ['7891000100103'],
      })
    ).json();
    const xml = await notaDoFornecedor(1001);

    const previa = await admin.post('/purchases/preview', { xml });
    expect(previa.statusCode).toBe(201);
    const p = previa.json();
    expect(p).toMatchObject({
      number: 1001,
      authorized: true,
      environment: 'homologacao',
      signature: {
        valid: true,
        signer: 'DISTRIBUIDORA DE BEBIDAS LTDA:22333444000102',
        trusted: false,
      },
      company: { id: empresa.id },
      supplier: { id: null, name: 'Distribuidora de Bebidas LTDA', taxId: '22333444000102' },
      alreadyImported: false,
    });
    expect(p.items[0]).toMatchObject({
      supplierCode: 'FORN-REF2L',
      unit: 'CX',
      quantity: '10.0000',
      suggestion: null,
    });
    expect(p.items[1].suggestion).toMatchObject({
      productId: agua.id,
      via: 'codigo-de-barras',
      factor: '1',
    });

    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: agua.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    expect(entrada.json()).toMatchObject({ items: 2, createdProducts: 1 });

    // Refrigerante: 10 caixas × 6 = 60 unidades a R$ 5,00 (300,00 / 60).
    const produtos = (await admin.get('/products?q=Refrigerante')).json();
    const refri = (produtos.items ?? produtos).find((x: { name: string }) =>
      x.name.startsWith('Refrigerante cola'),
    );
    expect(refri).toMatchObject({
      unit: 'UN',
      priceCents: 899,
      costCents: 500,
      ncm: '22021000',
      barcodes: ['7894900011517'],
    });
    const estoque = (await admin.get(`/stock?productId=${refri.id}&productId=${agua.id}`)).json();
    expect(estoque).toEqual(
      expect.arrayContaining([
        { productId: refri.id, storeId: loja.id, quantityMilli: 60_000 },
        { productId: agua.id, storeId: loja.id, quantityMilli: 24_000 },
      ]),
    );
    // Água: 36,00 + 3,60 de IPI por 24 unidades = 1,65.
    expect((await admin.get(`/products/${agua.id}`)).json().costCents).toBe(165);

    const fornecedores = (await admin.get('/suppliers')).json();
    expect(fornecedores.items ?? fornecedores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Bebidas Já', taxId: '22333444000102' }),
      ]),
    );
    const compras = (await admin.get('/purchases')).json();
    expect(compras).toEqual([
      expect.objectContaining({
        number: 1001,
        supplierName: 'Bebidas Já',
        storeName: loja.name,
        authorized: true,
        itemCount: 2,
      }),
    ]);
    const auditoria = (await admin.get('/audit?action=purchase.imported')).json();
    expect(JSON.stringify(auditoria)).toContain('purchase.imported');

    // A mesma nota não entra duas vezes.
    const repetida = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: refri.id },
        { line: 2, productId: agua.id },
      ],
    });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().message).toBe('A NF-e 1001 deste fornecedor já foi importada.');

    // Na próxima nota do fornecedor, os itens já vêm associados, com o fator de conversão.
    const proxima = (
      await admin.post('/purchases/preview', { xml: await notaDoFornecedor(1002) })
    ).json();
    expect(proxima.supplier.id).not.toBeNull();
    expect(proxima.items[0].suggestion).toMatchObject({
      productId: refri.id,
      via: 'fornecedor',
      factor: '6',
    });
    expect(proxima.items[1].suggestion).toMatchObject({ productId: agua.id, via: 'fornecedor' });

    // Outro cliente não vê a compra.
    const outro = await mercado();
    expect((await outro.admin.get('/purchases')).json()).toEqual([]);
  });

  it('recusa XML alterado, nota de outra empresa e item sem decisão', async () => {
    const { admin, loja } = await mercado();
    const xml = await notaDoFornecedor(2001);
    const alterado = xml.replace('Água mineral 500 ml', 'Água mineral 1,5 L');
    const previa = (await admin.post('/purchases/preview', { xml: alterado })).json();
    expect(previa.signature.valid).toBe(false);
    const recusada = await admin.post('/purchases', {
      xml: alterado,
      storeId: loja.id,
      items: [
        { line: 1, productId: null },
        { line: 2, productId: null },
      ],
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().message).toMatch(/assinatura digital da nota não confere/);

    const semSaida = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [{ line: 1, productId: null, unit: 'UN' }],
    });
    expect(semSaida.json().message).toBe('Diga o que fazer com o item 2 (Água mineral 500 ml).');
    const unidade = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, unit: 'XYZ' },
        { line: 2, productId: null },
      ],
    });
    expect(unidade.json().message).toBe(
      'A unidade XYZ do item 1 não está cadastrada. Escolha uma das suas unidades.',
    );
    const fator = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '0' },
        { line: 2, productId: null },
      ],
    });
    expect(fator.json().message).toMatch(/Fator de conversão inválido/);

    const outra = await notaDoFornecedor(2002, {
      recipient: {
        cnpj: '11444777000161',
        name: 'Outra empresa',
        ieIndicator: 1,
        ie: '999888777666',
        address: {
          street: 'Rua B',
          number: '2',
          district: 'Centro',
          cityCode: '3550308',
          cityName: 'São Paulo',
          uf: 'SP',
          cep: '01001000',
        },
      },
    });
    const naoEMinha = await admin.post('/purchases/preview', { xml: outra });
    expect(naoEMinha.statusCode).toBe(400);
    expect(naoEMinha.json().message).toBe(
      'Esta nota não é para nenhuma empresa sua: o destinatário é o CNPJ 11444777000161.',
    );

    const nfce = await admin.post('/purchases/preview', {
      xml: xml.replace('<mod>55</mod>', '<mod>65</mod>'),
    });
    expect(nfce.json().message).toBe(
      'Só a NF-e (modelo 55) dá entrada de compra; cupom e NFC-e não.',
    );
  });
});

describe('custo da compra sem os créditos recuperáveis (dúvida D-024)', () => {
  it('Lucro Real: o ICMS, o PIS e a COFINS da nota saem do custo do produto', async () => {
    const { admin, empresa, loja } = await mercado();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'SP',
      taxRegime: 'real',
    });
    const xml = await notaDoFornecedor(2001);
    const [item] = readPurchaseNfe(xml).items;
    const creditos =
      (item!.taxes.icms?.amountCents ?? 0) + item!.taxes.pisCents + item!.taxes.cofinsCents;
    expect(creditos).toBeGreaterThan(0);
    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: null, factor: 1, priceCents: 300 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    const produtos = (await admin.get('/products?q=Refrigerante')).json();
    const refri = (produtos.items ?? produtos).find((x: { name: string }) =>
      x.name.startsWith('Refrigerante cola'),
    );
    const bruto =
      item!.totalCents -
      item!.discountCents +
      item!.freightCents +
      item!.insuranceCents +
      item!.otherCents +
      item!.stCents +
      item!.ipiCents;
    // 10 caixas × 6 = 60 unidades.
    expect(refri.costCents).toBe(Math.round((bruto - creditos) / 60));
    expect(refri.costCents).toBeLessThan(Math.round(bruto / 60));
  });
});

describe('finalidade da compra e o arquivo da EFD (F4-14.b.2)', () => {
  it('a compra entra no SPED com crédito na revenda e sem crédito no uso e consumo', async () => {
    const { admin, empresa, loja } = await mercado();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'SP',
      taxRegime: 'presumido',
      ie: '110042490114',
      cityCode: '3550308',
    });
    const xml = await notaDoFornecedor(2002);
    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: null, factor: 1, priceCents: 300 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    const [compra] = (await admin.get('/purchases')).json();
    expect(compra.purpose).toBe('resale');

    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
      .format(new Date())
      .slice(0, 7);
    const arquivo = async () => {
      const res = await admin.get(`/fiscal/efd/file?companyId=${empresa.id}&month=${mes}`);
      expect(res.statusCode).toBe(200);
      return res.rawPayload
        .toString('latin1')
        .split('\r\n')
        .filter(Boolean)
        .map((l) => l.slice(1, -1).split('|'));
    };
    const revenda = await arquivo();
    const c100 = revenda.find((l) => l[0] === 'C100')!;
    expect(c100.slice(1, 3)).toEqual(['0', '1']); // entrada de terceiros
    expect(revenda.filter((l) => l[0] === 'C170')).toHaveLength(2);
    expect(revenda.filter((l) => l[0] === 'C170').every((l) => /^[12]/.test(l[10]!))).toBe(true);
    expect(revenda.some((l) => l[0] === '0200')).toBe(true);
    const resumo = (
      await admin.get(`/fiscal/efd/summary?companyId=${empresa.id}&month=${mes}`)
    ).json();
    expect(resumo.settlement.creditsCents).toBe(Number(c100[21]!.replace(',', '')));

    const ruim = await admin.put(`/purchases/${compra.id}/purpose`, { purpose: 'presente' });
    expect(ruim.statusCode).toBe(400);
    const salvo = await admin.put(`/purchases/${compra.id}/purpose`, { purpose: 'consumption' });
    expect(salvo.json()).toEqual({ id: compra.id, purpose: 'consumption' });
    const consumo = await arquivo();
    // Uso e consumo: CFOP 1556 ou 1407 (com ST) e nenhum crédito até 2033.
    expect(
      consumo.filter((l) => l[0] === 'C170').every((l) => ['1556', '1407'].includes(l[10]!)),
    ).toBe(true);
    expect(consumo.find((l) => l[0] === 'C100')![21]).toBe('0,00');
    expect(JSON.stringify((await admin.get('/audit?limit=10')).json())).toContain(
      'purchase.purpose',
    );
  });
});

describe('compra para o ativo e o CIAP no arquivo da EFD (F4-14.b.7)', () => {
  it('cada item vira um bem; março leva IM com G130 e abril leva SI com a parcela 2', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    const [loja] = (await admin.get('/stores')).json();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'SP',
      taxRegime: 'presumido',
      ie: '110042490114',
      cityCode: '3550308',
    });
    const entrada = await admin.post('/purchases', {
      xml: await notaDoFornecedor(2003),
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: null, factor: 1, priceCents: 300 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    const [compra] = (await admin.get('/purchases')).json();
    const ativo = await admin.put(`/purchases/${compra.id}/purpose`, { purpose: 'fixed_asset' });
    expect(ativo.statusCode).toBe(200);

    // A compra e os bens vão para 10/03/2026, para o teste não depender do mês de hoje.
    const escopo = { tenantId: dono.me.tenant.id };
    const bens = await withTenant(t.database.db, escopo, async (tx) => {
      await tx.execute(
        sql`update purchase_invoices set created_at = '2026-03-10T12:00:00-03:00' where id = ${compra.id}`,
      );
      await tx.execute(sql`update ciap_assets set entered_on = '2026-03-10'`);
      return rowsOf<{ code: string; own: number }>(
        await tx.execute(
          sql`select code, icms_own_cents::int as own from ciap_assets order by item_line`,
        ),
      );
    });
    // ICMS destacado de 18% em R$ 300,00 e em R$ 36,00.
    expect(bens.map((b) => b.own)).toEqual([5400, 648]);

    const salvar = await admin.put('/fiscal/efd/settings', {
      companyId: empresa.id,
      ciapAccountCode: '1.2.3.01',
      ciapAccountName: 'Máquinas e equipamentos',
      ciapAccountLevel: 4,
      ciapAdjustmentCode: 'SP020001',
    });
    expect(salvar.statusCode).toBe(200);

    const arquivo = async (mes: string) => {
      const res = await admin.get(`/fiscal/efd/file?companyId=${empresa.id}&month=${mes}`);
      expect(res.statusCode, res.body).toBe(200);
      const linhas = res.rawPayload
        .toString('latin1')
        .split('\r\n')
        .filter(Boolean)
        .map((l) => l.slice(1, -1).split('|'));
      return (reg: string) => linhas.filter((l) => l[0] === reg);
    };
    const parcelas = (g125: string[][]) =>
      g125.reduce((s, l) => s + Number((l[9] || '0').replace(',', '')), 0);

    const marco = await arquivo('2026-03');
    expect(marco('G001')[0]![1]).toBe('0');
    expect(marco('G125').map((l) => [l[1], l[3], l[8], l[9]])).toEqual([
      [bens[0]!.code, 'IM', '1', '1,12'], // 54,00 / 48 = 1,125: trunca em 1,12
      [bens[1]!.code, 'IM', '1', '0,13'],
    ]);
    const g110 = marco('G110')[0]!;
    expect(Number(g110[4]!.replace(',', ''))).toBe(parcelas(marco('G125')));
    expect(g110[3]).toBe('0,00'); // sem saldo inicial no mês da entrada
    expect(marco('G130')).toHaveLength(2);
    expect(marco('G140').map((l) => l[1])).toEqual(['1', '2']);
    expect(marco('0300').map((l) => [l[1], l[5], l[6]])).toEqual([
      [bens[0]!.code, '1.2.3.01', '48'],
      [bens[1]!.code, '1.2.3.01', '48'],
    ]);
    expect(marco('9900').find((l) => l[1] === 'G125')![2]).toBe('2');
    // Sem vendas no mês, o índice é zero e nada vai ao E111.
    expect(g110[7]).toBe('0,00000000');
    expect(marco('E111')).toHaveLength(0);

    const abril = await arquivo('2026-04');
    expect(abril('G125').map((l) => [l[3], l[2], l[8], l[9]])).toEqual([
      ['SI', '01042026', '2', '1,12'],
      ['SI', '01042026', '2', '0,13'],
    ]);
    expect(abril('G110')[0]![3]).toBe('60,48'); // saldo inicial: 54,00 + 6,48
    expect(abril('G130')).toHaveLength(0);

    // Com parcela em arquivo baixado, a finalidade não muda mais.
    const trocar = await admin.put(`/purchases/${compra.id}/purpose`, { purpose: 'resale' });
    expect(trocar.statusCode).toBe(422);
    const controle = await withTenant(t.database.db, escopo, async (tx) =>
      rowsOf<{ n: number }>(
        await tx.execute(
          sql`select appropriated_installments::int as n from ciap_assets order by item_line`,
        ),
      ).map((r) => r.n),
    );
    expect(controle).toEqual([2, 2]);
  });
});

describe('ST de entrada pela carga líquida do Ceará (F3-26.d.CE.c)', () => {
  it('CNAE na empresa, classe no produto: a carga entra na prévia, no custo e na compra', async () => {
    const { admin, empresa, loja } = await mercado();
    // Varejo do vestuário (Anexo II do Decreto 34.256/2021), com a CNAE mascarada.
    const salva = await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'CE',
      cnae: '4781-4/00',
    });
    expect(salva.statusCode).toBe(200);
    expect(salva.json()).toMatchObject({ cnae: '4781400', stSpecialRegime: false });
    expect(
      (await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, cnae: '12' }))
        .statusCode,
    ).toBe(400);

    const invalida = await admin.post('/products', {
      name: 'Água 500 ml',
      priceCents: 300,
      stNetLoadClass: 'rate-99',
    });
    expect(invalida.statusCode).toBe(400);
    expect(invalida.json().message).toMatch(/classe da mercadoria/);
    const agua = (
      await admin.post('/products', {
        name: 'Água 500 ml',
        priceCents: 300,
        barcodes: ['7891000100103'],
        stNetLoadClass: 'rate-20',
      })
    ).json();
    expect(agua.stNetLoadClass).toBe('rate-20');

    const xml = await notaDoFornecedor(3001);
    const previa = (await admin.post('/purchases/preview', { xml })).json();
    // Fornecedor de SP, mercadoria a 20%: 15,60%. Água: (36,00 + 3,60 de IPI) × 1,5 = 59,40.
    expect(previa.items[1].netLoad).toMatchObject({
      status: 'applies',
      act: 'Decreto 34.256/2021 (CE)',
      totalPercent: '15.60',
      baseCents: 5_940,
      stCents: 927,
    });
    // Produto novo, sem classe: falta configurar, sem valor.
    expect(previa.items[0].netLoad).toMatchObject({ status: 'choose-class', stCents: 0 });
    expect(previa.items[0].netLoad.message).toMatch(/escolha no produto a classe/);

    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: agua.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    expect(entrada.json()).toMatchObject({ stNetLoadCents: 927 });
    // Custo da água: (36,00 + 3,60 + 9,27) / 24 = 2,036 → R$ 2,04.
    expect((await admin.get(`/products/${agua.id}`)).json().costCents).toBe(204);
  });

  it('com RET a carga fica como "falta configurar", sem valor e sem travar a compra', async () => {
    const { admin, empresa, loja } = await mercado();
    await admin.patch(`/companies/${empresa.id}`, {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'CE',
      cnae: '4781400',
      stSpecialRegime: true,
    });
    const agua = (
      await admin.post('/products', {
        name: 'Água 500 ml',
        priceCents: 300,
        barcodes: ['7891000100103'],
        stNetLoadClass: 'rate-20',
      })
    ).json();
    const xml = await notaDoFornecedor(3002);
    const previa = (await admin.post('/purchases/preview', { xml })).json();
    expect(previa.items[1].netLoad).toMatchObject({ status: 'missing', stCents: 0 });
    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: agua.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    expect(entrada.json().stNetLoadCents).toBe(0);
    // Sem a carga, o custo é o de sempre: 39,60 / 24 = 1,65.
    expect((await admin.get(`/products/${agua.id}`)).json().costCents).toBe(165);
  });

  it('transferência de outra UF na construção: falta configurar até a empresa escolher a leitura (F3-26.d.CE.e)', async () => {
    const { admin, empresa } = await mercado();
    const base = {
      legalName: empresa.legalName,
      taxId: '11.222.333/0001-81',
      uf: 'CE',
      // Comércio varejista de material de construção (Anexo II do Decreto 31.270/2013).
      cnae: '4741-5/00',
    };
    expect((await admin.patch(`/companies/${empresa.id}`, base)).statusCode).toBe(200);
    const classes = (await admin.get('/fiscal/st-net-load-classes?uf=CE&cnae=4741500')).json();
    expect(classes.choices).toMatchObject({
      transferMargin: { caputMva: '35', transferMva: '50', interstateOnly: true },
    });
    await admin.post('/products', {
      name: 'Água 500 ml',
      priceCents: 300,
      barcodes: ['7891000100103'],
      stNetLoadClass: 'rate-20',
    });
    // A filial de SP manda para a matriz no Ceará: mesma raiz do CNPJ (11.222.333), transferência.
    const xml = await notaDoFornecedor(3003, {
      issuer: {
        cnpj: '11222333000262',
        name: 'Mercadinho Bipaê LTDA - filial SP',
        ie: '110042490114',
        crt: 3,
        address: {
          street: 'Av. Industrial',
          number: '500',
          district: 'Distrito',
          cityCode: '3550308',
          cityName: 'São Paulo',
          uf: 'SP',
          cep: '01001000',
        },
      },
    });
    const sem = (await admin.post('/purchases/preview', { xml })).json();
    expect(sem.items[1].netLoad).toMatchObject({ status: 'missing', stCents: 0 });
    expect(sem.items[1].netLoad.message).toMatch(/Empresas e lojas/);

    expect(
      (
        await admin.patch(`/companies/${empresa.id}`, {
          ...base,
          stNetLoadOptions: { transferMargin: 'talvez' },
        })
      ).statusCode,
    ).toBe(400);
    const salva = await admin.patch(`/companies/${empresa.id}`, {
      ...base,
      stNetLoadOptions: { transferMargin: 'compound' },
    });
    expect(salva.json().stNetLoadOptions).toMatchObject({ transferMargin: 'compound' });
    const com = (await admin.post('/purchases/preview', { xml })).json();
    // (36,00 + 3,60 de IPI) × 1,35 × 1,50 = 80,19; × 21% = 16,84.
    expect(com.items[1].netLoad).toMatchObject({
      status: 'applies',
      mva: '102.5',
      baseCents: 8_019,
      stCents: 1_684,
    });
  });
});

describe('carnes do Maranhão por carga fixa na compra (F3-26.d.MA.d)', () => {
  it('sem CNAE, classe no produto: 3% sobre o valor + 25%; IPI só entra com a escolha da empresa', async () => {
    const { admin, empresa, loja } = await mercado();
    const base = { legalName: empresa.legalName, taxId: '11.222.333/0001-81', uf: 'MA' };
    expect((await admin.patch(`/companies/${empresa.id}`, base)).statusCode).toBe(200);
    // O produto de teste faz o papel da carne: a classe é a da empresa, o anexo não tem NCM.
    const carne = (
      await admin.post('/products', {
        name: 'Carne bovina (teste)',
        priceCents: 300,
        barcodes: ['7891000100103'],
        stNetLoadClass: 'ma-meat',
      })
    ).json();
    expect(carne.stNetLoadClass).toBe('ma-meat');
    const xml = await notaDoFornecedor(3101);
    const sem = (await admin.post('/purchases/preview', { xml })).json();
    // O item tem IPI, que o art. 5º do Anexo 4.4 não cita: falta configurar (D-051).
    expect(sem.items[1].netLoad).toMatchObject({ status: 'missing', stCents: 0 });
    expect(sem.items[1].netLoad.message).toMatch(/D-051/);
    // Refrigerante sem classe e fora dos NCM de carne: nada a dizer.
    expect(sem.items[0].netLoad).toMatchObject({ status: 'not-listed' });

    expect(
      (
        await admin.patch(`/companies/${empresa.id}`, {
          ...base,
          stNetLoadOptions: { meatPlant: 'talvez' },
        })
      ).statusCode,
    ).toBe(400);
    const salva = await admin.patch(`/companies/${empresa.id}`, {
      ...base,
      stNetLoadOptions: { meatPlant: 'none', meatBaseCharges: 'exclude' },
    });
    expect(salva.json().stNetLoadOptions).toMatchObject({
      meatPlant: 'none',
      meatBaseCharges: 'exclude',
    });
    const com = (await admin.post('/purchases/preview', { xml })).json();
    // 36,00 × 1,25 = 45,00; × 3% = 1,35.
    expect(com.items[1].netLoad).toMatchObject({
      status: 'applies',
      act: 'RICMS/MA, Anexo 4.4',
      totalPercent: '3',
      baseCents: 4_500,
      stCents: 135,
    });
    const entrada = await admin.post('/purchases', {
      xml,
      storeId: loja.id,
      items: [
        { line: 1, productId: null, factor: '6', unit: 'UN', priceCents: 899 },
        { line: 2, productId: carne.id, factor: 1 },
      ],
    });
    expect(entrada.statusCode).toBe(201);
    expect(entrada.json()).toMatchObject({ stNetLoadCents: 135 });
  });
});
