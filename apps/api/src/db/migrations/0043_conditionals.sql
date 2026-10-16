-- Venda condicional (F5-12.b): a mercadoria sai para o cliente provar em casa, com prazo de
-- volta (até 60 dias, Ajuste SINIEF 02/18, cláusula quarta). Na volta, tudo entra de novo no
-- estoque e o que o cliente ficou vai ao caixa como pedido da comanda (F5-08), onde é vendido.
create table conditionals (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  number integer not null,
  customer_id uuid not null references customers (id),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  due_on date not null,
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz,
  tab_order_id uuid references tab_orders (id),
  unique (tenant_id, store_id, number)
);
create index conditionals_open_idx on conditionals (tenant_id, store_id, status, due_on);

create table conditional_items (
  tenant_id uuid not null references tenants (id),
  conditional_id uuid not null references conditionals (id),
  product_id uuid not null references products (id),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  kept_milli bigint check (kept_milli >= 0 and kept_milli <= quantity_milli),
  primary key (conditional_id, product_id)
);

alter table conditionals enable row level security;
alter table conditionals force row level security;
create policy tenant_isolation on conditionals
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on conditionals to bipae_app;
grant select, delete on conditionals to bipae_platform;

alter table conditional_items enable row level security;
alter table conditional_items force row level security;
create policy tenant_isolation on conditional_items
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on conditional_items to bipae_app;
grant select, delete on conditional_items to bipae_platform;

-- A saída para o cliente e a volta mexem no estoque com motivos próprios.
alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in', 'conditional_out', 'conditional_in'));
