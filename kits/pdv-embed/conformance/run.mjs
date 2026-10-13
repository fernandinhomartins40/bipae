#!/usr/bin/env node
// Bipaê PDV Embed — teste de conformidade do contrato. Funciona contra QUALQUER backend
// (Node, PHP, Python, C#...). Use num ambiente de TESTE: ele abre e fecha caixa e cria vendas.
//
//   node conformance/run.mjs --url http://localhost:8000/api/pdv --token SEU_TOKEN
//   node conformance/run.mjs --url http://localhost:8000/api/pdv --cookie "laravel_session=..."
//   opções: --q <texto que encontra um produto vendido por unidade>   (padrão: "a")

const METHODS = ['cash', 'pix', 'credit', 'debit', 'voucher', 'store_credit'];

class Failure extends Error {}

function check(condition, message) {
  if (!condition) throw new Failure(message);
}

const isInt = (v) => Number.isSafeInteger(v);
const lineGross = (price, milli) => Math.floor((price * milli + 500) / 1000);

function checkError(res, status, code) {
  check(
    res.status === status,
    `esperava HTTP ${status}, veio ${res.status} (${JSON.stringify(res.body)})`,
  );
  check(
    typeof res.body?.error?.message === 'string' && res.body.error.message.length > 0,
    'erro sem error.message',
  );
  if (code)
    check(
      res.body.error.code === code,
      `esperava error.code "${code}", veio "${res.body?.error?.code}"`,
    );
}

function checkSale(s) {
  check(typeof s?.id === 'string', 'sale.id ausente');
  check(isInt(s.number) && s.number > 0, 'sale.number deve ser inteiro positivo');
  check(['completed', 'cancelled'].includes(s.status), 'sale.status inválido');
  check(
    typeof s.createdAt === 'string' && !Number.isNaN(Date.parse(s.createdAt)),
    'sale.createdAt não é data ISO',
  );
  check(Array.isArray(s.items) && s.items.length > 0, 'sale.items vazio');
  for (const i of s.items) {
    check(
      isInt(i.quantityMilli) &&
        isInt(i.unitPriceCents) &&
        isInt(i.discountCents) &&
        isInt(i.totalCents),
      'item com números não inteiros',
    );
    check(
      i.totalCents === lineGross(i.unitPriceCents, i.quantityMilli) - i.discountCents,
      `total do item "${i.name}" não segue a regra de arredondamento`,
    );
  }
  check(
    isInt(s.totalCents) && s.totalCents === s.subtotalCents - s.discountCents,
    'sale.totalCents ≠ subtotal − desconto',
  );
  check(Array.isArray(s.payments) && s.payments.length > 0, 'sale.payments vazio');
}

function checkSession(s) {
  check(s && typeof s.id === 'string', 'session.id ausente');
  check(typeof s.openedAt === 'string', 'session.openedAt ausente');
  check(
    isInt(s.openingCents) && isInt(s.salesCount) && isInt(s.salesTotalCents),
    'session com números não inteiros',
  );
  check(typeof s.operator?.name === 'string', 'session.operator.name ausente');
}

/**
 * @param {{ url: string, headers?: Record<string, string>, q?: string, fetch?: typeof fetch,
 *           log?: (line: string) => void }} options
 * @returns {Promise<{ passed: number, failed: { name: string, message: string }[] }>}
 */
export async function runConformance(options) {
  const base = options.url.replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? ((line) => console.log(line));
  const auth = options.headers ?? {};
  const results = { passed: 0, failed: [] };
  const ctx = {};

  async function call(method, path, body, withAuth = true) {
    const response = await doFetch(base + path, {
      method,
      headers: {
        'x-bipae-pdv': '1',
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(withAuth ? auth : {}),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  }

  async function step(name, fn) {
    try {
      await fn();
      results.passed++;
      log(`  ✔ ${name}`);
    } catch (error) {
      // A malformed answer (e.g. missing field) also counts as a failure, with the reason.
      const message =
        error instanceof Failure ? error.message : `resposta fora do contrato (${error.message})`;
      results.failed.push({ name, message });
      log(`  ✘ ${name}\n      ${message}`);
    }
  }

  const cash = (amountCents) => ({ method: 'cash', amountCents, changeCents: 0 });
  const saleBody = (overrides = {}) => {
    const p = ctx.product;
    const gross = lineGross(p.priceCents, 2000);
    return {
      id: crypto.randomUUID(),
      items: [
        { productId: p.id, quantityMilli: 2000, unitPriceCents: p.priceCents, discountCents: 0 },
      ],
      subtotalCents: gross,
      discountCents: 0,
      totalCents: gross,
      payments: [cash(gross)],
      customerDocument: null,
      ...overrides,
    };
  };

  log(`Bipaê PDV Embed — conformidade de ${base}`);

  await step('sem autenticação responde 401 com mensagem', async () => {
    if (Object.keys(auth).length === 0) return; // sem credenciais informadas, não dá para testar
    checkError(await call('GET', '/me', undefined, false), 401);
  });

  await step('GET /me', async () => {
    const r = await call('GET', '/me');
    check(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    check(
      typeof r.body.operator?.id === 'string' && typeof r.body.operator?.name === 'string',
      'operator.id/name ausentes',
    );
    check(typeof r.body.store?.name === 'string', 'store.name ausente');
    const s = r.body.settings;
    check(
      Array.isArray(s?.paymentMethods) && s.paymentMethods.length > 0,
      'settings.paymentMethods vazio',
    );
    check(
      s.paymentMethods.every((m) => METHODS.includes(m)),
      'settings.paymentMethods com forma desconhecida',
    );
    check(typeof s.maxDiscountPercent === 'number', 'settings.maxDiscountPercent ausente');
    check(typeof s.canCancelSales === 'boolean', 'settings.canCancelSales ausente');
    ctx.settings = s;
  });
  if (!ctx.settings) return results;

  await step(
    `GET /products?q=${options.q ?? 'a'} encontra um produto vendido por unidade`,
    async () => {
      const r = await call('GET', `/products?q=${encodeURIComponent(options.q ?? 'a')}&limit=50`);
      check(
        r.status === 200 && Array.isArray(r.body.items),
        `HTTP ${r.status}: ${JSON.stringify(r.body)}`,
      );
      for (const p of r.body.items) {
        check(
          typeof p.id === 'string' && typeof p.name === 'string',
          'produto sem id/name (id deve ser texto)',
        );
        check(isInt(p.priceCents), `priceCents de "${p.name}" não é inteiro`);
        check(typeof p.weighable === 'boolean', `weighable de "${p.name}" não é booleano`);
        check(typeof p.unit === 'string', `unit de "${p.name}" ausente`);
      }
      ctx.product = r.body.items.find((p) => !p.weighable && p.priceCents > 0);
      check(
        ctx.product,
        'nenhum produto por unidade com preço > 0; use --q com um texto que encontre um',
      );
    },
  );
  if (!ctx.product) return results;

  await step(
    'GET /products?barcode= acha pelo código exato (quando o produto tem código)',
    async () => {
      if (!ctx.product.barcode) return;
      const r = await call('GET', `/products?barcode=${encodeURIComponent(ctx.product.barcode)}`);
      check(
        r.status === 200 && r.body.items.some((p) => p.id === ctx.product.id),
        'o produto não voltou pela busca por código',
      );
    },
  );

  await step('GET /products?q= sem resultado devolve lista vazia', async () => {
    const r = await call(
      'GET',
      `/products?q=${encodeURIComponent('zzqx-nao-existe-' + Date.now())}`,
    );
    check(
      r.status === 200 && Array.isArray(r.body.items) && r.body.items.length === 0,
      'esperava items: []',
    );
  });

  await step('GET /cash-session (fecha um caixa esquecido aberto, se houver)', async () => {
    const r = await call('GET', '/cash-session');
    check(r.status === 200 && 'session' in r.body, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.body.session) {
      checkSession(r.body.session);
      const c = await call('POST', '/cash-session/close', { countedCents: {} });
      check(c.status === 200, 'não consegui fechar o caixa que já estava aberto');
    }
  });

  await step('sem caixa aberto, vender responde 409 no_session', async () => {
    checkError(await call('POST', '/sales', saleBody()), 409, 'no_session');
  });

  await step('POST /cash-session/open com troco de R$ 100,00', async () => {
    const r = await call('POST', '/cash-session/open', { openingCents: 10000 });
    check(r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    checkSession(r.body.session);
    check(r.body.session.openingCents === 10000, 'openingCents diferente do enviado');
    check(r.body.session.salesCount === 0, 'caixa novo deveria ter 0 vendas');
  });

  await step('abrir de novo responde 409 session_open', async () => {
    checkError(await call('POST', '/cash-session/open', { openingCents: 0 }), 409, 'session_open');
  });

  await step('suprimento de R$ 5,00 (e reenvio com o mesmo id não duplica)', async () => {
    const body = {
      id: crypto.randomUUID(),
      kind: 'supply',
      amountCents: 500,
      reason: 'Troco extra',
    };
    const a = await call('POST', '/cash-session/movements', body);
    check(
      a.status === 201 && a.body.movement?.id === body.id,
      `HTTP ${a.status}: ${JSON.stringify(a.body)}`,
    );
    const b = await call('POST', '/cash-session/movements', body);
    check(
      b.status === 201 && b.body.movement?.id === body.id,
      'reenvio deveria devolver o mesmo movimento',
    );
  });

  await step('sangria maior que a gaveta responde 422 insufficient_cash', async () => {
    const body = {
      id: crypto.randomUUID(),
      kind: 'withdrawal',
      amountCents: 99_999_999,
      reason: 'Teste',
    };
    checkError(await call('POST', '/cash-session/movements', body), 422, 'insufficient_cash');
  });

  await step('sangria de R$ 2,00', async () => {
    const body = {
      id: crypto.randomUUID(),
      kind: 'withdrawal',
      amountCents: 200,
      reason: 'Depósito',
    };
    const r = await call('POST', '/cash-session/movements', body);
    check(r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await step('POST /sales registra a venda (2 unidades, dinheiro)', async () => {
    const body = saleBody();
    const r = await call('POST', '/sales', body);
    check(r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    checkSale(r.body.sale);
    check(
      r.body.sale.id === body.id && r.body.sale.status === 'completed',
      'venda com id/status errados',
    );
    check(r.body.sale.totalCents === body.totalCents, 'total diferente do enviado');
    ctx.sale = { body, sale: r.body.sale };
  });

  await step('reenviar a mesma venda devolve a mesma (200, mesmo número)', async () => {
    const r = await call('POST', '/sales', ctx.sale.body);
    check(r.status === 200, `esperava 200, veio ${r.status}`);
    check(r.body.sale.number === ctx.sale.sale.number, 'o reenvio criou outra venda');
  });

  await step('preço diferente do cadastro responde 422 price_changed', async () => {
    const p = ctx.product;
    const wrong = p.priceCents + 1;
    const gross = lineGross(wrong, 1000);
    checkError(
      await call(
        'POST',
        '/sales',
        saleBody({
          items: [
            { productId: p.id, quantityMilli: 1000, unitPriceCents: wrong, discountCents: 0 },
          ],
          subtotalCents: gross,
          totalCents: gross,
          payments: [cash(gross)],
        }),
      ),
      422,
      'price_changed',
    );
  });

  await step('totais que não batem respondem 422 totals_mismatch', async () => {
    const b = saleBody();
    checkError(
      await call('POST', '/sales', {
        ...b,
        totalCents: b.totalCents + 1,
        subtotalCents: b.subtotalCents + 1,
        payments: [cash(b.totalCents + 1)],
      }),
      422,
      'totals_mismatch',
    );
  });

  await step('pagamentos que não somam o total respondem 422 payments_mismatch', async () => {
    const b = saleBody();
    checkError(
      await call('POST', '/sales', { ...b, payments: [cash(b.totalCents - 1)] }),
      422,
      'payments_mismatch',
    );
  });

  await step('desconto acima do limite responde 403 discount_not_allowed', async () => {
    if (ctx.settings.maxDiscountPercent >= 100) return;
    const p = ctx.product;
    const gross = lineGross(p.priceCents, 2000);
    const discount = gross; // 100%
    checkError(
      await call(
        'POST',
        '/sales',
        saleBody({
          items: [
            {
              productId: p.id,
              quantityMilli: 2000,
              unitPriceCents: p.priceCents,
              discountCents: discount,
            },
          ],
          subtotalCents: gross,
          discountCents: discount,
          totalCents: 0,
          payments: [cash(0)],
        }),
      ),
      403,
      'discount_not_allowed',
    );
  });

  let otherMethod = ctx.settings.paymentMethods.find((m) => m !== 'cash') ?? 'cash';
  await step(`segunda venda paga com ${otherMethod}`, async () => {
    const b = saleBody();
    const r = await call('POST', '/sales', {
      ...b,
      payments: [{ method: otherMethod, amountCents: b.totalCents, changeCents: 0 }],
    });
    check(r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    check(r.body.sale.number > ctx.sale.sale.number, 'a numeração deveria crescer');
    ctx.second = r.body.sale;
  });

  await step('GET /sales lista as vendas do caixa, mais recentes primeiro', async () => {
    const r = await call('GET', '/sales?limit=10');
    check(r.status === 200 && Array.isArray(r.body.items), `HTTP ${r.status}`);
    r.body.items.forEach(checkSale);
    check(r.body.items[0]?.id === ctx.second?.id, 'a venda mais recente deveria vir primeiro');
    check(
      r.body.items.some((s) => s.id === ctx.sale.sale.id),
      'a primeira venda não apareceu',
    );
  });

  await step('cancelar a primeira venda (e cancelar de novo devolve a mesma)', async () => {
    const path = `/sales/${encodeURIComponent(ctx.sale.sale.id)}/cancel`;
    const r = await call('POST', path, { reason: 'Cliente desistiu' });
    if (!ctx.settings.canCancelSales) return checkError(r, 403);
    check(
      r.status === 200 && r.body.sale.status === 'cancelled',
      `HTTP ${r.status}: ${JSON.stringify(r.body)}`,
    );
    const again = await call('POST', path, { reason: 'De novo' });
    check(
      again.status === 200 && again.body.sale.status === 'cancelled',
      'cancelar de novo deveria devolver a venda cancelada',
    );
    ctx.cancelled = true;
  });

  await step('cancelar venda que não existe responde 404', async () => {
    if (!ctx.settings.canCancelSales) return;
    checkError(
      await call('POST', `/sales/${crypto.randomUUID()}/cancel`, { reason: 'Teste' }),
      404,
    );
  });

  await step('GET /cash-session soma só as vendas não canceladas', async () => {
    const r = await call('GET', '/cash-session');
    checkSession(r.body.session);
    const expectedCount = ctx.cancelled ? 1 : 2;
    check(
      r.body.session.salesCount === expectedCount,
      `salesCount ${r.body.session.salesCount}, esperado ${expectedCount}`,
    );
  });

  await step('fechamento cego calcula esperado e diferença', async () => {
    const saleTotal = ctx.sale.sale.totalCents;
    const expectedCash =
      10000 +
      500 -
      200 +
      (ctx.cancelled ? 0 : saleTotal) +
      (otherMethod === 'cash' ? ctx.second.totalCents : 0);
    const counted = { cash: expectedCash - 100 }; // falta R$ 1,00 no dinheiro; outras formas contadas como 0
    const r = await call('POST', '/cash-session/close', { countedCents: counted });
    check(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    const c = r.body.closing;
    check(
      c.expectedCents.cash === expectedCash,
      `dinheiro esperado ${c.expectedCents.cash}, deveria ser ${expectedCash}`,
    );
    const otherExpected = otherMethod === 'cash' ? 0 : ctx.second.totalCents;
    if (otherMethod !== 'cash')
      check(c.expectedCents[otherMethod] === otherExpected, `${otherMethod} esperado errado`);
    check(
      c.differenceCents === -100 - otherExpected,
      `differenceCents ${c.differenceCents}, deveria ser ${-100 - otherExpected}`,
    );
  });

  await step('depois de fechar, GET /cash-session devolve session: null', async () => {
    const r = await call('GET', '/cash-session');
    check(r.status === 200 && r.body.session === null, 'o caixa deveria estar fechado');
  });

  log(
    results.failed.length === 0
      ? `\nTudo certo: ${results.passed} verificações passaram.`
      : `\n${results.failed.length} falha(s), ${results.passed} ok.`,
  );
  return results;
}

// ------------------------------------------------------------------ CLI
const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (pairs, arg, i, all) =>
          arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs,
        [],
      ),
  );
  if (!args.url) {
    console.error(
      'Uso: node conformance/run.mjs --url http://localhost:8000/api/pdv [--token X | --cookie "nome=valor"] [--q texto]',
    );
    process.exit(2);
  }
  const headers = {};
  if (args.token) headers.authorization = `Bearer ${args.token}`;
  if (args.cookie) headers.cookie = args.cookie;
  const result = await runConformance({ url: args.url, headers, q: args.q });
  process.exit(result.failed.length === 0 ? 0 : 1);
}
