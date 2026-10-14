import { terminalEvent, uuidv7, type SyncPullResult } from '@bipae/domain';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { addItem, EMPTY_CART, setSaleDiscount } from './cart';
import { PdvError, PdvService } from './service';

const TERMINAL = uuidv7();
const OPERATOR = uuidv7();
const MANAGER = uuidv7();

const product = (
  over: Partial<{
    id: string;
    name: string;
    priceCents: number;
    isWeighable: boolean;
    sku: string;
    barcodes: string[];
    active: boolean;
  }> = {},
) => ({
  id: over.id ?? uuidv7(),
  name: over.name ?? 'Arroz Tipo 1 5kg',
  sku: over.sku ?? null,
  unit: over.isWeighable ? 'KG' : 'UN',
  priceCents: over.priceCents ?? 2890,
  isWeighable: over.isWeighable ?? false,
  active: over.active ?? true,
  ncm: null,
  cest: null,
  fiscalProfileId: null,
  parentId: null,
  barcodes: over.barcodes ?? [],
  updatedAt: new Date().toISOString(),
});

let pdv: PdvService;
let storage: ReturnType<typeof createStorage>;

beforeEach(async () => {
  storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  pdv = new PdvService(storage, { terminalId: TERMINAL, operatorId: OPERATOR });
});

describe('catalog on the terminal', () => {
  it('finds by barcode, SKU, PLU and accent-insensitive name', async () => {
    const coffee = product({ name: 'Café Torrado 500g', barcodes: ['7891000315507'], sku: 'CAF1' });
    const banana = product({ name: 'Banana Prata', isWeighable: true, sku: '00123' });
    await pdv.applyCatalog([
      coffee,
      banana,
      product({ name: 'Inativo', active: false, barcodes: ['78912342'] }),
    ]);
    expect((await pdv.findByCode('7891000315507'))?.id).toBe(coffee.id);
    expect((await pdv.findByCode('CAF1'))?.id).toBe(coffee.id);
    expect(await pdv.findByCode('78912342')).toBeNull();
    expect((await pdv.findByPlu('123'))?.id).toBe(banana.id);
    expect((await pdv.search('cafe torr')).map((p) => p.name)).toEqual(['Café Torrado 500g']);
    expect(await pdv.search('   ')).toEqual([]);
    expect(await pdv.catalogSize()).toBe(3);
    // Updates replace barcodes.
    await pdv.applyCatalog([{ ...coffee, barcodes: ['96385074'] }]);
    expect(await pdv.findByCode('7891000315507')).toBeNull();
    expect((await pdv.findByCode('96385074'))?.id).toBe(coffee.id);
  });
});

describe('selling', () => {
  it('requires an open register and an item', async () => {
    const p = product();
    await expect(
      pdv.completeSale(addItem(EMPTY_CART, p), [{ method: 'cash', receivedCents: 5000 }], {
        discountLimitPercent: 10,
      }),
    ).rejects.toThrow('Abra o caixa');
    await pdv.openSession(10000);
    await expect(pdv.openSession(0)).rejects.toThrow('já está aberto');
    await expect(pdv.completeSale(EMPTY_CART, [], { discountLimitPercent: 10 })).rejects.toThrow(
      'vazio',
    );
    await expect(
      pdv.completeSale(addItem(EMPTY_CART, p), [{ method: 'pix', receivedCents: 100 }], {
        discountLimitPercent: 10,
      }),
    ).rejects.toThrow('falta receber');
  });

  it('stores the sale and queues a valid event atomically, with sequential numbers', async () => {
    const p = product();
    await pdv.openSession(10000);
    const first = await pdv.completeSale(
      addItem(EMPTY_CART, p),
      [{ method: 'cash', receivedCents: 5000 }],
      { discountLimitPercent: 10 },
    );
    const second = await pdv.completeSale(
      { ...addItem(EMPTY_CART, p), customerTaxId: '12345678909' },
      [{ method: 'pix', receivedCents: 2890, provider: 'Simulador' }],
      { discountLimitPercent: 10 },
    );
    expect([first.terminalSeq, second.terminalSeq]).toEqual([1, 2]);
    expect(first.payments[0]).toMatchObject({ amountCents: 2890, changeCents: 2110 });

    const events = await pdv.pendingEvents();
    expect(events.map((e) => e.type)).toEqual([
      'cash_session.opened',
      'sale.completed',
      'sale.completed',
    ]);
    expect(events.map((e) => e.deviceSeq)).toEqual([1, 2, 3]);
    for (const e of events) expect(terminalEvent.safeParse(e).success).toBe(true);
    expect(await pdv.pendingCount()).toBe(3);
    await pdv.markSent(events.slice(0, 2).map((e) => e.id));
    expect(await pdv.pendingCount()).toBe(1);
    await pdv.markFailed(events[2]!.id, 'offline');
    expect((await pdv.pendingEvents()).map((e) => e.id)).toEqual([events[2]!.id]);
    expect((await pdv.findSaleBySeq(2))?.customerTaxId).toBe('12345678909');
  });

  it('does not store a sale when queuing its event fails (same transaction)', async () => {
    await pdv.openSession(0);
    const broken = { ...addItem(EMPTY_CART, product()), customerTaxId: 'not-a-cpf' };
    await expect(
      pdv.completeSale(broken, [{ method: 'cash', receivedCents: 5000 }], {
        discountLimitPercent: 10,
      }),
    ).rejects.toThrow();
    expect(await pdv.listSales()).toHaveLength(0);
    expect(await pdv.pendingCount()).toBe(1); // only the session opening
  });

  it('discount above the limit needs authorization, which is recorded', async () => {
    await pdv.openSession(0);
    const cart = setSaleDiscount(addItem(EMPTY_CART, product({ priceCents: 1000 })), 200);
    await expect(
      pdv.completeSale(cart, [{ method: 'cash', receivedCents: 800 }], {
        discountLimitPercent: 10,
      }),
    ).rejects.toThrow('autorização de um gerente');
    await pdv.completeSale(cart, [{ method: 'cash', receivedCents: 800 }], {
      discountLimitPercent: 10,
      discountAuthorizedBy: MANAGER,
    });
    const [, sale] = await pdv.pendingEvents();
    expect(sale?.type === 'sale.completed' && sale.payload.discountAuthorizedBy).toBe(MANAGER);
  });
});

describe('cancel and returns', () => {
  it('cancels a sale once, with reason', async () => {
    await pdv.openSession(0);
    const sale = await pdv.completeSale(
      addItem(EMPTY_CART, product()),
      [{ method: 'cash', receivedCents: 2890 }],
      { discountLimitPercent: 10 },
    );
    await expect(pdv.cancelSale(sale.id, 'x', MANAGER)).rejects.toThrow('motivo');
    await pdv.cancelSale(sale.id, 'Cliente desistiu', MANAGER);
    expect((await pdv.getSale(sale.id))?.status).toBe('cancelled');
    await expect(pdv.cancelSale(sale.id, 'de novo', MANAGER)).rejects.toThrow('já foi cancelada');
    await expect(pdv.cancelSale(uuidv7(), 'nada', MANAGER)).rejects.toThrow('não encontrada');
  });

  it('partial returns by item never refund more than paid, to the cent', async () => {
    await pdv.openSession(0);
    const p = product({ priceCents: 1000 });
    const cart = setSaleDiscount(addItem(EMPTY_CART, p, 3000), 1); // 3 × 10,00 − 0,01
    const sale = await pdv.completeSale(cart, [{ method: 'cash', receivedCents: 2999 }], {
      discountLimitPercent: 10,
    });
    const r1 = await pdv.returnItems(
      sale.id,
      [{ line: 1, quantityMilli: 1000 }],
      'cash',
      'Defeito',
    );
    const r2 = await pdv.returnItems(
      sale.id,
      [{ line: 1, quantityMilli: 2000 }],
      'cash',
      'Defeito',
    );
    expect(r1.totalCents + r2.totalCents).toBe(2999);
    await expect(
      pdv.returnItems(sale.id, [{ line: 1, quantityMilli: 1000 }], 'cash', 'Defeito'),
    ).rejects.toThrow('Só dá para devolver até 0');
    await expect(
      pdv.returnItems(sale.id, [{ line: 9, quantityMilli: 1000 }], 'cash', 'Defeito'),
    ).rejects.toThrow('não está nesta venda');
    await expect(
      pdv.returnItems(sale.id, [{ line: 1, quantityMilli: 1 }], 'cash', 'x'),
    ).rejects.toThrow('motivo');
    await expect(pdv.cancelSale(sale.id, 'Tentativa', MANAGER)).rejects.toThrow(
      'já teve devolução',
    );
    const returned = (await pdv.pendingEvents()).filter((e) => e.type === 'sale.returned');
    expect(returned).toHaveLength(2);
  });
});

describe('cash session', () => {
  it('movements, blind close and protection against impossible withdrawals', async () => {
    await expect(pdv.addMovement('supply', 100, null)).rejects.toThrow('Abra o caixa');
    await pdv.openSession(10000);
    await pdv.completeSale(
      addItem(EMPTY_CART, product({ priceCents: 2500 })),
      [{ method: 'cash', receivedCents: 3000 }],
      { discountLimitPercent: 10 },
    );
    await pdv.completeSale(
      addItem(EMPTY_CART, product({ priceCents: 1000 })),
      [{ method: 'debit', receivedCents: 1000 }],
      { discountLimitPercent: 10 },
    );
    await expect(pdv.addMovement('withdrawal', 999999, 'Banco')).rejects.toThrow(
      'maior que o dinheiro',
    );
    await expect(pdv.addMovement('supply', 0, null)).rejects.toThrow('maior que zero');
    await pdv.addMovement('withdrawal', 5000, 'Depósito no banco', MANAGER);
    await pdv.addMovement('supply', 2000, 'Troco');
    const result = await pdv.closeSession({ cash: 31000, debit: 1000 });
    expect(result.expected.cash).toBe(10000 + 2500 - 5000 + 2000);
    expect(result.differenceCents).toBe(31000 - 9500);
    expect(await pdv.currentSession()).toBeNull();
    const types = (await pdv.pendingEvents()).map((e) => e.type);
    expect(types.at(-1)).toBe('cash_session.closed');
    expect(types.filter((t) => t === 'cash_session.movement')).toHaveLength(2);
    await expect(pdv.sessionActivity(uuidv7())).rejects.toBeInstanceOf(PdvError);
    await expect(pdv.openSession(-1)).rejects.toThrow('inválido');
  });
});

describe('quotes', () => {
  it('saves, lists and converts a quote with current prices', async () => {
    const p = product({ priceCents: 1000 });
    await pdv.applyCatalog([p]);
    const id = await pdv.saveQuote(addItem(EMPTY_CART, p, 2000));
    expect(await pdv.listQuotes()).toMatchObject([{ id, totalCents: 2000, items: 1 }]);
    await pdv.applyCatalog([{ ...p, priceCents: 1100 }]);
    const cart = await pdv.loadQuote(id);
    expect(cart.lines[0]!.unitPriceCents).toBe(1100);
    await pdv.openSession(0);
    await pdv.completeSale(cart, [{ method: 'pix', receivedCents: 2200 }], {
      discountLimitPercent: 10,
    });
    expect(await pdv.listQuotes()).toEqual([]);
    await expect(pdv.loadQuote(id)).rejects.toThrow('não encontrado');
    await expect(pdv.saveQuote(EMPTY_CART)).rejects.toThrow('vazio');
  });

  it('switching operator is reflected in new events', async () => {
    pdv.setOperator(MANAGER);
    await pdv.openSession(0);
    expect((await pdv.pendingEvents())[0]!.operatorId).toBe(MANAGER);
  });
});

describe('variações no caixa (F1-04)', () => {
  it('o modelo com variações ativas não aparece; as variações sim', async () => {
    const modelo = product({ name: 'Camiseta Básica', barcodes: ['7890000000024'] });
    const p = {
      ...product({ name: 'Camiseta Básica — P', barcodes: ['7890000000031'] }),
      parentId: modelo.id,
    };
    const m = { ...product({ name: 'Camiseta Básica — M' }), parentId: modelo.id };
    await pdv.applyCatalog([modelo, p, m]);

    expect((await pdv.search('camiseta')).map((x) => x.name)).toEqual([
      'Camiseta Básica — M',
      'Camiseta Básica — P',
    ]);
    expect(await pdv.findByCode('7890000000024')).toBeNull();
    expect((await pdv.findByCode('7890000000031'))!.name).toBe('Camiseta Básica — P');

    // Sem variações ativas, o produto volta a ser vendido normalmente.
    await pdv.applyCatalog([
      { ...p, active: false },
      { ...m, active: false },
    ]);
    expect((await pdv.search('camiseta')).map((x) => x.name)).toEqual(['Camiseta Básica']);
  });
});

describe('dados fiscais guardados no caixa (F3-06.d2)', () => {
  const perfil = {
    cfopInterna: '5102',
    cfopInterestadual: '6102',
    csosn: '102',
    cstIcms: null,
    cstPisCofins: null,
    cClassTrib: '000001',
  };

  it('antes da primeira sincronização o caixa não sabe a UF nem o regime', async () => {
    const contexto = await pdv.fiscalContext();
    expect(contexto.company).toEqual({ uf: null, taxRegime: null });
    expect(contexto.profiles.size).toBe(0);
  });

  it('guarda a empresa e os perfis, e troca tudo quando chega um retrato novo', async () => {
    const id = uuidv7();
    await pdv.applyFiscal({
      version: 'v1',
      company: { uf: 'SP', taxRegime: 'simples' },
      profiles: [{ id, ...perfil }],
    });
    const primeiro = await pdv.fiscalContext();
    expect(primeiro.company).toEqual({ uf: 'SP', taxRegime: 'simples' });
    expect(primeiro.profiles.get(id)).toEqual(perfil);

    // O retrato novo substitui o anterior por inteiro: perfil que saiu do servidor sai do caixa.
    const outro = uuidv7();
    await pdv.applyFiscal({
      version: 'v2',
      company: { uf: null, taxRegime: null },
      profiles: [{ id: outro, ...perfil, csosn: '500' }],
    });
    const segundo = await pdv.fiscalContext();
    expect(segundo.company).toEqual({ uf: null, taxRegime: null });
    expect([...segundo.profiles.keys()]).toEqual([outro]);
    expect(segundo.profiles.get(outro)!.csosn).toBe('500');
  });
});

describe('impostos calculados ao fechar a venda (F3-06.d3)', () => {
  const PERFIL = uuidv7();
  const perfil = {
    cfopInterna: '5102',
    cfopInterestadual: '6102',
    csosn: '102',
    cstIcms: '00',
    cstPisCofins: '01',
    cClassTrib: '000001',
  };
  const vender = async (itens: SyncPullResult['products']) => {
    await pdv.applyCatalog(itens);
    await pdv.openSession(0);
    const carrinho = itens.reduce((cart, item) => addItem(cart, item), EMPTY_CART);
    const total = itens.reduce((soma, item) => soma + item.priceCents, 0);
    return pdv.completeSale(carrinho, [{ method: 'pix', receivedCents: total }], {
      discountLimitPercent: 10,
    });
  };

  it('empresa sem UF e sem regime: a venda sai sem resumo de impostos', async () => {
    const venda = await vender([product({ priceCents: 10_000 })]);
    expect(venda.items[0]!.taxes).toBeUndefined();
  });

  it('com a empresa e o perfil configurados, cada item leva os seus impostos, sem internet', async () => {
    await pdv.applyFiscal({
      version: 'v1',
      company: { uf: 'SP', taxRegime: 'real' },
      profiles: [{ id: PERFIL, ...perfil }],
    });
    const comPerfil = {
      ...product({ name: 'Arroz', priceCents: 10_000 }),
      fiscalProfileId: PERFIL,
    };
    const semPerfil = product({ name: 'Sem perfil', priceCents: 5000 });
    const venda = await vender([comPerfil, semPerfil]);

    expect(venda.items[0]!.taxes).toEqual({
      crt: 3,
      cfop: '5102',
      icmsCents: 1800,
      icmsStCents: null,
      fcpCents: null,
      pisCents: 135,
      cofinsCents: 623,
      ibsCents: 7,
      cbsCents: 67,
      complete: true,
      pending: [],
    });
    expect(venda.items[1]!.taxes).toMatchObject({ icmsCents: null, complete: false });
    expect(venda.items[1]!.taxes!.pending).toEqual([
      'O produto não tem perfil fiscal. Escolha um no cadastro do produto.',
    ]);

    // O evento que vai para o servidor leva os mesmos impostos e passa na validação do domínio.
    const evento = (await pdv.pendingEvents()).find((e) => e.type === 'sale.completed')!;
    expect(terminalEvent.safeParse(evento).success).toBe(true);
    expect((evento.payload as { items: { taxes?: unknown }[] }).items[0]!.taxes).toEqual(
      venda.items[0]!.taxes,
    );
    // E a venda guardada no caixa também.
    expect((await pdv.getSale(venda.id))!.items[0]!.taxes).toEqual(venda.items[0]!.taxes);
  });

  it('o desconto da venda reduz a base dos impostos de cada item', async () => {
    await pdv.applyFiscal({
      version: 'v1',
      company: { uf: 'SP', taxRegime: 'presumido' },
      profiles: [{ id: PERFIL, ...perfil }],
    });
    const item = { ...product({ priceCents: 10_000 }), fiscalProfileId: PERFIL };
    await pdv.applyCatalog([item]);
    await pdv.openSession(0);
    const venda = await pdv.completeSale(
      setSaleDiscount(addItem(EMPTY_CART, item), 1000),
      [{ method: 'pix', receivedCents: 9000 }],
      { discountLimitPercent: 10 },
    );
    // 90,00 × 18% = 16,20
    expect(venda.items[0]!.totalCents).toBe(9000);
    expect(venda.items[0]!.taxes).toMatchObject({
      icmsCents: 1620,
      pisCents: 59,
      cofinsCents: 270,
    });
  });

  it('um problema nos dados fiscais nunca impede a venda', async () => {
    await pdv.applyFiscal({
      version: 'v1',
      company: { uf: 'SP', taxRegime: 'real' },
      profiles: [],
    });
    // Dado corrompido no aparelho: o cálculo falha, a venda acontece do mesmo jeito.
    await storage.execute("INSERT INTO fiscal_profiles (id, data) VALUES ('x', 'isto não é JSON')");
    const venda = await vender([product({ priceCents: 10_000 })]);
    expect(venda.totalCents).toBe(10_000);
    expect(venda.items[0]!.taxes).toBeUndefined();
    expect((await pdv.pendingEvents()).some((e) => e.type === 'sale.completed')).toBe(true);
  });
});

describe('numeração alinhada com o servidor (F3-12)', () => {
  it('continua do último número do servidor e nunca volta para trás', async () => {
    const p = product();
    await pdv.applyCatalog([p]);
    await pdv.openSession(0);
    const vender = () =>
      pdv.completeSale(addItem(EMPTY_CART, p), [{ method: 'pix', receivedCents: p.priceCents }], {
        discountLimitPercent: 10,
      });
    await pdv.alignSaleSequence(41);
    expect((await vender()).terminalSeq).toBe(42);
    await pdv.alignSaleSequence(10);
    await pdv.alignSaleSequence(-1);
    expect((await vender()).terminalSeq).toBe(43);
  });
});

describe('crediário no caixa (F2-02)', () => {
  const CPF = '52998224725';
  const pricing = (balanceCents: number) => ({
    version: 'v1',
    storePriceTableId: null,
    tables: [],
    customers: [],
    credit: [{ taxId: CPF, limitCents: 10_000, balanceCents }],
  });

  it('confere o limite com o saldo do servidor e as vendas que ainda não subiram', async () => {
    const arroz = product({ priceCents: 4000 });
    await pdv.applyCatalog([arroz]);
    await pdv.applyPricing(pricing(2000));
    await pdv.openSession(0);
    const item = (await pdv.findByCode(arroz.id)) ?? (await pdv.search('arroz'))[0]!;
    const cart = { ...addItem(EMPTY_CART, item, 1000), customerTaxId: CPF };
    const options = { discountLimitPercent: 10 };

    expect(await pdv.creditAvailable(CPF)).toEqual({ limitCents: 10_000, availableCents: 8000 });
    expect(await pdv.creditAvailable('11144477735')).toBeNull();
    await pdv.completeSale(cart, [{ method: 'store_credit', receivedCents: 4000 }], options);
    expect((await pdv.creditAvailable(CPF))!.availableCents).toBe(4000);
    await pdv.completeSale(cart, [{ method: 'store_credit', receivedCents: 4000 }], options);
    await expect(
      pdv.completeSale(cart, [{ method: 'store_credit', receivedCents: 4000 }], options),
    ).rejects.toThrow('R$ 0,00 disponíveis');
    // Parte no crediário, parte em dinheiro: só a parte do crediário conta.
    await pdv.applyPricing(pricing(9000));
    await expect(
      pdv.completeSale(
        cart,
        [
          { method: 'store_credit', receivedCents: 100 },
          { method: 'cash', receivedCents: 3900 },
        ],
        options,
      ),
    ).rejects.toBeInstanceOf(PdvError);
  });

  it('sem CPF ou cliente sem crediário, a venda no crediário é recusada', async () => {
    const arroz = product({ priceCents: 1000 });
    await pdv.applyCatalog([arroz]);
    await pdv.applyPricing({ ...pricing(0), credit: undefined });
    await pdv.openSession(0);
    const item = (await pdv.search('arroz'))[0]!;
    const options = { discountLimitPercent: 10 };
    const tender = [{ method: 'store_credit' as const, receivedCents: 1000 }];
    await expect(
      pdv.completeSale(addItem(EMPTY_CART, item, 1000), tender, options),
    ).rejects.toThrow('informe o CPF ou CNPJ');
    await expect(
      pdv.completeSale({ ...addItem(EMPTY_CART, item, 1000), customerTaxId: CPF }, tender, options),
    ).rejects.toThrow('não tem crediário');
  });
});

describe('troca de operador (F2-03)', () => {
  it('exige o caixa aberto, grava o evento no nome de quem entra e ignora a troca para si mesmo', async () => {
    await expect(pdv.changeOperator(MANAGER)).rejects.toBeInstanceOf(PdvError);
    const session = await pdv.openSession(0);
    await pdv.changeOperator(OPERATOR);
    await pdv.changeOperator(MANAGER);
    const events = await pdv.pendingEvents();
    const changes = events.filter((e) => e.type === 'cash_session.operator_changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      operatorId: MANAGER,
      payload: { sessionId: session.id, fromOperatorId: OPERATOR, toOperatorId: MANAGER },
    });
  });
});
