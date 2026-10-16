-- Tela da cozinha (F5-09): o produto marcado "preparado na cozinha" vira pedido da cozinha quando
-- é lançado numa comanda. Só o que é novo (ou a quantidade a mais) de cada rodada.
alter table products add column kitchen boolean not null default false;

create table kitchen_tickets (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  tab_id uuid not null references tabs (id),
  tab_label text not null,
  line integer not null,
  product_id uuid not null,
  name text not null,
  quantity_milli bigint not null check (quantity_milli > 0),
  -- pending: na fila; ready: pronto para levar; delivered: entregue; cancelled: saiu da comanda.
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'delivered', 'cancelled')),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  delivered_at timestamptz
);
create index kitchen_tickets_queue_idx on kitchen_tickets (tenant_id, store_id, status, created_at);

alter table kitchen_tickets enable row level security;
alter table kitchen_tickets force row level security;
create policy tenant_isolation on kitchen_tickets
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on kitchen_tickets to bipae_app;
grant select, delete on kitchen_tickets to bipae_platform;
