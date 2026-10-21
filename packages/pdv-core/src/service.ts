import {
  cents,
  formatBRL,
  terminalEvent,
  uuidv7,
  type FiscalSnapshot,
  type LoyaltyProgram,
  type PaymentMethod,
  type PricingSnapshot,
  type SaleItem,
  type SalePayment,
  type SyncPullResult,
  type TabOrderForTerminal,
  type TerminalPaymentSettings,
  type TerminalEvent,
} from '@bipae/domain';
import {
  brasiliaDateTime,
  buildSaleNfceContingency,
  saleTaxSummaries,
  signNfe,
  type NfeSigner,
} from '@bipae/fiscal';
import type { Promotion } from '@bipae/promotions';
import { getMeta, searchKey, setMeta, type LocalStorage, type Tx } from '@bipae/local-db';
import {
  addItem,
  discountNeedsAuthorization,
  EMPTY_CART,
  totals,
  type Cart,
  type CartDelivery,
  type CartSeller,
  type CatalogItem,
} from './cart';
import {
  closeBlind,
  expectedBySession,
  type ByMethod,
  type CloseResult,
  type SessionActivity,
} from './cash';
import { summarizePayments, type TenderInput } from './payments';
import { withPromotions } from './promotions';

/** Tabelas do banco local apagadas quando o caixa é desativado (F2-04). */
const WIPE_TABLES = [
  'products',
  'barcodes',
  'cash_movements',
  'cash_sessions',
  'sales',
  'quotes',
  'outbox',
  'price_table_items',
  'price_tables',
  'customer_price_tables',
  'customer_credit',
  'fiscal_profiles',
  'meta',
] as const;

/** Justificativa da contingência off-line da NFC-e emitida pelo caixa (xJust, F3-15). */
const OFFLINE_REASON = 'Caixa sem conexão com a internet no momento da venda';

/** User-facing error from register operations (pt-BR). */
export class PdvError extends Error {}

/** A data no relógio do caixa (AAAA-MM-DD): é a data do fato gerador da venda. */
function localDate(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

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
  /** Venda para entrega (F5-10): a taxa já está no total. */
  delivery?: CartDelivery | null;
  originalSaleId?: string;
  refundMethod?: PaymentMethod;
  returnedItems?: { line: number; productId: string; quantityMilli: number; refundCents: number }[];
  /** NFC-e emitida pelo caixa em contingência off-line (F3-15), já assinada. */
  nfce?: { accessKey: string; xml: string };
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
  /**
   * Caixa sem internet com o certificado A1 no aparelho (F3-15): a NFC-e sai em contingência
   * off-line, assinada aqui. Sem isso, o servidor emite quando a venda chegar.
   */
  contingencySigner?: NfeSigner;
}

type Row = Record<string, unknown>;

function toProduct(row: Row): CatalogProduct {
  return {
    id: row.id as string,
    name: row.name as string,
    unit: row.unit as string,
    // Preço já resolvido: tabela do cliente, senão a da loja, senão o preço do cadastro.
    priceCents: Number(row.effective_price_cents ?? row.price_cents),
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

  /**
   * Troca de operador com o caixa aberto (F2-03): a sessão e a gaveta continuam; daqui em diante
   * as vendas saem no nome de quem entrou, e a troca vai para a auditoria.
   */
  async changeOperator(operatorId: string): Promise<void> {
    const session = await this.requireSession();
    const from = this.ctx.operatorId;
    if (from === operatorId) return;
    this.setOperator(operatorId);
    await this.storage.transaction(async (tx) => {
      await this.enqueue(tx, 'cash_session.operator_changed', {
        sessionId: session.id,
        fromOperatorId: from,
        toOperatorId: operatorId,
      });
    });
  }

  /**
   * Caixa desativado (F2-04): apaga os dados do aparelho (vendas, catálogo, clientes, preços e
   * configuração) depois que tudo subiu. Com evento pendente, recusa: nada se perde.
   */
  async wipeLocalData(): Promise<void> {
    const pending = await this.pendingCount();
    if (pending > 0) {
      throw new PdvError(
        `Ainda há ${pending} registro(s) para enviar. Conecte à internet antes de apagar.`,
      );
    }
    await this.storage.transaction(async (tx) => {
      for (const table of WIPE_TABLES) await tx.execute(`DELETE FROM ${table}`);
    });
  }

  // ---------------------------------------------------------------- catalog

  /** O primeiro parâmetro é a tabela de preço em vigor (ou null para o preço do cadastro). */
  private readonly productSelect = `
    SELECT p.*, (SELECT group_concat(code) FROM barcodes b WHERE b.product_id = p.id) AS barcodes,
      (SELECT i.price_cents FROM price_table_items i WHERE i.table_id = ? AND i.product_id = p.id) AS effective_price_cents
    FROM products p`;

  /**
   * Tabela de preço em vigor (F1-03): a do cliente (identificado pelo CPF/CNPJ na venda),
   * senão a tabela padrão da loja, senão nenhuma (preço do cadastro).
   */
  async activePriceTable(
    customerTaxId?: string | null,
  ): Promise<{ id: string; name: string } | null> {
    let id: string | null = null;
    if (customerTaxId) {
      const [row] = await this.storage.query<{ price_table_id: string }>(
        'SELECT price_table_id FROM customer_price_tables WHERE tax_id = ?',
        [customerTaxId],
      );
      id = row?.price_table_id ?? null;
    }
    id ??= await getMeta(this.storage, 'store_price_table_id');
    if (!id) return null;
    const [table] = await this.storage.query<{ id: string; name: string }>(
      'SELECT id, name FROM price_tables WHERE id = ?',
      [id],
    );
    return table ?? null;
  }

  async findByCode(code: string, customerTaxId?: string | null): Promise<CatalogProduct | null> {
    const table = (await this.activePriceTable(customerTaxId))?.id ?? null;
    const [row] = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.active = 1) AND (p.id IN (SELECT product_id FROM barcodes WHERE code = ?) OR p.sku = ?) LIMIT 1`,
      [table, code, code],
    );
    return row ? toProduct(row) : null;
  }

  /** PLU from a scale label matches the product's internal code (SKU), ignoring leading zeros. */
  async findByPlu(plu: string, customerTaxId?: string | null): Promise<CatalogProduct | null> {
    const table = (await this.activePriceTable(customerTaxId))?.id ?? null;
    const [row] = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.active = 1) AND p.is_weighable = 1 AND ltrim(p.sku, '0') = ? LIMIT 1`,
      [table, String(Number(plu))],
    );
    return row ? toProduct(row) : null;
  }

  async search(text: string, limit = 20, customerTaxId?: string | null): Promise<CatalogProduct[]> {
    const terms = searchKey(text).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const table = (await this.activePriceTable(customerTaxId))?.id ?? null;
    const where = terms.map(() => 'p.search_name LIKE ?').join(' AND ');
    const rows = await this.storage.query<Row>(
      `${this.productSelect} WHERE p.active = 1 AND NOT EXISTS (SELECT 1 FROM products v WHERE v.parent_id = p.id AND v.active = 1) AND ${where} ORDER BY p.search_name LIMIT ?`,
      [table, ...terms.map((t) => `%${t}%`), limit],
    );
    return rows.map(toProduct);
  }

  /** Preços dos produtos pela tabela em vigor (para recalcular um carrinho). */
  async pricesFor(
    productIds: string[],
    customerTaxId?: string | null,
  ): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    if (productIds.length === 0) return prices;
    const table = (await this.activePriceTable(customerTaxId))?.id ?? null;
    const marks = productIds.map(() => '?').join(', ');
    const rows = await this.storage.query<Row>(`${this.productSelect} WHERE p.id IN (${marks})`, [
      table,
      ...productIds,
    ]);
    for (const row of rows) prices.set(row.id as string, toProduct(row).priceCents);
    return prices;
  }

  /** Troca o retrato fiscal recebido na sincronização (F3-06): empresa do caixa e perfis fiscais. */
  async applyFiscal(fiscal: FiscalSnapshot) {
    await this.storage.transaction(async (tx) => {
      await tx.execute('DELETE FROM fiscal_profiles');
      for (const { id, ...data } of fiscal.profiles) {
        await tx.execute('INSERT INTO fiscal_profiles (id, data) VALUES (?, ?)', [
          id,
          JSON.stringify(data),
        ]);
      }
      await setMeta(tx, 'company_uf', fiscal.company.uf ?? '');
      await setMeta(tx, 'company_tax_regime', fiscal.company.taxRegime ?? '');
      await setMeta(tx, 'company_icms_rules', JSON.stringify(fiscal.icmsRules ?? []));
      // Emitente e série do caixa, para a NFC-e em contingência (F3-15).
      await setMeta(tx, 'fiscal_issuer', fiscal.issuer ? JSON.stringify(fiscal.issuer) : '');
    });
  }

  /** Os dados fiscais que o caixa tem guardados: a empresa e os perfis, por id. */
  async fiscalContext(): Promise<{
    company: FiscalSnapshot['company'];
    profiles: Map<string, Omit<FiscalSnapshot['profiles'][number], 'id'>>;
    icmsRules: NonNullable<FiscalSnapshot['icmsRules']>;
    issuer: FiscalSnapshot['issuer'] | null;
  }> {
    const rows = await this.storage.query<{ id: string; data: string }>(
      'SELECT id, data FROM fiscal_profiles',
    );
    return {
      company: {
        uf: (await getMeta(this.storage, 'company_uf')) || null,
        taxRegime: (await getMeta(this.storage, 'company_tax_regime')) || null,
      },
      profiles: new Map(rows.map((row) => [row.id, JSON.parse(row.data)])),
      icmsRules: JSON.parse((await getMeta(this.storage, 'company_icms_rules')) || '[]'),
      issuer: JSON.parse((await getMeta(this.storage, 'fiscal_issuer')) || 'null'),
    };
  }

  /** Troca o retrato de preços recebido na sincronização (F1-03). */
  async applyPricing(pricing: PricingSnapshot) {
    await this.storage.transaction(async (tx) => {
      await tx.execute('DELETE FROM price_table_items');
      await tx.execute('DELETE FROM price_tables');
      await tx.execute('DELETE FROM customer_price_tables');
      await tx.execute('DELETE FROM customer_credit');
      for (const c of pricing.credit ?? []) {
        await tx.execute(
          'INSERT INTO customer_credit (tax_id, limit_cents, balance_cents, blocked) VALUES (?, ?, ?, ?)',
          [c.taxId, c.limitCents, c.balanceCents, c.blocked ? 1 : 0],
        );
      }
      for (const table of pricing.tables) {
        await tx.execute('INSERT INTO price_tables (id, name) VALUES (?, ?)', [
          table.id,
          table.name,
        ]);
        for (const item of table.items) {
          await tx.execute(
            'INSERT INTO price_table_items (table_id, product_id, price_cents) VALUES (?, ?, ?)',
            [table.id, item.productId, item.priceCents],
          );
        }
      }
      for (const c of pricing.customers) {
        await tx.execute(
          'INSERT INTO customer_price_tables (tax_id, price_table_id) VALUES (?, ?) ON CONFLICT (tax_id) DO UPDATE SET price_table_id = excluded.price_table_id',
          [c.taxId, c.priceTableId],
        );
      }
      if (pricing.storePriceTableId)
        await setMeta(tx, 'store_price_table_id', pricing.storePriceTableId);
      else await tx.execute("DELETE FROM meta WHERE key = 'store_price_table_id'");
      // Promoções (F5-02): a lista inteira, no formato do motor.
      await setMeta(tx, 'promotions', JSON.stringify(pricing.promotions ?? []));
      await setMeta(tx, 'delivery_zones', JSON.stringify(pricing.deliveryZones ?? []));
      await setMeta(tx, 'sellers', JSON.stringify(pricing.sellers ?? []));
      await setMeta(tx, 'payments', JSON.stringify(pricing.payments ?? null));
      await setMeta(tx, 'loyalty', JSON.stringify(pricing.loyalty ?? null));
      // Momento do retrato: vendas enviadas depois dele ainda não aparecem nos saldos do servidor.
      await setMeta(tx, 'pricing_applied_at', this.now().toISOString());
    });
  }

  /**
   * Vendas que o retrato de preços ainda não contém: as que não subiram e as que subiram depois
   * dele. Sem a segunda parte, entre o envio da venda e a chegada do retrato novo, o crediário e
   * os pontos pareciam inteiros de novo e dava para gastar duas vezes.
   */
  private async salesNotInSnapshot(): Promise<{ payload: string }[]> {
    const appliedAt = (await getMeta(this.storage, 'pricing_applied_at')) ?? '';
    return this.storage.query<{ payload: string }>(
      "SELECT payload FROM outbox WHERE type = 'sale.completed' AND (sent_at IS NULL OR sent_at >= ?)",
      [appliedAt],
    );
  }

  /**
   * Fidelidade no caixa (F6-08.b): o programa e o saldo do último retrato, menos os pontos que
   * este caixa já usou em vendas que ainda não subiram. Funciona sem internet.
   */
  async loyaltyFor(taxId: string): Promise<{ program: LoyaltyProgram | null; points: number }> {
    const snapshot = JSON.parse((await getMeta(this.storage, 'loyalty')) || 'null') as
      PricingSnapshot['loyalty'] | null;
    const program = snapshot?.program ?? null;
    if (!program?.active) return { program, points: 0 };
    const balance = snapshot!.balances.find((b) => b.taxId === taxId)?.points ?? 0;
    const pending = await this.salesNotInSnapshot();
    let used = 0;
    for (const { payload } of pending) {
      const sale = (
        JSON.parse(payload) as {
          payload: { customerTaxId?: string | null; loyalty?: { points: number } };
        }
      ).payload;
      if (sale.customerTaxId === taxId && sale.loyalty) used += sale.loyalty.points;
    }
    return { program, points: Math.max(0, balance - used) };
  }

  private async assertLoyalty(cart: Cart, appliedCents: number) {
    const use = cart.loyalty!;
    if (!cart.customerTaxId) {
      throw new PdvError('Para usar pontos, informe o CPF ou CNPJ do cliente (F6).');
    }
    const { program, points } = await this.loyaltyFor(cart.customerTaxId);
    if (!program?.active) throw new PdvError('O programa de fidelidade está desligado.');
    if (use.points > points) {
      throw new PdvError(`Este cliente tem só ${points} pontos para usar.`);
    }
    if (use.points < program.minRedeemPoints) {
      throw new PdvError(`O mínimo para usar é de ${program.minRedeemPoints} pontos.`);
    }
    if (
      use.discountCents !== use.points * program.pointValueCents ||
      appliedCents !== use.discountCents
    ) {
      throw new PdvError(
        'O desconto dos pontos não confere com o valor da venda. Use os pontos de novo.',
      );
    }
  }

  /** Promoções do último retrato de preços (F5-02); vazio antes da primeira sincronização. */
  /** Bairros atendidos pela entrega, com a taxa (F5-10), do último retrato de preços. */
  /**
   * Meios de pagamento da loja (F8-08), do último retrato. Sem retrato ainda: maquininha à parte
   * e Pix manual, que funcionam em qualquer caso.
   */
  async paymentSettings(): Promise<TerminalPaymentSettings> {
    const saved = JSON.parse(
      (await getMeta(this.storage, 'payments')) || 'null',
    ) as TerminalPaymentSettings | null;
    return saved ?? { card: 'manual', pix: 'manual' };
  }

  /** Vendedores ativos (F8-01), do último retrato: o caixa escolhe sem internet. */
  async sellers(): Promise<CartSeller[]> {
    return JSON.parse((await getMeta(this.storage, 'sellers')) || '[]') as CartSeller[];
  }

  /** Vendedor pelo código digitado no caixa ("7" acha o código "07" também). */
  async sellerByCode(code: string): Promise<CartSeller | null> {
    const wanted = code.trim().replace(/^0+(?=\d)/, '');
    return (await this.sellers()).find((s) => s.code.replace(/^0+(?=\d)/, '') === wanted) ?? null;
  }

  async deliveryZones(): Promise<{ id: string; name: string; feeCents: number }[]> {
    return JSON.parse((await getMeta(this.storage, 'delivery_zones')) || '[]') as {
      id: string;
      name: string;
      feeCents: number;
    }[];
  }

  async promotions(): Promise<Promotion[]> {
    return JSON.parse((await getMeta(this.storage, 'promotions')) || '[]') as Promotion[];
  }

  /** O carrinho com as promoções vigentes hoje aplicadas (o que a tela mostra e a venda grava). */
  async priceWithPromotions(cart: Cart): Promise<Cart> {
    return withPromotions(cart, await this.promotions(), localDate(this.now()));
  }

  /**
   * Crediário do cliente no caixa (F2-02): o limite e o saldo do último retrato, menos as vendas
   * no crediário deste caixa que ainda não subiram. Null quando o cliente não tem crediário.
   */
  async creditAvailable(
    taxId: string,
  ): Promise<{ limitCents: number; availableCents: number; blocked: boolean } | null> {
    const [row] = await this.storage.query<{
      limit_cents: number;
      balance_cents: number;
      blocked: number;
    }>('SELECT limit_cents, balance_cents, blocked FROM customer_credit WHERE tax_id = ?', [taxId]);
    if (!row) return null;
    const pending = await this.salesNotInSnapshot();
    let pendingCents = 0;
    for (const { payload } of pending) {
      // A coluna guarda o evento inteiro; a venda está em `payload`.
      const sale = (
        JSON.parse(payload) as {
          payload: {
            customerTaxId?: string | null;
            payments?: { method: string; amountCents: number }[];
          };
        }
      ).payload;
      if (sale.customerTaxId !== taxId) continue;
      for (const p of sale.payments ?? [])
        if (p.method === 'store_credit') pendingCents += p.amountCents;
    }
    const limitCents = Number(row.limit_cents);
    return {
      limitCents,
      availableCents: Math.max(0, limitCents - Number(row.balance_cents) - pendingCents),
      blocked: Number(row.blocked) === 1,
    };
  }

  async catalogSize(): Promise<number> {
    const [row] = await this.storage.query<{ n: number }>('SELECT count(*) AS n FROM products');
    return Number(row?.n ?? 0);
  }

  /** Upserts products from a sync pull. */
  /**
   * Grava os produtos de uma sincronização. Em blocos (uma instrução SQL para cada 200 produtos):
   * no navegador cada instrução é uma mensagem para o worker do SQLite, e a primeira carga de um
   * catálogo grande precisa caber em segundos, não em minutos (F7-01).
   */
  async applyCatalog(products: SyncPullResult['products']) {
    const CHUNK = 200;
    await this.storage.transaction(async (tx) => {
      for (let start = 0; start < products.length; start += CHUNK) {
        const chunk = products.slice(start, start + CHUNK);
        await tx.execute(
          `INSERT INTO products (id, name, search_name, sku, unit, price_cents, is_weighable, active, ncm, cest, fiscal_profile_id, parent_id, updated_at)
           VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, search_name = excluded.search_name,
             sku = excluded.sku, unit = excluded.unit, price_cents = excluded.price_cents,
             is_weighable = excluded.is_weighable, active = excluded.active, ncm = excluded.ncm,
             cest = excluded.cest, fiscal_profile_id = excluded.fiscal_profile_id, parent_id = excluded.parent_id,
             updated_at = excluded.updated_at`,
          chunk.flatMap((p) => [
            p.id,
            p.name,
            searchKey(p.name),
            p.sku,
            p.unit,
            p.priceCents,
            p.isWeighable ? 1 : 0,
            p.active ? 1 : 0,
            p.ncm,
            p.cest,
            p.fiscalProfileId,
            p.parentId ?? null,
            p.updatedAt,
          ]),
        );
        await tx.execute(
          `DELETE FROM barcodes WHERE product_id IN (${chunk.map(() => '?').join(', ')})`,
          chunk.map((p) => p.id),
        );
        const codes = chunk.flatMap((p) => p.barcodes.map((code) => [code, p.id]));
        for (let c = 0; c < codes.length; c += 400) {
          const part = codes.slice(c, c + 400);
          await tx.execute(
            `INSERT INTO barcodes (code, product_id) VALUES ${part.map(() => '(?, ?)').join(', ')}
             ON CONFLICT (code) DO UPDATE SET product_id = excluded.product_id`,
            part.flat(),
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
    if (!Number.isInteger(openingCents) || openingCents < 0)
      throw new PdvError('Valor de abertura inválido.');
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
    const [session] = await this.storage.query<Row>('SELECT * FROM cash_sessions WHERE id = ?', [
      sessionId,
    ]);
    if (!session) throw new PdvError('Caixa não encontrado.');
    const sales = await this.listSales(sessionId);
    const movements = await this.storage.query<Row>(
      'SELECT * FROM cash_movements WHERE session_id = ?',
      [sessionId],
    );
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
    if (!Number.isInteger(amountCents) || amountCents <= 0)
      throw new PdvError('Informe um valor maior que zero.');
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

  async completeSale(
    rawCart: Cart,
    tenders: TenderInput[],
    options: CompleteSaleOptions,
  ): Promise<StoredSale> {
    const session = await this.requireSession();
    // A conta da promoção é refeita aqui, com as promoções do caixa, para a venda gravar o mesmo
    // que a tela mostrou mesmo se o carrinho veio sem ela.
    const cart = await this.priceWithPromotions(rawCart);
    if (cart.lines.length === 0) throw new PdvError('O carrinho está vazio.');
    if (
      discountNeedsAuthorization(cart, options.discountLimitPercent) &&
      !options.discountAuthorizedBy
    ) {
      throw new PdvError(
        `Desconto acima de ${options.discountLimitPercent}% precisa da autorização de um gerente.`,
      );
    }
    const t = totals(cart);
    if (cart.loyalty) await this.assertLoyalty(cart, t.loyaltyDiscountCents);
    const summary = summarizePayments(t.totalCents, tenders);
    if (summary.remainingCents > 0)
      throw new PdvError('Ainda falta receber parte do valor da venda.');
    const onCredit = summary.payments
      .filter((p) => p.method === 'store_credit')
      .reduce((sum, p) => sum + p.amountCents, 0);
    if (onCredit > 0) {
      if (!cart.customerTaxId) {
        throw new PdvError('Para vender no crediário, informe o CPF ou CNPJ do cliente (F6).');
      }
      const credit = await this.creditAvailable(cart.customerTaxId);
      if (!credit) {
        throw new PdvError(
          'Este cliente não tem crediário. O limite é liberado no cadastro do cliente.',
        );
      }
      if (credit.blocked) {
        throw new PdvError(
          'Este cliente tem parcela do crediário vencida. Receba o atrasado antes de vender no crediário.',
        );
      }
      if (onCredit > credit.availableCents) {
        throw new PdvError(
          `O crediário deste cliente tem só ${formatBRL(cents(credit.availableCents))} disponíveis.`,
        );
      }
    }

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
      items: await this.withTaxes(t.items),
      payments: summary.payments,
      customerTaxId: cart.customerTaxId,
      ...(cart.delivery && { delivery: cart.delivery }),
    };
    // NFC-e em contingência (F3-15): montada e assinada antes de gravar, com o próximo número.
    // Se o número reservado não for o mesmo, a nota fica para o servidor. Nunca impede a venda.
    const expectedSeq = Number((await getMeta(this.storage, 'sale_seq')) ?? '0') + 1;
    let nfce = options.contingencySigner
      ? await this.contingencyNfce({ ...sale, terminalSeq: expectedSeq }, options.contingencySigner)
      : null;
    await this.storage.transaction(async (tx) => {
      sale.terminalSeq = await this.nextCounter(tx, 'sale_seq');
      if (nfce && sale.terminalSeq !== expectedSeq) nfce = null;
      if (nfce) sale.nfce = nfce;
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
        ...(cart.appliedPromotions?.length && { promotions: cart.appliedPromotions }),
        ...(nfce && { nfce }),
        ...(cart.delivery && { delivery: cart.delivery }),
        ...(cart.loyalty && { loyalty: cart.loyalty }),
        ...(cart.seller && { sellerId: cart.seller.id }),
        quoteId: cart.quoteId,
      });
      if (cart.tabId) {
        await tx.execute(
          "UPDATE tabs SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'",
          [this.now().toISOString(), cart.tabId],
        );
        await this.enqueue(tx, 'tab.closed', {
          tabId: cart.tabId,
          outcome: 'paid',
          saleId: sale.id,
          reason: null,
        });
      }
    });
    return sale;
  }

  /**
   * A NFC-e da venda em contingência off-line, montada e assinada no caixa com os dados do
   * retrato fiscal (F3-15). Null quando falta algo: aí o servidor emite quando a venda chegar.
   */
  private async contingencyNfce(
    sale: StoredSale,
    signer: NfeSigner,
  ): Promise<{ accessKey: string; xml: string } | null> {
    try {
      const { company, profiles, icmsRules, issuer } = await this.fiscalContext();
      if (!issuer) return null;
      const ids = [...new Set(sale.items.map((item) => item.productId))];
      const place = ids.map(() => '?').join(', ');
      const rows = await this.storage.query<{
        id: string;
        sku: string | null;
        ncm: string | null;
        cest: string | null;
        fiscal_profile_id: string | null;
      }>(`SELECT id, sku, ncm, cest, fiscal_profile_id FROM products WHERE id IN (${place})`, ids);
      const codes = await this.storage.query<{ code: string; product_id: string }>(
        `SELECT code, product_id FROM barcodes WHERE product_id IN (${place})`,
        ids,
      );
      const result = await buildSaleNfceContingency(
        {
          saleId: sale.id,
          company: {
            cnpj: issuer.cnpj,
            legalName: issuer.legalName,
            tradeName: issuer.tradeName,
            ie: issuer.ie,
            uf: company.uf,
            regime: company.taxRegime,
            address: issuer.address,
          },
          series: issuer.nfceSeries,
          terminalSeq: sale.terminalSeq,
          occurredAt: sale.createdAt,
          items: sale.items.map((item) => {
            const row = rows.find((r) => r.id === item.productId);
            return {
              code: row?.sku ?? item.productId.slice(0, 60),
              barcodes: codes.filter((b) => b.product_id === item.productId).map((b) => b.code),
              description: item.name,
              ncm: row?.ncm ?? null,
              cest: row?.cest ?? null,
              unit: item.unit,
              quantityMilli: item.quantityMilli,
              unitPriceCents: item.unitPriceCents,
              grossCents: item.grossCents,
              discountCents: item.discountCents,
              profile: profiles.get(row?.fiscal_profile_id ?? '') ?? null,
            };
          }),
          payments: sale.payments.map((p) => ({
            method: p.method,
            amountCents: p.amountCents,
            changeCents: p.changeCents,
            authorizationCode: p.authorizationCode ?? null,
          })),
          customerTaxId: sale.customerTaxId,
          ...(sale.delivery && {
            delivery: { feeCents: sale.delivery.feeCents, address: sale.delivery.address },
          }),
          rules: icmsRules,
          paymentCodes: issuer.paymentCodes,
          appVersion: 'Bipaê caixa',
        },
        { enteredAt: brasiliaDateTime(sale.createdAt), reason: OFFLINE_REASON },
        signer,
      );
      if (!result.ok) return null;
      return {
        accessKey: result.document.accessKey,
        xml: await signNfe(result.document.xml, signer),
      };
    } catch {
      return null;
    }
  }

  /**
   * Anexa a cada item o resumo dos impostos (F3-06.d3), calculado com os dados fiscais guardados
   * no caixa. Funciona sem internet. O cálculo nunca impede a venda: se a empresa ainda não
   * configurou a parte fiscal, ou se algo inesperado acontecer, a venda segue sem o resumo.
   */
  private async withTaxes(items: SaleItem[]): Promise<SaleItem[]> {
    try {
      const { company, profiles, icmsRules } = await this.fiscalContext();
      if (!company.uf && !company.taxRegime) return items;
      const ids = [...new Set(items.map((item) => item.productId))];
      const rows = await this.storage.query<{
        id: string;
        fiscal_profile_id: string | null;
        ncm: string | null;
      }>(
        `SELECT id, fiscal_profile_id, ncm FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      );
      const profileOf = new Map(rows.map((row) => [row.id, row.fiscal_profile_id]));
      const ncmOf = new Map(rows.map((row) => [row.id, row.ncm]));
      const summaries = saleTaxSummaries({
        company,
        items: items.map((item) => ({
          operationCents: item.totalCents,
          profile: profiles.get(profileOf.get(item.productId) ?? '') ?? null,
          ncm: ncmOf.get(item.productId) ?? null,
        })),
        date: localDate(this.now()),
        rules: icmsRules,
      });
      return summaries
        ? items.map((item, index) => ({ ...item, taxes: summaries[index]! }))
        : items;
    } catch {
      return items;
    }
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
        throw new PdvError(
          `Só dá para devolver até ${remaining / 1000} ${item.unit} de "${item.name}".`,
        );
      }
      // The last return of a line refunds exactly what is left, so refunds never drift by a cent.
      const refundCents =
        quantityMilli === remaining
          ? item.totalCents - prev.refundCents
          : Math.floor(
              (item.totalCents * quantityMilli + item.quantityMilli / 2) / item.quantityMilli,
            );
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
        sale.id,
        sale.terminalSeq,
        sale.sessionId,
        sale.kind,
        sale.status,
        sale.totalCents,
        sale.customerTaxId,
        sale.createdAt,
        JSON.stringify(sale),
      ],
    );
  }

  async getSale(id: string): Promise<StoredSale | null> {
    const [row] = await this.storage.query<Row>('SELECT data, status FROM sales WHERE id = ?', [
      id,
    ]);
    return row
      ? {
          ...(JSON.parse(row.data as string) as StoredSale),
          status: row.status as StoredSale['status'],
        }
      : null;
  }

  async findSaleBySeq(terminalSeq: number): Promise<StoredSale | null> {
    const [row] = await this.storage.query<Row>('SELECT id FROM sales WHERE terminal_seq = ?', [
      terminalSeq,
    ]);
    return row ? this.getSale(row.id as string) : null;
  }

  async listSales(sessionId?: string, limit = 500): Promise<StoredSale[]> {
    const rows = await this.storage.query<Row>(
      `SELECT data, status FROM sales ${sessionId ? 'WHERE session_id = ?' : ''} ORDER BY terminal_seq DESC LIMIT ?`,
      sessionId ? [sessionId, limit] : [limit],
    );
    return rows.map((r) => ({
      ...(JSON.parse(r.data as string) as StoredSale),
      status: r.status as StoredSale['status'],
    }));
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

  async listQuotes(): Promise<
    { id: string; createdAt: string; totalCents: number; items: number }[]
  > {
    const rows = await this.storage.query<Row>(
      "SELECT * FROM quotes WHERE status = 'open' ORDER BY created_at DESC",
    );
    return rows.map((r) => {
      const cart = JSON.parse(r.data as string) as Cart;
      return {
        id: r.id as string,
        createdAt: r.created_at as string,
        totalCents: totals(cart).totalCents,
        items: cart.lines.length,
      };
    });
  }

  /** Loads a quote into a cart, refreshing prices from the current catalog. */
  async loadQuote(id: string): Promise<Cart> {
    const [row] = await this.storage.query<Row>(
      "SELECT data FROM quotes WHERE id = ? AND status = 'open'",
      [id],
    );
    if (!row) throw new PdvError('Orçamento não encontrado.');
    const cart = JSON.parse(row.data as string) as Cart;
    const lines = [];
    for (const line of cart.lines) {
      const [p] = await this.storage.query<Row>(
        'SELECT price_cents, active FROM products WHERE id = ?',
        [line.productId],
      );
      if (!p || Number(p.active) !== 1) continue;
      lines.push({ ...line, unitPriceCents: Number(p.price_cents) });
    }
    return { ...cart, lines, quoteId: id };
  }

  // ---------------------------------------------------------------- comandas (F5-07)

  /** Itens da comanda no formato do evento (o servidor guarda para o garçom e a cozinha). */
  private tabItems(cart: Cart) {
    return cart.lines.map((l) => ({
      line: l.line,
      productId: l.productId,
      name: l.name.slice(0, 120),
      unit: l.unit,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
    }));
  }

  /**
   * Pedidos do garçom (F5-08): cada um entra na comanda aberta com o mesmo nome (ou abre uma
   * nova), na mesma transação que marca o pedido como recebido. Pedido já juntado não entra de
   * novo, mesmo que o servidor o mande outra vez antes de saber que chegou.
   */
  async applyTabOrders(orders: TabOrderForTerminal[]): Promise<void> {
    for (const order of orders) {
      const [done] = await this.storage.query<Row>(
        'SELECT id FROM applied_tab_orders WHERE id = ?',
        [order.id],
      );
      if (done) continue;
      const table = (await this.activePriceTable(null))?.id ?? null;
      const missing: string[] = [];
      const lines: { product: CatalogProduct; quantityMilli: number }[] = [];
      for (const item of order.items) {
        const [row] = await this.storage.query<Row>(
          `${this.productSelect} WHERE p.id = ? AND p.active = 1 LIMIT 1`,
          [table, item.productId],
        );
        if (row) lines.push({ product: toProduct(row), quantityMilli: item.quantityMilli });
        else missing.push(item.productId);
      }
      const label = order.label.trim().slice(0, 30);
      await this.storage.transaction(async (tx) => {
        await tx.execute('INSERT INTO applied_tab_orders (id, applied_at) VALUES (?, ?)', [
          order.id,
          this.now().toISOString(),
        ]);
        if (missing.length > 0 || lines.length === 0 || !label) {
          await this.enqueue(tx, 'tab.order_received', {
            orderId: order.id,
            tabId: null,
            rejected: 'Produto do pedido não está no caixa (inativo ou ainda não sincronizado).',
          });
          return;
        }
        const at = this.now().toISOString();
        const [open] = await tx.query<Row>(
          "SELECT id, label, data FROM tabs WHERE status = 'open' AND lower(label) = lower(?)",
          [label],
        );
        let cart: Cart;
        if (open) {
          cart = { ...(JSON.parse(open.data as string) as Cart), tabId: open.id as string };
        } else {
          const id = this.newId();
          cart = { ...EMPTY_CART, tabId: id, tabLabel: label };
          await tx.execute(
            "INSERT INTO tabs (id, label, opened_at, updated_at, status, data) VALUES (?, ?, ?, ?, 'open', ?)",
            [id, label, at, at, JSON.stringify(cart)],
          );
          await this.enqueue(tx, 'tab.opened', { tabId: id, label, openedAt: at });
        }
        for (const line of lines) {
          cart = addItem(cart, line.product, line.quantityMilli, undefined, order.sellerId ?? null);
        }
        const tabLabel = (open?.label as string | undefined) ?? label;
        await tx.execute('UPDATE tabs SET data = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify({ ...cart, tabLabel }),
          at,
          cart.tabId,
        ]);
        await this.enqueue(tx, 'tab.updated', {
          tabId: cart.tabId!,
          label: tabLabel,
          items: this.tabItems(cart),
          totalCents: totals(cart).totalCents,
        });
        await this.enqueue(tx, 'tab.order_received', {
          orderId: order.id,
          tabId: cart.tabId!,
          rejected: null,
        });
      });
    }
  }

  /** Abre uma comanda pela mesa ou pelo número. Não pode haver duas abertas com o mesmo nome. */
  async openTab(label: string): Promise<Cart> {
    const name = label.trim();
    if (!name) throw new PdvError('Informe a mesa ou o número da comanda.');
    if (name.length > 30) throw new PdvError('Nome da comanda muito longo (até 30 letras).');
    const [taken] = await this.storage.query<Row>(
      "SELECT id FROM tabs WHERE status = 'open' AND lower(label) = lower(?)",
      [name],
    );
    if (taken) throw new PdvError(`A comanda ${name} já está aberta.`);
    const id = this.newId();
    const at = this.now().toISOString();
    const cart: Cart = { ...EMPTY_CART, tabId: id, tabLabel: name };
    await this.storage.transaction(async (tx) => {
      await tx.execute(
        "INSERT INTO tabs (id, label, opened_at, updated_at, status, data) VALUES (?, ?, ?, ?, 'open', ?)",
        [id, name, at, at, JSON.stringify(cart)],
      );
      await this.enqueue(tx, 'tab.opened', { tabId: id, label: name, openedAt: at });
    });
    return cart;
  }

  /** Guarda a comanda como está (itens lançados até agora) e devolve o caixa livre. */
  async saveTab(cart: Cart): Promise<void> {
    if (!cart.tabId) throw new PdvError('Este carrinho não é de uma comanda.');
    const [row] = await this.storage.query<Row>(
      "SELECT label FROM tabs WHERE id = ? AND status = 'open'",
      [cart.tabId],
    );
    if (!row) throw new PdvError('Esta comanda já foi fechada.');
    const label = row.label as string;
    const { promotionDiscounts: _p, appliedPromotions: _a, ...plain } = cart;
    await this.storage.transaction(async (tx) => {
      await tx.execute('UPDATE tabs SET data = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify({ ...plain, tabLabel: label }),
        this.now().toISOString(),
        cart.tabId,
      ]);
      await this.enqueue(tx, 'tab.updated', {
        tabId: cart.tabId!,
        label,
        items: this.tabItems(cart),
        totalCents: totals(cart).totalCents,
      });
    });
  }

  async listTabs(): Promise<
    { id: string; label: string; openedAt: string; totalCents: number; items: number }[]
  > {
    const rows = await this.storage.query<Row>(
      "SELECT * FROM tabs WHERE status = 'open' ORDER BY opened_at",
    );
    return rows.map((r) => {
      const cart = JSON.parse(r.data as string) as Cart;
      return {
        id: r.id as string,
        label: r.label as string,
        openedAt: r.opened_at as string,
        totalCents: totals(cart).totalCents,
        items: cart.lines.length,
      };
    });
  }

  /** Traz a comanda para o caixa (os preços são os de quando cada item foi lançado). */
  async loadTab(id: string): Promise<Cart> {
    const [row] = await this.storage.query<Row>(
      "SELECT data, label FROM tabs WHERE id = ? AND status = 'open'",
      [id],
    );
    if (!row) throw new PdvError('Comanda não encontrada ou já fechada.');
    const cart = JSON.parse(row.data as string) as Cart;
    return { ...cart, tabId: id, tabLabel: row.label as string };
  }

  /** Cancela a comanda (a mesa foi embora sem consumir, por exemplo). Fica o motivo. */
  async cancelTab(id: string, reason: string): Promise<void> {
    if (reason.trim().length < 3) throw new PdvError('Informe o motivo do cancelamento.');
    await this.storage.transaction(async (tx) => {
      const [row] = await tx.query<Row>("SELECT id FROM tabs WHERE id = ? AND status = 'open'", [
        id,
      ]);
      if (!row) throw new PdvError('Comanda não encontrada ou já fechada.');
      await tx.execute("UPDATE tabs SET status = 'cancelled', updated_at = ? WHERE id = ?", [
        this.now().toISOString(),
        id,
      ]);
      await this.enqueue(tx, 'tab.closed', {
        tabId: id,
        outcome: 'cancelled',
        saleId: null,
        reason: reason.trim().slice(0, 200),
      });
    });
  }

  // ---------------------------------------------------------------- outbox

  /**
   * Garante que a numeração das vendas continue depois do último número que o servidor já recebeu
   * deste caixa (F3-12). Sem isso, um aparelho novo ligado a um caixa antigo recomeçaria em 1 e
   * repetiria números de venda e de NFC-e. Nunca diminui o contador.
   */
  async alignSaleSequence(lastOnServer: number) {
    if (!Number.isSafeInteger(lastOnServer) || lastOnServer < 0) return;
    await this.storage.transaction(async (tx) => {
      const current = Number((await getMeta(tx, 'sale_seq')) ?? '0');
      if (lastOnServer > current) await setMeta(tx, 'sale_seq', String(lastOnServer));
    });
  }

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
    await tx.execute(
      'INSERT INTO outbox (id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      [event.id, deviceSeq, type, JSON.stringify(event), event.occurredAt],
    );
  }

  async pendingEvents(limit = 100): Promise<TerminalEvent[]> {
    const rows = await this.storage.query<Row>(
      'SELECT payload FROM outbox WHERE sent_at IS NULL ORDER BY seq LIMIT ?',
      [limit],
    );
    return rows.map((r) => JSON.parse(r.payload as string) as TerminalEvent);
  }

  async pendingCount(): Promise<number> {
    const [row] = await this.storage.query<{ n: number }>(
      'SELECT count(*) AS n FROM outbox WHERE sent_at IS NULL',
    );
    return Number(row?.n ?? 0);
  }

  async markSent(ids: string[]) {
    if (ids.length === 0) return;
    const at = this.now().toISOString();
    await this.storage.transaction(async (tx) => {
      for (const id of ids)
        await tx.execute('UPDATE outbox SET sent_at = ? WHERE id = ?', [at, id]);
    });
  }

  /** The server will never accept these; keep them (sent_at set) for support, stop retrying. */
  async markRejected(rejections: { id: string; reason: string }[]) {
    if (rejections.length === 0) return;
    const at = this.now().toISOString();
    await this.storage.transaction(async (tx) => {
      for (const r of rejections) {
        await tx.execute(
          "UPDATE outbox SET sent_at = ?, last_error = 'REJEITADO: ' || ? WHERE id = ?",
          [at, r.reason, r.id],
        );
      }
    });
  }

  async rejectedEvents(): Promise<{ id: string; type: string; reason: string }[]> {
    const rows = await this.storage.query<Row>(
      "SELECT id, type, last_error FROM outbox WHERE last_error LIKE 'REJEITADO:%' ORDER BY seq",
    );
    return rows.map((r) => ({
      id: r.id as string,
      type: r.type as string,
      reason: String(r.last_error).replace('REJEITADO: ', ''),
    }));
  }

  async markFailed(id: string, error: string) {
    await this.storage.execute(
      'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?',
      [error, id],
    );
  }
}
