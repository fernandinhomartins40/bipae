// Bipaê PDV Embed — implementação de referência do contrato (contract/openapi.yaml) em Node.
// Um arquivo, sem dependências. Copie para o seu projeto e ligue em qualquer servidor Node:
//
//   import { createPdvHandler, pgDatabase } from './bipae-pdv.mjs';
//   const pdv = createPdvHandler({ db: pgDatabase(pool), auth: async (req) => ({ ... }) });
//   app.use('/api/pdv', expressAdapter(pdv));            // Express
//   http.createServer((req, res) => pdv(req, res));        // node:http (req.url relativo à base)
//
// O banco precisa das tabelas de sql/postgres.sql e da view pdv_products (veja o README).

import { createHmac, timingSafeEqual } from 'node:crypto';

const METHODS = ['cash', 'pix', 'credit', 'debit', 'voucher', 'store_credit'];
/** Validade da autorização do gerente (segundos). */
const AUTHORIZATION_TTL = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Erro com status HTTP e mensagem para o operador. */
export class PdvError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {object} [details] */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** "R$ 1.234,56" */
export function brl(cents) {
  const v = Math.abs(cents);
  const reais = Math.floor(v / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${reais},${String(v % 100).padStart(2, '0')}`;
}

/** preço × quantidade ÷ 1000, arredondando meio para cima (centavos inteiros). */
export function lineGross(unitPriceCents, quantityMilli) {
  return Math.floor((unitPriceCents * quantityMilli + 500) / 1000);
}

const isInt = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const now = () => new Date().toISOString();
const num = (v) => (v === null || v === undefined ? v : Number(v));

function bad(message, code = 'invalid_request') {
  return new PdvError(422, code, message);
}

// ------------------------------------------------------------------ adaptadores de banco

/**
 * Banco PostgreSQL via `pg` (Pool). Placeholders $1, $2...
 * @param {{ connect(): Promise<any>, query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} pool
 */
export function pgDatabase(pool) {
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          query: async (sql, params = []) => (await client.query(sql, params)).rows,
        });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

// ------------------------------------------------------------------ regras

/**
 * @typedef {{ query(sql: string, params?: unknown[]): Promise<any[]> }} Queryable
 * @typedef {Queryable & { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> }} Database
 * @typedef {{
 *   operator: { id: string, name: string },
 *   storeId: string,
 *   store: { name: string, document?: string | null, address?: string | null },
 *   settings?: { paymentMethods?: string[], maxDiscountPercent?: number, canCancelSales?: boolean },
 * }} PdvUser
 * @typedef {{
 *   db: Database,
 *   auth: (req: any) => Promise<PdvUser | null> | PdvUser | null,
 *   onStockChange?: (tx: Queryable, change: { storeId: string, productId: string, deltaMilli: number, saleId: string }) => Promise<void>,
 *   authorizeManager?: (req: any, login: { login: string, password: string }, user: PdvUser) => Promise<{ id: string, name: string, maxDiscountPercent?: number } | null> | { id: string, name: string, maxDiscountPercent?: number } | null,
 *   secret?: string,
 * }} PdvOptions
 */

function settingsOf(user, options = {}) {
  const s = user.settings ?? {};
  return {
    // Desconto acima do limite com a senha do gerente (P-05): só quando a aplicação liga.
    managerAuthorization: Boolean(options.authorizeManager && options.secret),
    paymentMethods: (s.paymentMethods ?? ['cash', 'pix', 'credit', 'debit']).filter((m) =>
      METHODS.includes(m),
    ),
    maxDiscountPercent: s.maxDiscountPercent ?? 10,
    canCancelSales: s.canCancelSales ?? true,
  };
}

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

/** Código de autorização: dados em base64url + assinatura HMAC-SHA256 com o segredo da aplicação. */
export function signAuthorization(secret, payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac('sha256', secret).update(body).digest())}`;
}

/** Devolve os dados do código, ou null se a assinatura não confere. */
export function readAuthorization(secret, token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const overLimit = (discount, subtotal, percent) =>
  discount * 10000 > Math.round(percent * 100) * subtotal;

async function openSession(q, user) {
  const [row] = await q.query(
    'select * from pdv_cash_sessions where store_id = $1 and operator_id = $2 and closed_at is null order by opened_at desc limit 1',
    [user.storeId, user.operator.id],
  );
  return row ?? null;
}

async function requireSession(q, user) {
  const session = await openSession(q, user);
  if (!session) throw new PdvError(409, 'no_session', 'Abra o caixa antes de continuar.');
  return session;
}

async function sessionView(q, session) {
  const [totals] = await q.query(
    "select count(*) as n, coalesce(sum(total_cents), 0) as total from pdv_sales where session_id = $1 and status = 'completed'",
    [session.id],
  );
  return {
    id: session.id,
    openedAt: session.opened_at,
    openingCents: num(session.opening_cents),
    operator: { id: session.operator_id, name: session.operator_name },
    salesCount: num(totals.n),
    salesTotalCents: num(totals.total),
  };
}

async function expectedOf(q, session) {
  const expected = Object.fromEntries(METHODS.map((m) => [m, 0]));
  expected.cash += num(session.opening_cents);
  const payments = await q.query(
    "select p.method, sum(p.amount_cents) as amount from pdv_sale_payments p join pdv_sales s on s.id = p.sale_id where s.session_id = $1 and s.status = 'completed' group by p.method",
    [session.id],
  );
  for (const p of payments) if (p.method in expected) expected[p.method] += num(p.amount);
  const movements = await q.query(
    'select kind, sum(amount_cents) as amount from pdv_cash_movements where session_id = $1 group by kind',
    [session.id],
  );
  for (const m of movements) expected.cash += m.kind === 'supply' ? num(m.amount) : -num(m.amount);
  return expected;
}

async function loadSale(q, storeId, id) {
  const [sale] = await q.query('select * from pdv_sales where id = $1 and store_id = $2', [
    id,
    storeId,
  ]);
  if (!sale) return null;
  const items = await q.query('select * from pdv_sale_items where sale_id = $1 order by line', [
    id,
  ]);
  const payments = await q.query(
    'select * from pdv_sale_payments where sale_id = $1 order by line',
    [id],
  );
  return {
    id: sale.id,
    number: num(sale.number),
    status: sale.status,
    createdAt: sale.created_at,
    cancelledAt: sale.cancelled_at ?? null,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      unit: i.unit,
      quantityMilli: num(i.quantity_milli),
      unitPriceCents: num(i.unit_price_cents),
      discountCents: num(i.discount_cents),
      totalCents: num(i.total_cents),
    })),
    subtotalCents: num(sale.subtotal_cents),
    discountCents: num(sale.discount_cents),
    totalCents: num(sale.total_cents),
    payments: payments.map((p) => ({
      method: p.method,
      amountCents: num(p.amount_cents),
      changeCents: num(p.change_cents),
    })),
    customerDocument: sale.customer_document ?? null,
    _sessionId: sale.session_id,
  };
}

const publicSale = (sale) => {
  const { _sessionId, ...rest } = sale;
  return rest;
};

function productView(p) {
  return {
    id: String(p.id),
    name: p.name,
    barcode: p.barcode ?? null,
    sku: p.sku ?? null,
    priceCents: num(p.price_cents),
    unit: p.unit ?? 'UN',
    weighable:
      p.weighable === true || p.weighable === 1 || p.weighable === '1' || p.weighable === 't',
    stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
  };
}

function validateSaleInput(body, settings) {
  if (!body || typeof body !== 'object') throw bad('Venda inválida.');
  if (typeof body.id !== 'string' || !UUID.test(body.id))
    throw bad('Identificador da venda inválido.');
  if (!Array.isArray(body.items) || body.items.length === 0)
    throw bad('A venda precisa de pelo menos um item.');
  if (body.items.length > 500) throw bad('Venda com itens demais.');
  for (const i of body.items) {
    if (
      !i ||
      typeof i.productId !== 'string' ||
      !isInt(i.quantityMilli, 1) ||
      !isInt(i.unitPriceCents) ||
      !isInt(i.discountCents)
    ) {
      throw bad('Item da venda inválido.');
    }
  }
  for (const k of ['subtotalCents', 'discountCents', 'totalCents'])
    if (!isInt(body[k])) throw bad('Totais da venda inválidos.');
  if (!Array.isArray(body.payments) || body.payments.length === 0)
    throw bad('Informe a forma de pagamento.');
  for (const p of body.payments) {
    if (!p || !settings.paymentMethods.includes(p.method))
      throw bad('Forma de pagamento não aceita neste caixa.');
    if (!isInt(p.amountCents) || !isInt(p.changeCents)) throw bad('Valor de pagamento inválido.');
    if (p.changeCents > 0 && p.method !== 'cash') throw bad('Só pagamento em dinheiro tem troco.');
  }
  const grant = body.discountAuthorization;
  if (grant !== undefined && grant !== null && (typeof grant !== 'string' || grant.length > 2000))
    throw bad('Autorização do gerente inválida.');
  const doc = body.customerDocument;
  if (doc !== undefined && doc !== null && !/^(\d{11}|\d{14})$/.test(String(doc))) {
    throw bad('CPF ou CNPJ do cliente inválido (só números, 11 ou 14 dígitos).');
  }
}

// ------------------------------------------------------------------ rotas

/** @param {PdvOptions} options */
export function createPdvRoutes(options) {
  const { db, onStockChange } = options;

  return {
    async me(user) {
      return {
        operator: { id: user.operator.id, name: user.operator.name },
        store: {
          name: user.store.name,
          document: user.store.document ?? null,
          address: user.store.address ?? null,
        },
        settings: settingsOf(user, options),
      };
    },

    /** Autorização do gerente para desconto acima do limite (P-05). */
    async authorize(user, req, body) {
      if (!options.authorizeManager || !options.secret) {
        throw new PdvError(
          404,
          'not_supported',
          'Esta aplicação não oferece autorização de gerente.',
        );
      }
      const login = typeof body?.login === 'string' ? body.login.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!login || !password) throw bad('Informe o login e a senha do gerente.');
      if (
        !isInt(body.discountCents) ||
        !isInt(body.subtotalCents, 1) ||
        body.discountCents > body.subtotalCents
      ) {
        throw bad('Desconto ou subtotal inválido.');
      }
      const manager = await options.authorizeManager(req, { login, password }, user);
      if (!manager) {
        throw new PdvError(
          403,
          'invalid_manager',
          'Login ou senha do gerente incorretos, ou esta pessoa não pode autorizar descontos.',
        );
      }
      const limit = manager.maxDiscountPercent ?? 100;
      if (overLimit(body.discountCents, body.subtotalCents, limit)) {
        throw new PdvError(
          403,
          'discount_not_allowed',
          `O desconto passa do limite de ${limit}% do gerente.`,
        );
      }
      const exp = Math.floor(Date.now() / 1000) + AUTHORIZATION_TTL;
      return {
        authorization: signAuthorization(options.secret, {
          store: user.storeId,
          manager: { id: String(manager.id), name: manager.name },
          discountCents: body.discountCents,
          subtotalCents: body.subtotalCents,
          exp,
        }),
        manager: { id: String(manager.id), name: manager.name },
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    },

    async products(user, query) {
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
      if (query.barcode) {
        const rows = await db.query(
          'select * from pdv_products where store_id = $1 and active = true and barcode = $2 limit $3',
          [user.storeId, String(query.barcode), limit],
        );
        return { items: rows.map(productView) };
      }
      const text = String(query.q ?? '').trim();
      if (!text) return { items: [] };
      // Busca simples por nome e SKU (troque por busca sem acento/trigram se o banco tiver).
      const like = `%${text.toLowerCase().replace(/[%_\\]/g, '')}%`;
      const rows = await db.query(
        "select * from pdv_products where store_id = $1 and active = true and (lower(name) like $2 or lower(coalesce(sku, '')) like $2 or barcode = $3) order by name limit $4",
        [user.storeId, like, text, limit],
      );
      return { items: rows.map(productView) };
    },

    async currentSession(user) {
      const session = await openSession(db, user);
      return { session: session ? await sessionView(db, session) : null };
    },

    async open(user, body) {
      if (!isInt(body?.openingCents)) throw bad('Informe o troco inicial (pode ser zero).');
      return db.transaction(async (tx) => {
        if (await openSession(tx, user))
          throw new PdvError(409, 'session_open', 'Você já tem um caixa aberto.');
        const id = crypto.randomUUID();
        await tx.query(
          'insert into pdv_cash_sessions (id, store_id, operator_id, operator_name, opened_at, opening_cents) values ($1, $2, $3, $4, $5, $6)',
          [id, user.storeId, user.operator.id, user.operator.name, now(), body.openingCents],
        );
        return {
          status: 201,
          body: { session: await sessionView(tx, await openSession(tx, user)) },
        };
      });
    },

    async movement(user, body) {
      if (typeof body?.id !== 'string' || !UUID.test(body.id)) throw bad('Identificador inválido.');
      if (!['withdrawal', 'supply'].includes(body.kind)) throw bad('Tipo de movimento inválido.');
      if (!isInt(body.amountCents, 1)) throw bad('Informe um valor maior que zero.');
      const reason = String(body.reason ?? '').trim();
      if (!reason || reason.length > 200) throw bad('Informe o motivo.');
      return db.transaction(async (tx) => {
        const view = (m) => ({
          id: m.id,
          kind: m.kind,
          amountCents: num(m.amount_cents),
          reason: m.reason,
          createdAt: m.created_at,
        });
        const [existing] = await tx.query(
          'select * from pdv_cash_movements where id = $1 and store_id = $2',
          [body.id, user.storeId],
        );
        if (existing) return { status: 201, body: { movement: view(existing) } };
        const session = await requireSession(tx, user);
        if (body.kind === 'withdrawal') {
          const cash = (await expectedOf(tx, session)).cash;
          if (body.amountCents > cash) {
            throw new PdvError(
              422,
              'insufficient_cash',
              `A gaveta tem ${brl(cash)} em dinheiro. A sangria não pode passar disso.`,
            );
          }
        }
        const row = {
          id: body.id,
          kind: body.kind,
          amount_cents: body.amountCents,
          reason,
          created_at: now(),
        };
        await tx.query(
          'insert into pdv_cash_movements (id, store_id, session_id, kind, amount_cents, reason, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
          [
            row.id,
            user.storeId,
            session.id,
            row.kind,
            row.amount_cents,
            row.reason,
            row.created_at,
          ],
        );
        return { status: 201, body: { movement: view(row) } };
      });
    },

    async close(user, body) {
      const counted = Object.fromEntries(METHODS.map((m) => [m, 0]));
      for (const [m, v] of Object.entries(body?.countedCents ?? {})) {
        if (!METHODS.includes(m) || !isInt(v)) throw bad('Valor contado inválido.');
        counted[m] = v;
      }
      return db.transaction(async (tx) => {
        const session = await requireSession(tx, user);
        const expected = await expectedOf(tx, session);
        const differenceCents = METHODS.reduce((sum, m) => sum + counted[m] - expected[m], 0);
        const closedAt = now();
        await tx.query(
          'update pdv_cash_sessions set closed_at = $1, expected_json = $2, counted_json = $3, difference_cents = $4 where id = $5',
          [
            closedAt,
            JSON.stringify(expected),
            JSON.stringify(counted),
            differenceCents,
            session.id,
          ],
        );
        return {
          status: 200,
          body: {
            closing: { closedAt, expectedCents: expected, countedCents: counted, differenceCents },
          },
        };
      });
    },

    async listSales(user, query) {
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
      const session = await openSession(db, user);
      if (!session) return { items: [] };
      const rows = await db.query(
        'select id from pdv_sales where session_id = $1 order by number desc limit $2',
        [session.id, limit],
      );
      const items = [];
      for (const r of rows) items.push(publicSale(await loadSale(db, user.storeId, r.id)));
      return { items };
    },

    async createSale(user, body) {
      const settings = settingsOf(user);
      validateSaleInput(body, settings);
      const existing = await loadSale(db, user.storeId, body.id);
      if (existing) return { status: 200, body: { sale: publicSale(existing) } };

      for (let attempt = 0; ; attempt++) {
        try {
          return await db.transaction(async (tx) => {
            const session = await requireSession(tx, user);
            const ids = [...new Set(body.items.map((i) => i.productId))];
            const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
            const products = new Map(
              (
                await tx.query(
                  `select * from pdv_products where store_id = $1 and id in (${placeholders})`,
                  [user.storeId, ...ids],
                )
              ).map((p) => [String(p.id), productView(p)]),
            );

            let subtotal = 0;
            let discount = 0;
            const lines = body.items.map((item, index) => {
              const product = products.get(item.productId);
              if (!product)
                throw new PdvError(
                  422,
                  'product_not_found',
                  'Um dos produtos não existe mais. Remova-o e bipe de novo.',
                );
              if (!product.weighable && item.quantityMilli % 1000 !== 0) {
                throw new PdvError(
                  422,
                  'invalid_quantity',
                  `${product.name} é vendido por unidade: use quantidade inteira.`,
                );
              }
              if (item.unitPriceCents !== product.priceCents) {
                throw new PdvError(
                  422,
                  'price_changed',
                  `O preço de ${product.name} mudou para ${brl(product.priceCents)}. Confira e finalize de novo.`,
                  { productId: product.id, priceCents: product.priceCents },
                );
              }
              const gross = lineGross(item.unitPriceCents, item.quantityMilli);
              if (item.discountCents > gross)
                throw bad(`Desconto maior que o valor de ${product.name}.`);
              subtotal += gross;
              discount += item.discountCents;
              return {
                ...item,
                line: index + 1,
                name: product.name,
                unit: product.unit,
                total: gross - item.discountCents,
              };
            });
            const total = subtotal - discount;
            if (
              subtotal !== body.subtotalCents ||
              discount !== body.discountCents ||
              total !== body.totalCents
            ) {
              throw new PdvError(
                422,
                'totals_mismatch',
                'Os totais da venda não conferem. Atualize a tela e tente de novo.',
              );
            }
            if (overLimit(discount, subtotal, settings.maxDiscountPercent)) {
              // Acima do limite só com a autorização do gerente (P-05), presa a esta loja e a
              // este desconto, dentro da validade.
              const grant =
                options.secret && body.discountAuthorization
                  ? readAuthorization(options.secret, body.discountAuthorization)
                  : null;
              const valid =
                grant &&
                grant.store === user.storeId &&
                grant.exp * 1000 > Date.now() &&
                discount <= grant.discountCents &&
                subtotal === grant.subtotalCents;
              if (!valid) {
                throw new PdvError(
                  403,
                  'discount_not_allowed',
                  body.discountAuthorization
                    ? 'A autorização do gerente venceu ou não vale para este desconto. Peça de novo.'
                    : `O desconto passa do limite de ${settings.maxDiscountPercent}% deste caixa.`,
                );
              }
            }
            const paid = body.payments.reduce((s, p) => s + p.amountCents, 0);
            if (paid !== total) {
              throw new PdvError(
                422,
                'payments_mismatch',
                `Os pagamentos somam ${brl(paid)}, mas a venda é de ${brl(total)}.`,
              );
            }

            const [{ next }] = await tx.query(
              'select coalesce(max(number), 0) + 1 as next from pdv_sales where store_id = $1',
              [user.storeId],
            );
            const createdAt = now();
            await tx.query(
              'insert into pdv_sales (id, store_id, session_id, operator_id, number, status, created_at, subtotal_cents, discount_cents, total_cents, customer_document) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
              [
                body.id,
                user.storeId,
                session.id,
                user.operator.id,
                num(next),
                'completed',
                createdAt,
                subtotal,
                discount,
                total,
                body.customerDocument ?? null,
              ],
            );
            for (const l of lines) {
              await tx.query(
                'insert into pdv_sale_items (sale_id, line, product_id, name, unit, quantity_milli, unit_price_cents, discount_cents, total_cents) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                [
                  body.id,
                  l.line,
                  l.productId,
                  l.name,
                  l.unit,
                  l.quantityMilli,
                  l.unitPriceCents,
                  l.discountCents,
                  l.total,
                ],
              );
              if (onStockChange) {
                await onStockChange(tx, {
                  storeId: user.storeId,
                  productId: l.productId,
                  deltaMilli: -l.quantityMilli,
                  saleId: body.id,
                });
              }
            }
            let line = 0;
            for (const p of body.payments) {
              await tx.query(
                'insert into pdv_sale_payments (sale_id, line, method, amount_cents, change_cents) values ($1, $2, $3, $4, $5)',
                [body.id, ++line, p.method, p.amountCents, p.changeCents],
              );
            }
            return {
              status: 201,
              body: { sale: publicSale(await loadSale(tx, user.storeId, body.id)) },
            };
          });
        } catch (error) {
          // Duplicate id (same sale sent twice at once) or two registers taking the same number.
          if (isUniqueViolation(error) && attempt < 3) {
            const again = await loadSale(db, user.storeId, body.id);
            if (again) return { status: 200, body: { sale: publicSale(again) } };
            continue;
          }
          throw error;
        }
      }
    },

    async cancelSale(user, id, body) {
      if (!settingsOf(user).canCancelSales)
        throw new PdvError(403, 'forbidden', 'Você não tem permissão para cancelar vendas.');
      const reason = String(body?.reason ?? '').trim();
      if (reason.length < 3) throw bad('Informe o motivo do cancelamento.');
      return db.transaction(async (tx) => {
        const sale = await loadSale(tx, user.storeId, id);
        if (!sale) throw new PdvError(404, 'not_found', 'Venda não encontrada.');
        if (sale.status === 'cancelled') return { status: 200, body: { sale: publicSale(sale) } };
        const session = await requireSession(tx, user);
        if (sale._sessionId !== session.id) {
          throw new PdvError(
            409,
            'not_in_session',
            'Só dá para cancelar vendas do caixa que está aberto.',
          );
        }
        await tx.query(
          "update pdv_sales set status = 'cancelled', cancelled_at = $1, cancel_reason = $2 where id = $3",
          [now(), reason.slice(0, 200), id],
        );
        if (onStockChange) {
          for (const item of sale.items) {
            await onStockChange(tx, {
              storeId: user.storeId,
              productId: item.productId,
              deltaMilli: item.quantityMilli,
              saleId: id,
            });
          }
        }
        return { status: 200, body: { sale: publicSale(await loadSale(tx, user.storeId, id)) } };
      });
    },
  };
}

function isUniqueViolation(error) {
  const code = error?.code ?? error?.cause?.code;
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

// ------------------------------------------------------------------ HTTP

async function readJson(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body; // Express/Fastify já leram
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw bad('Requisição grande demais.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bad('JSON inválido.');
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Handler HTTP do contrato. Devolve `true` quando atendeu a rota e `false` quando o caminho
 * não é do PDV (para o seu servidor seguir adiante). `req.url` deve ser relativo à base
 * (é assim no `app.use('/api/pdv', ...)` do Express); ou informe `basePath`.
 * @param {PdvOptions & { basePath?: string }} options
 */
export function createPdvHandler(options) {
  const routes = createPdvRoutes(options);
  const base = (options.basePath ?? '').replace(/\/$/, '');

  return async function pdvHandler(req, res) {
    const url = new URL(req.originalUrl && base ? req.originalUrl : req.url, 'http://local');
    let path = url.pathname;
    if (base) {
      if (!path.startsWith(base)) return false;
      path = path.slice(base.length) || '/';
    }
    const query = Object.fromEntries(url.searchParams);
    const method = req.method;

    /** @type {[string, string, (user: PdvUser, m: string[]) => Promise<any>][]} */
    const table = [
      ['GET', '/me', (u) => routes.me(u)],
      ['GET', '/products', (u) => routes.products(u, query)],
      ['GET', '/cash-session', (u) => routes.currentSession(u)],
      ['POST', '/cash-session/open', async (u) => routes.open(u, await readJson(req))],
      ['POST', '/cash-session/movements', async (u) => routes.movement(u, await readJson(req))],
      ['POST', '/cash-session/close', async (u) => routes.close(u, await readJson(req))],
      ['GET', '/sales', (u) => routes.listSales(u, query)],
      ['POST', '/sales', async (u) => routes.createSale(u, await readJson(req))],
      ['POST', '/authorize', async (u) => routes.authorize(u, req, await readJson(req))],
      [
        'POST',
        '/sales/:id/cancel',
        async (u, m) => routes.cancelSale(u, m[0], await readJson(req)),
      ],
    ];

    for (const [verb, pattern, run] of table) {
      const params = match(pattern, path);
      if (!params) continue;
      if (verb !== method) continue;
      try {
        const user = await options.auth(req);
        if (!user)
          throw new PdvError(
            401,
            'unauthenticated',
            'Sua sessão expirou. Entre de novo no sistema.',
          );
        const result = await run(user, params);
        if (result && typeof result.status === 'number' && 'body' in result)
          send(res, result.status, result.body);
        else send(res, 200, result);
      } catch (error) {
        if (error instanceof PdvError) {
          send(res, error.status, {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details && { details: error.details }),
            },
          });
        } else {
          console.error('[bipae-pdv]', error);
          send(res, 500, {
            error: {
              code: 'internal',
              message: 'Algo deu errado no servidor. Tente de novo em instantes.',
            },
          });
        }
      }
      return true;
    }
    return false;
  };
}

function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.replace(/\/$/, '').split('/');
  if (p.length !== a.length) return null;
  const params = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params.push(decodeURIComponent(a[i]));
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

/** Express/Connect: `app.use('/api/pdv', express.json(), expressAdapter(handler))`. */
export function expressAdapter(handler) {
  return (req, res, next) => {
    handler(req, res)
      .then((handled) => (handled ? undefined : next()))
      .catch(next);
  };
}
