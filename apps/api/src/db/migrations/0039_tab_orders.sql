-- Pedidos do garçom (F5-08): o celular manda o pedido da mesa ao servidor; um caixa da loja o
-- pega na sincronização, junta à comanda (a comanda vive no caixa, sem internet) e avisa que
-- recebeu. Se o caixa que pegou sumir, outro pega depois de 2 minutos.
create table tab_orders (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  label text not null,
  items jsonb not null,
  waiter_id uuid not null,
  waiter_name text not null,
  status text not null default 'pending' check (status in ('pending', 'received', 'rejected')),
  claimed_by uuid references terminals (id),
  claimed_at timestamptz,
  tab_id uuid,
  reason text,
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create index tab_orders_queue_idx on tab_orders (tenant_id, store_id, status, created_at);

alter table tab_orders enable row level security;
alter table tab_orders force row level security;
create policy tenant_isolation on tab_orders
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on tab_orders to bipae_app;
grant select, delete on tab_orders to bipae_platform;
