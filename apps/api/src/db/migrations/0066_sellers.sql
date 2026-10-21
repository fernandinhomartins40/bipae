-- Vendedores (F8-01): o caixa escolhe quem vendeu pelo nome ou pelo código. Com usuário ligado,
-- o vendedor também usa o app de vendas (ADR-0017). A comissão (F8-02) parte daqui.
create table sellers (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  code text not null check (code ~ '^[0-9]{1,6}$'),
  user_id uuid references users (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create unique index sellers_user_idx on sellers (tenant_id, user_id) where user_id is not null;

alter table sellers enable row level security;
alter table sellers force row level security;
create policy tenant_isolation on sellers
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on sellers to bipae_app;
grant select, delete on sellers to bipae_platform;

-- Quem vendeu: na venda inteira e em cada item (um item pode ter outro vendedor).
alter table sales add column seller_id uuid;
alter table sale_items add column seller_id uuid;
create index sale_items_seller_idx on sale_items (tenant_id, seller_id) where seller_id is not null;
