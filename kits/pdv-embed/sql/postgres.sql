-- Bipaê PDV Embed: tabelas do caixa (PostgreSQL). Datas em texto ISO-8601 (UTC) para o mesmo
-- código funcionar em PostgreSQL, MySQL e SQLite. Dinheiro em centavos; quantidade em milésimos.

create table if not exists pdv_cash_sessions (
  id varchar(64) primary key,
  store_id varchar(64) not null,
  operator_id varchar(64) not null,
  operator_name varchar(200) not null,
  opened_at varchar(40) not null,
  opening_cents bigint not null,
  closed_at varchar(40),
  expected_json text,
  counted_json text,
  difference_cents bigint
);
create index if not exists pdv_cash_sessions_open on pdv_cash_sessions (store_id, operator_id, closed_at);

create table if not exists pdv_cash_movements (
  id varchar(64) primary key,
  store_id varchar(64) not null,
  session_id varchar(64) not null references pdv_cash_sessions (id),
  kind varchar(20) not null,
  amount_cents bigint not null,
  reason varchar(200) not null,
  created_at varchar(40) not null
);

create table if not exists pdv_sales (
  id varchar(64) primary key,
  store_id varchar(64) not null,
  session_id varchar(64) not null references pdv_cash_sessions (id),
  operator_id varchar(64) not null,
  number integer not null,
  status varchar(20) not null,
  created_at varchar(40) not null,
  cancelled_at varchar(40),
  cancel_reason varchar(200),
  subtotal_cents bigint not null,
  discount_cents bigint not null,
  total_cents bigint not null,
  customer_document varchar(20),
  unique (store_id, number)
);
create index if not exists pdv_sales_session on pdv_sales (session_id, created_at);

create table if not exists pdv_sale_items (
  sale_id varchar(64) not null references pdv_sales (id),
  line integer not null,
  product_id varchar(64) not null,
  name varchar(200) not null,
  unit varchar(10) not null,
  quantity_milli bigint not null,
  unit_price_cents bigint not null,
  discount_cents bigint not null,
  total_cents bigint not null,
  primary key (sale_id, line)
);

create table if not exists pdv_sale_payments (
  sale_id varchar(64) not null references pdv_sales (id),
  line integer not null,
  method varchar(20) not null,
  amount_cents bigint not null,
  change_cents bigint not null,
  primary key (sale_id, line)
);

-- A aplicação cria a view pdv_products sobre a SUA tabela de produtos, com estas colunas:
--   store_id, id, name, barcode, sku, price_cents, unit, weighable, stock, active
-- Exemplo (ajuste nomes de tabela e colunas):
--   create view pdv_products as
--   select p.loja_id::text as store_id, p.id::text as id, p.nome as name, p.ean as barcode,
--          p.codigo as sku, round(p.preco * 100)::bigint as price_cents, coalesce(p.unidade, 'UN') as unit,
--          p.vendido_por_peso as weighable, p.estoque as stock, p.ativo as active
--   from produtos p;
