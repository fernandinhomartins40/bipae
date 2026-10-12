import {
  terminalEvent,
  uuidv7,
  type PaymentMethod,
  type SaleItem,
  type SalePayment,
  type SyncPullResult,
  type TerminalEvent,
} from '@bipae/domain';
import { getMeta, searchKey, setMeta, type LocalStorage, type Tx } from '@bipae/local-db';
import { discountNeedsAuthorization, totals, type Cart, type CatalogItem } from './cart';
import { closeBlind, expectedBySession, type ByMethod, type CloseResult, type SessionActivity } from './cash';
import { summarizePayments, type TenderInput } from './payments';

/** User-facing error from register operations (pt-BR). */
export class PdvError extends Error {}

export interface PdvContext {
  terminalId: string;
  operatorId: string;
  now?: () => Date;
  newId?: () => string;
}

export interface Session {
  id: string;
  operatorId: string;
  openedAt: string;
  openingCents: number;
  closedAt: string | null;
}

export interface StoredSale {
  id: string;
  terminalSeq: number;
  kind: 'sale' | 'return';
  status: 'completed' | 'cancelled';
  sessionId: string;
  createdAt: string;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  items: SaleItem[];
  payments: SalePayment[];
  customerTaxId: string | null;
  originalSaleId?: string;
  refundMethod?: PaymentMethod;
  returnedItems?: { line: number; productId: string; quantityMilli: number; refundCents: number }[];
}

export interface CatalogProduct extends CatalogItem {
  sku: string | null;
  barcodes: string[];
  active: boolean;
}

export interface CompleteSaleOptions {
  /** Max discount (percent of subtotal) the current operator may give alone. */
  discountLimitPercent: number;
  /** Set when someone with pos.discount.above_limit approved (or the operator has it). */
  discountAuthorizedBy?: string | null;
}

type Row = Record<string, unknown>;

function toProduct(row: Row): CatalogProduct {
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as string,
    priceCents: Number(row.price_cents),
    isWeighable: Number(row.is_weighable) === 1,
    sku: (row.sku as string | null) ?? null,
    barcodes: row.barcodes ? String(row.barcodes).split(',') : [],
    active: Number(row.active) === 1,
  };
}

/**
 * The register. Everything is written to the terminal's local database first; each action
 * appends an event to the outbox in the same transaction (ADR-0004), so a sale either
 * exists locally *and* is queued for the server, or does not exist at all.
 */
export class PdvService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly storage: LocalStorage,
    private ctx: PdvContext,
  ) {
    this.now = ctx.now ?? (() => new Date());
    this.newId = ctx.newId ?? (() => uuidv7());
  }

  setOperator(operatorId: string) {
    this.ctx = { ...this.ctx, operatorId };
  }

  // ---------------------------------------------------------------- catalog

  private readonly productSelect = `
    SELECT p.*, (SELECT group_concat(code) FROM barcodes b WHERE b.product_id = p.id) AS barcodes
    FROM products p`;

  async findByCode(code: string): Promise<CatalogProduct | null> {
    const [row] = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND (p.id IN (SELECT product_id FROM barcodes WHERE code = ?) OR p.sku = ?) LIMIT 1`,
      [code, code],
    );
    return row ? toProduct(row) : null;
  }

  /** PLU from a scale label matches the product's internal code (SKU), ignoring leading zeros. */
  async findByPlu(plu: string): Promise<CatalogProduct | null> {
    const [row] = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND p.is_weighable = 1 AND ltrim(p.sku, '0') = ? LIMIT 1`,
      [String(Number(plu))],
    );
    return row ? toProduct(row) : null;
  }

  async search(text: string, limit = 20): Promise<CatalogProduct[]> {
    const terms = searchKey(text).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const where = terms.map(() => 'p.search_name LIKE ?').join(' AND ');
    const rows = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND ${where} ORDER BY p.search_name LIMIT ?`,
      [...terms.map((t) => `%${t}%`), limit],
    );
    return rows.map(toProduct);
  }

  async catalogSize(): Promise<number> {
    const [row] = await this.storage.query<{ n: number }>('SELECT count(*) AS n FROM products');
    return Number(row?.n ?? 0);
  }

  /** Upserts products from a sync pull. */
  async applyCatalog(products: SyncPullResult['products']) {
    await this.storage.transaction(async (tx) => {
      for (const p of products) {
        await tx.execute(
          `INSERT INTO products (id, name, search_name, sku, unit, price_cents, is_weighable, active, ncm, cest, fiscal_profile_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, search_name = excluded.search_name,
             sku = excluded.sku, unit = excluded.unit, price_cents = excluded.price_cents,
             is_weighable = excluded.is_weighable, active = excluded.active, ncm = excluded.ncm,
             cest = excluded.cest, fiscal_profile_id = excluded.fiscal_profile_id, updated_at = excluded.updated_at`,
          [
            p.id, p.name, searchKey(p.name), p.sku, p.unit, p.priceCents, p.isWeighable ? 1 : 0,
            p.active ? 1 : 0, p.ncm, p.cest, p.fiscalProfileId, p.updatedAt,
          ],
        );
        await tx.execute('DELETE FROM barcodes WHERE product_id = ?', [p.id]);
        for (const code of p.barcodes) {
          await tx.execute(
            'INSERT INTO barcodes (code, product_id) VALUES (?, ?) ON CONFLICT (code) DO UPDATE SET product_id = excluded.product_id',
            [code, p.id],
          );
        }
      }
    });
  }

  // ---------------------------------------------------------------- cash session

  async currentSession(): Promise<Session | null> {
    const [row] = await this.storage.query<Row>(
      'SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1',
    );
    return row
      ? {
          id: row.id as string,
          operatorId: row.operator_id as string,
          openedAt: row.opened_at as string,
          openingCents: Number(row.opening_cents),
          closedAt: null,
        }
      : null;
  }

  private async requireSession(): Promise<Session> {
    const session = await this.currentSession();
    if (!session) throw new PdvError('Abra o caixa antes de vender.');
    return session;
  }

  async openSession(openingCents: number): Promise<Session> {
    if (!Number.isInteger(openingCents) || openingCents < 0) throw new PdvError('Valor de abertura inválido.');
    if (await this.currentSession()) throw new PdvError('O caixa já está aberto.');
    const session: Session = {
      id: this.newId(),
      operatorId: this.ctx.operatorId,
      openedAt: this.now().toISOString(),
      openingCents,
      closedAt: null,
    };
    await this.storage.transaction(async (tx) => {
      await tx.execute(
        'INSERT INTO cash_sessions (id, operator_id, opened_at, opening_cents) VALUES (?, ?, ?, ?)',
        [session.id, session.operatorId, session.openedAt, openingCents],
      );
      await this.enqueue(tx, 'cash_session.opened', { sessionId: session.id, openingCents });
    });
    return session;
  }

  async sessionActivity(sessionId: string): Promise<SessionActivity> {
    const [session] = await this.storage.query<Row>('SELECT * FROM cash_sessions WHERE id = ?', [sessionId]);
    if (!session) throw new PdvError('Caixa não encontrado.');
    const sales = await this.listSales(sessionId);
    const movements = await this.storage.query<Row>('SELECT * FROM cash_movements WHERE session_id = ?', [sessionId]);
    return {
      openingCents: Number(session.opening_cents),
      sales: sales.filter((s) => s.kind === 'sale'),
      returns: sales
        .filter((s) => s.kind === 'return')
        .map((s) => ({ refundCents: s.totalCents, refundMethod: s.refundMethod! })),
      movements: movements.map((m) => ({
        kind: m.kind as 'withdrawal' | 'supply',
        amountCents: Number(m.amount_cents),
      })),
    };
  }

  async addMovement(
    kind: 'withdrawal' | 'supply',
    amountCents: number,
    reason: string | null,
    authorizedBy: string | null = null,
  ) {
    const session = await this.requireSession();
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PdvError('Informe um valor maior que zero.');
    if (kind === 'withdrawal') {
      const inDrawer = expectedBySession(await this.sessionActivity(session.id)).cash;
      if (amountCents > inDrawer) {
        throw new PdvError('A sangria é maior que o dinheiro que deveria estar na gaveta.');
      }
    }
    const movementId = this.newId();
    await this.storage.transaction(async (tx) => {
      await tx.execute(
        'INSERT INTO cash_movements (id, session_id, kind, amount_cents, reason, authorized_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [movementId, session.id, kind, amountCents, reason, authorizedBy, this.now().toISOString()],
      );
      await this.enqueue(tx, 'cash_session.movement', {
        sessionId: session.id,
        movementId,
        kind,
        amountCents,
        reason,
        authorizedBy,
      });
    });
    return movementId;
  }

  /** Blind close: the operator declares the counted amounts; expected values are revealed after. */
  async closeSession(declared: Partial<ByMethod>): Promise<CloseResult> {
    const session = await this.requireSession();
    const result = closeBlind(expectedBySession(await this.sessionActivity(session.id)), declared);
    await this.storage.transaction(async (tx) => {
      await tx.execute('UPDATE cash_sessions SET closed_at = ?, closing_json = ? WHERE id = ?', [
        this.now().toISOString(),
        JSON.stringify(result),
        session.id,
      ]);
      await this.enqueue(tx, 'cash_session.closed', {
        sessionId: session.id,
        declared: result.declared,
        expected: result.expected,
        differenceCents: result.differenceCents,
      });
    });
    return result;
  }

  // ---------------------------------------------------------------- sales

  async completeSale(cart: Cart, tenders: TenderInput[], options: CompleteSaleOptions): Promise<StoredSale> {
    const session = await this.requireSession();
    if (cart.lines.length === 0) throw new PdvError('O carrinho está vazio.');
    if (discountNeedsAuthorization(cart, options.discountLimitPercent) && !options.discountAuthorizedBy) {
      throw new PdvError(
        `Desconto acima de ${options.discountLimitPercent}% precisa da autorização de um gerente.`,
      );
    }
    const t = totals(cart);
    const summary = summarizePayments(t.totalCents, tenders);
    if (summary.remainingCents > 0) throw new PdvError('Ainda falta receber parte do valor da venda.');

    const sale: StoredSale = {
      id: this.newId(),
      terminalSeq: 0,
      kind: 'sale',
      status: 'completed',
      sessionId: session.id,
      createdAt: this.now().toISOString(),
      totalCents: t.totalCents,
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      items: t.items,
      payments: summary.payments,
      customerTaxId: cart.customerTaxId,
    };
    await this.storage.transaction(async (tx) => {
      sale.terminalSeq = await this.nextCounter(tx, 'sale_seq');
      await this.insertSale(tx, sale);
      if (cart.quoteId) {
        await tx.execute("UPDATE quotes SET status = 'converted' WHERE id = ?", [cart.quoteId]);
      }
      await this.enqueue(tx, 'sale.completed', {
        saleId: sale.id,
        terminalSeq: sale.terminalSeq,
        sessionId: session.id,
        items: sale.items,
        subtotalCents: sale.subtotalCents,
        discountCents: sale.discountCents,
        totalCents: sale.totalCents,
        payments: sale.payments,
        customerTaxId: sale.customerTaxId,
        discountAuthorizedBy: t.discountCents > 0 ? (options.discountAuthorizedBy ?? null) : null,
        quoteId: cart.quoteId,
      });
    });
    return sale;
  }

  async cancelSale(saleId: string, reason: string, authorizedBy: string | null) {
    const sale = await this.getSale(saleId);
    if (!sale || sale.kind !== 'sale') throw new PdvError('Venda não encontrada.');
    if (sale.status === 'cancelled') throw new PdvError('Esta venda já foi cancelada.');
    if ((await this.returnedQuantities(saleId)).size > 0) {
      throw new PdvError('Esta venda já teve devolução. Faça a devolução dos itens restantes.');
    }
    if (reason.trim().length < 3) throw new PdvError('Informe o motivo do cancelamento.');
    await this.storage.transaction(async (tx) => {
      await tx.execute("UPDATE sales SET status = 'cancelled' WHERE id = ?", [saleId]);
      await this.enqueue(tx, 'sale.cancelled', { saleId, reason: reason.trim(), authorizedBy });
    });
  }

  /** Returns (devolução) always reference the original sale item by item (NT 2025.002 v1.52). */
  async returnItems(
    originalSaleId: string,
    lines: { line: number; quantityMilli: number }[],
    refundMethod: PaymentMethod,
    reason: string,
  ): Promise<StoredSale> {
    const session = await this.requireSession();
    const original = await this.getSale(originalSaleId);
    if (!original || original.kind !== 'sale' || original.status !== 'completed') {
      throw new PdvError('Venda original não encontrada ou cancelada.');
    }
    if (reason.trim().length < 3) throw new PdvError('Informe o motivo da devolução.');
    const already = await this.returnedQuantities(originalSaleId);

    const returned = lines.map(({ line, quantityMilli }) => {
      const item = original.items.find((i) => i.line === line);
      if (!item) throw new PdvError(`O item ${line} não está nesta venda.`);
      const prev = already.get(line) ?? { quantityMilli: 0, refundCents: 0 };
      const remaining = item.quantityMilli - prev.quantityMilli;
      if (!Number.isInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > remaining) {
        throw new PdvError(`Só dá para devolver até ${remaining / 1000} ${item.unit} de "${item.name}".`);
      }
      // The last return of a line refunds exactly what is left, so refunds never drift by a cent.
      const refundCents =
        quantityMilli === remaining
          ? item.totalCents - prev.refundCents
          : Math.floor((item.totalCents * quantityMilli + item.quantityMilli / 2) / item.quantityMilli);
      return { line, productId: item.productId, quantityMilli, refundCents };
    });
    const refundCents = returned.reduce((a, r) => a + r.refundCents, 0);

    const record: StoredSale = {
      id: this.newId(),
      terminalSeq: 0,
      kind: 'return',
      status: 'completed',
      sessionId: session.id,
      createdAt: this.now().toISOString(),
      totalCents: refundCents,
      subtotalCents: refundCents,
      discountCents: 0,
      items: [],
      payments: [],
      customerTaxId: original.customerTaxId,
      originalSaleId,
      refundMethod,
      returnedItems: returned,
    };
    await this.storage.transaction(async (tx) => {
      record.terminalSeq = await this.nextCounter(tx, 'sale_seq');
      await this.insertSale(tx, record);
      await this.enqueue(tx, 'sale.returned', {
        returnId: record.id,
        originalSaleId,
        terminalSeq: record.terminalSeq,
        sessionId: session.id,
        items: returned,
        refundCents,
        refundMethod,
        reason: reason.trim(),
      });
    });
    return record;
  }

  private async returnedQuantities(saleId: string) {
    const rows = await this.storage.query<Row>("SELECT data FROM sales WHERE kind = 'return'");
    const result = new Map<number, { quantityMilli: number; refundCents: number }>();
    for (const row of rows) {
      const sale = JSON.parse(row.data as string) as StoredSale;
      if (sale.originalSaleId !== saleId) continue;
      for (const r of sale.returnedItems ?? []) {
        const prev = result.get(r.line) ?? { quantityMilli: 0, refundCents: 0 };
        result.set(r.line, {
          quantityMilli: prev.quantityMilli + r.quantityMilli,
          refundCents: prev.refundCents + r.refundCents,
        });
      }
    }
    return result;
  }

  private async insertSale(tx: Tx, sale: StoredSale) {
    await tx.execute(
      'INSERT INTO sales (id, terminal_seq, session_id, kind, status, total_cents, customer_tax_id, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        sale.id, sale.terminalSeq, sale.sessionId, sale.kind, sale.status, sale.totalCents,
        sale.customerTaxId, sale.createdAt, JSON.stringify(sale),
      ],
    );
  }

  async getSale(id: string): Promise<StoredSale | null> {
    const [row] = await this.storage.query<Row>('SELECT data, status FROM sales WHERE id = ?', [id]);
    return row ? { ...(JSON.parse(row.data as string) as StoredSale), status: row.status as StoredSale['status'] } : null;
  }

  async findSaleBySeq(terminalSeq: number): Promise<StoredSale | null> {
    const [row] = await this.storage.query<Row>('SELECT id FROM sales WHERE terminal_seq = ?', [terminalSeq]);
    return row ? this.getSale(row.id as string) : null;
  }

  async listSales(sessionId?: string, limit = 500): Promise<StoredSale[]> {
    const rows = await this.storage.query<Row>(
      `SELECT data, status FROM sales ${sessionId ? 'WHERE session_id = ?' : ''} ORDER BY terminal_seq DESC LIMIT ?`,
      sessionId ? [sessionId, limit] : [limit],
    );
    return rows.map((r) => ({ ...(JSON.parse(r.data as string) as StoredSale), status: r.status as StoredSale['status'] }));
  }

  // ---------------------------------------------------------------- quotes

  async saveQuote(cart: Cart): Promise<string> {
    if (cart.lines.length === 0) throw new PdvError('O orçamento está vazio.');
    const id = cart.quoteId ?? this.newId();
    await this.storage.execute(
      `INSERT INTO quotes (id, created_at, status, data) VALUES (?, ?, 'open', ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      [id, this.now().toISOString(), JSON.stringify({ ...cart, quoteId: id })],
    );
    return id;
  }

  async listQuotes(): Promise<{ id: string; createdAt: string; totalCents: number; items: number }[]> {
    const rows = await this.storage.query<Row>("SELECT * FROM quotes WHERE status = 'open' ORDER BY created_at DESC");
    return rows.map((r) => {
      const cart = JSON.parse(r.data as string) as Cart;
      return { id: r.id as string, createdAt: r.created_at as string, totalCents: totals(cart).totalCents, items: cart.lines.length };
    });
  }

  /** Loads a quote into a cart, refreshing prices from the current catalog. */
  async loadQuote(id: string): Promise<Cart> {
    const [row] = await this.storage.query<Row>("SELECT data FROM quotes WHERE id = ? AND status = 'open'", [id]);
    if (!row) throw new PdvError('Orçamento não encontrado.');
    const cart = JSON.parse(row.data as string) as Cart;
    const lines = [];
    for (const line of cart.lines) {
      const [p] = await this.storage.query<Row>('SELECT price_cents, active FROM products WHERE id = ?', [line.productId]);
      if (!p || Number(p.active) !== 1) continue;
      lines.push({ ...line, unitPriceCents: Number(p.price_cents) });
    }
    return { ...cart, lines, quoteId: id };
  }

  // ---------------------------------------------------------------- outbox

  private async nextCounter(tx: Tx, key: string): Promise<number> {
    const value = Number((await getMeta(tx, key)) ?? '0') + 1;
    await setMeta(tx, key, String(value));
    return value;
  }

  private async enqueue<T extends TerminalEvent['type']>(
    tx: Tx,
    type: T,
    payload: Extract<TerminalEvent, { type: T }>['payload'],
  ) {
    const deviceSeq = await this.nextCounter(tx, 'outbox_seq');
    const event = terminalEvent.parse({
      id: this.newId(),
      type,
      occurredAt: this.now().toISOString(),
      terminalId: this.ctx.terminalId,
      operatorId: this.ctx.operatorId,
      deviceSeq,
      payload,
    });
    await tx.execute('INSERT INTO outbox (id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', [
      event.id,
      deviceSeq,
      type,
      JSON.stringify(event),
      event.occurredAt,
    ]);
  }

  async pendingEvents(limit = 100): Promise<TerminalEvent[]> {
    const rows = await this.storage.query<Row>(
      'SELECT payload FROM outbox WHERE sent_at IS NULL ORDER BY seq LIMIT ?',
      [limit],
    );
    return rows.map((r) => JSON.parse(r.payload as string) as TerminalEvent);
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.storage.query<{ n: number }>('SELECT count(*) AS n FROM outbox WHERE sent_at IS NULL');
    return Number(row?.n ?? 0);
  }

  async markSent(ids: string[]) {
    if (ids.length === 0) return;
    const at = this.now().toISOString();
    await this.storage.transaction(async (tx) => {
      for (const id of ids) await tx.execute('UPDATE outbox SET sent_at = ? WHERE id = ?', [at, id]);
    });
  }

  /** The server will never accept these; keep them (sent_at set) for support, stop retrying. */
  async markRejected(rejections: { id: string; reason: string }[]) {
    if (rejections.length === 0) return;
    const at = this.now().toISOString();
    await this.storage.transaction(async (tx) => {
      for (const r of rejections) {
        await tx.execute("UPDATE outbox SET sent_at = ?, last_error = 'REJEITADO: ' || ? WHERE id = ?", [at, r.reason, r.id]);
      }
    });
  }

  async rejectedEvents(): Promise<{ id: string; type: string; reason: string }[]> {
    const rows = await this.storage.query<Row>("SELECT id, type, last_error FROM outbox WHERE last_error LIKE 'REJEITADO:%' ORDER BY seq");
    return rows.map((r) => ({ id: r.id as string, type: r.type as string, reason: String(r.last_error).replace('REJEITADO: ', '') }));
  }

  async markFailed(id: string, error: string) {
    await this.storage.execute('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?', [error, id]);
  }
}
