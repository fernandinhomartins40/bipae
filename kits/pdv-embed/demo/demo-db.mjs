// Banco de demonstração (PGlite: PostgreSQL em memória) com uma "aplicação hospedeira" fictícia:
// a tabela demo_products faz o papel da tabela de produtos que a sua aplicação já tem.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const SCHEMA = new URL('../sql/postgres.sql', import.meta.url);

export const DEMO_STORE = 'loja-demo';

const PRODUCTS = [
  ['p1', 'Arroz Tipo 1 5kg', '7891000100103', 'ARZ5', 2890, 'UN', false, 40],
  ['p2', 'Feijão Carioca 1kg', '7891000200100', 'FJC1', 899, 'UN', false, 60],
  ['p3', 'Café Torrado 500g', '7891000300107', 'CAF5', 1749, 'UN', false, 25],
  ['p4', 'Leite Integral 1L', '7891000400104', 'LTI1', 559, 'UN', false, 120],
  ['p5', 'Banana Prata', null, 'BAN', 699, 'KG', true, 30],
  ['p6', 'Açúcar Cristal 1kg', '7891000600106', 'ACU1', 479, 'UN', false, 80],
  ['p7', 'Sabão em Pó 1kg', '7891000700103', 'SAB1', 1390, 'UN', false, 15],
  ['p8', 'Pão Francês', null, 'PAO', 1599, 'KG', true, 10],
];

/** PGlite no formato que o handler de referência espera ({ query, transaction }). */
export function pgliteDatabase(pg) {
  const wrap = (q) => ({ query: async (sql, params = []) => (await q.query(sql, params)).rows });
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  };
}

export async function createDemoDatabase() {
  const pg = new PGlite();
  await pg.exec(await readFile(SCHEMA, 'utf8'));
  await pg.exec(`
    create table demo_products (
      id text primary key, store_id text not null, name text not null, barcode text, sku text,
      price_cents bigint not null, unit text not null, weighable boolean not null,
      stock numeric(12, 3), active boolean not null default true
    );
    create view pdv_products as
      select store_id, id, name, barcode, sku, price_cents, unit, weighable, stock, active from demo_products;
  `);
  for (const [id, name, barcode, sku, price, unit, weighable, stock] of PRODUCTS) {
    await pg.query(
      'insert into demo_products (id, store_id, name, barcode, sku, price_cents, unit, weighable, stock) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, DEMO_STORE, name, barcode, sku, price, unit, weighable, stock],
    );
  }
  return {
    pg,
    db: pgliteDatabase(pg),
    /** Baixa/devolve estoque na tabela da "aplicação". */
    async onStockChange(tx, { storeId, productId, deltaMilli }) {
      await tx.query(
        'update demo_products set stock = stock + $1 / 1000.0 where id = $2 and store_id = $3',
        [deltaMilli, productId, storeId],
      );
    },
  };
}

/** Operadores de demonstração (na vida real, quem decide é o login da sua aplicação). */
export const DEMO_USERS = {
  'token-ana': {
    operator: { id: 'u1', name: 'Ana Souza' },
    storeId: DEMO_STORE,
    store: {
      name: 'Mercadinho Demonstração',
      document: '11222333000181',
      address: 'Rua das Flores, 100',
    },
    settings: {
      paymentMethods: ['cash', 'pix', 'credit', 'debit'],
      maxDiscountPercent: 10,
      canCancelSales: true,
    },
  },
};

export function demoAuth(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return (token && DEMO_USERS[token]) || null;
}
