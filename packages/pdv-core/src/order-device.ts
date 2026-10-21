import { uuidv7 } from '@bipae/domain';
import { createStorage, searchKey, type LocalStorage } from '@bipae/local-db';
import type { SqlDriver } from '@bipae/platform';

/**
 * Aparelho de vendas (F8-04, ADR-0017): o celular do vendedor ou do garçom guarda uma cópia
 * enxuta dos produtos e uma fila de pedidos. Sem internet, o pedido fica na fila com ID gerado
 * aqui (UUIDv7) e sai quando a rede voltar; o servidor aceita o mesmo ID uma vez só, então mandar
 * de novo nunca duplica.
 */

export interface DeviceProduct {
  id: string;
  name: string;
  priceCents: number;
  barcodes: string[];
}

export interface QueuedOrder {
  id: string;
  storeId: string;
  label: string;
  items: { productId: string; quantityMilli: number; name: string }[];
  createdAt: string;
  /** pending: na fila; failed: o servidor recusou (o motivo fica em `error`). */
  status: 'pending' | 'failed';
  error: string | null;
}

/** Resultado de um envio: ok, sem rede (tenta depois) ou recusado de vez (com o motivo). */
export type SendResult = { ok: true } | { ok: false; retry: true } | { ok: false; error: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS device_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  barcodes TEXT NOT NULL,
  search_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_orders (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS device_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

type Row = Record<string, unknown>;

export class OrderDevice {
  private constructor(private readonly db: LocalStorage) {}

  /** Abre direto do banco que a plataforma dá (nativo no desktop e no Android, OPFS na web). */
  static fromDriver(driver: SqlDriver): Promise<OrderDevice> {
    return OrderDevice.open(createStorage(driver));
  }

  static async open(db: LocalStorage): Promise<OrderDevice> {
    for (const statement of SCHEMA.split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.execute(statement);
    }
    return new OrderDevice(db);
  }

  /** Troca a cópia dos produtos inteira, numa transação: nunca fica pela metade. */
  async replaceCatalog(products: DeviceProduct[], at = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM device_products');
      for (const p of products) {
        await tx.execute(
          'INSERT INTO device_products (id, name, price_cents, barcodes, search_key) VALUES (?, ?, ?, ?, ?)',
          [p.id, p.name, p.priceCents, JSON.stringify(p.barcodes), searchKey(p.name)],
        );
      }
      await tx.execute(
        "INSERT INTO device_meta (key, value) VALUES ('catalog_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [at.toISOString()],
      );
    });
  }

  /** Quando a cópia dos produtos foi atualizada (nulo se nunca). */
  async catalogAt(): Promise<string | null> {
    const [row] = await this.db.query<Row>(
      "SELECT value FROM device_meta WHERE key = 'catalog_at'",
    );
    return (row?.value as string | undefined) ?? null;
  }

  /** Pelo código de barras exato ou por todas as palavras do nome, sem acento. */
  async search(text: string, limit = 10): Promise<DeviceProduct[]> {
    const typed = text.trim();
    if (!typed) return [];
    const toProduct = (r: Row): DeviceProduct => ({
      id: r.id as string,
      name: r.name as string,
      priceCents: Number(r.price_cents),
      barcodes: JSON.parse(r.barcodes as string) as string[],
    });
    if (/^\d{6,14}$/.test(typed)) {
      const rows = await this.db.query<Row>(
        'SELECT * FROM device_products WHERE barcodes LIKE ? LIMIT 20',
        [`%"${typed}"%`],
      );
      const exact = rows.map(toProduct).filter((p) => p.barcodes.includes(typed));
      if (exact.length) return exact.slice(0, limit);
    }
    const words = searchKey(typed).split(/\s+/).filter(Boolean);
    const rows = await this.db.query<Row>(
      `SELECT * FROM device_products WHERE ${words.map(() => 'search_key LIKE ?').join(' AND ')} ORDER BY name LIMIT ?`,
      [...words.map((w) => `%${w}%`), limit],
    );
    return rows.map(toProduct);
  }

  /** Guarda o pedido na fila (antes de tentar mandar), com o ID que vai ao servidor. */
  async enqueue(
    order: Omit<QueuedOrder, 'id' | 'createdAt' | 'status' | 'error'>,
    at = new Date(),
  ): Promise<QueuedOrder> {
    const queued: QueuedOrder = {
      ...order,
      id: uuidv7(),
      createdAt: at.toISOString(),
      status: 'pending',
      error: null,
    };
    await this.db.execute(
      "INSERT INTO device_orders (id, body, created_at, status) VALUES (?, ?, ?, 'pending')",
      [queued.id, JSON.stringify(order), queued.createdAt],
    );
    return queued;
  }

  async queued(): Promise<QueuedOrder[]> {
    const rows = await this.db.query<Row>('SELECT * FROM device_orders ORDER BY created_at, id');
    return rows.map((r) => ({
      ...(JSON.parse(r.body as string) as Omit<
        QueuedOrder,
        'id' | 'createdAt' | 'status' | 'error'
      >),
      id: r.id as string,
      createdAt: r.created_at as string,
      status: r.status as QueuedOrder['status'],
      error: (r.error as string | null) ?? null,
    }));
  }

  async discard(id: string): Promise<void> {
    await this.db.execute('DELETE FROM device_orders WHERE id = ?', [id]);
  }

  /**
   * Manda os pendentes em ordem. Sem rede, para e tenta depois (a ordem dos pedidos se
   * mantém); recusado de vez, fica marcado com o motivo para a pessoa decidir.
   */
  async flush(send: (order: QueuedOrder) => Promise<SendResult>): Promise<{ sent: number }> {
    let sent = 0;
    for (const order of await this.queued()) {
      if (order.status !== 'pending') continue;
      const result = await send(order);
      if (result.ok) {
        await this.discard(order.id);
        sent++;
      } else if ('retry' in result) {
        break;
      } else {
        await this.db.execute(
          "UPDATE device_orders SET status = 'failed', error = ? WHERE id = ?",
          [result.error, order.id],
        );
      }
    }
    return { sent };
  }
}
