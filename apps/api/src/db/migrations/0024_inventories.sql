-- Inventário pelo celular (F4-11): uma contagem aberta por loja, com várias pessoas bipando ao
-- mesmo tempo. Ao fechar, cada produto contado vira um ajuste de estoque ("count").
create table inventories (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  name text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_by uuid,
  closed_at timestamptz
);
create unique index inventories_open_idx on inventories (tenant_id, store_id) where status = 'open';

create table inventory_counts (
  tenant_id uuid not null references tenants (id),
  inventory_id uuid not null references inventories (id),
  product_id uuid not null references products (id),
  counted_milli bigint not null check (counted_milli >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (inventory_id, product_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['inventories', 'inventory_counts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update on %I to bipae_app', t);
    execute format('grant select, delete on %I to bipae_platform', t);
  end loop;
end $$;
