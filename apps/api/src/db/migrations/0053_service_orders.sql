-- Serviços e ordem de serviço (F5-13.c). O serviço tem o código de tributação nacional da lista
-- nacional (cTribNac), o NBS e a alíquota do ISSQN no município; a OS junta o cliente, o que foi
-- trazido, os serviços e as peças. Ao entregar, as peças saem do estoque e o total vira conta a
-- receber. A empresa ganha os dados da NFS-e Nacional (F5-13.d).
create table services (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  code char(6) not null,
  nbs text,
  iss_rate text,
  price_cents bigint not null default 0 check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table services enable row level security;
alter table services force row level security;
create policy tenant_isolation on services
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on services to bipae_app;
grant select, delete on services to bipae_platform;

create table service_orders (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  number integer not null,
  customer_id uuid not null references customers (id),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'ready', 'delivered', 'cancelled')),
  equipment text,
  problem text,
  notes text,
  due_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (tenant_id, store_id, number)
);
create index service_orders_list_idx on service_orders (tenant_id, store_id, status, created_at desc);
alter table service_orders enable row level security;
alter table service_orders force row level security;
create policy tenant_isolation on service_orders
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on service_orders to bipae_app;
grant select, delete on service_orders to bipae_platform;

create table service_order_items (
  tenant_id uuid not null references tenants (id),
  order_id uuid not null references service_orders (id),
  line integer not null,
  kind text not null check (kind in ('service', 'product')),
  service_id uuid references services (id),
  product_id uuid references products (id),
  description text not null,
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  primary key (order_id, line),
  check ((kind = 'service') = (service_id is not null) and (kind = 'product') = (product_id is not null))
);
alter table service_order_items enable row level security;
alter table service_order_items force row level security;
create policy tenant_isolation on service_order_items
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on service_order_items to bipae_app;
grant select, delete on service_order_items to bipae_platform;

alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in', 'conditional_out', 'conditional_in', 'nfe_out', 'service_order'));

alter table financial_entries add column service_order_id uuid references service_orders (id);

-- NFS-e Nacional da empresa (F5-13.d): série da DPS (1 a 49999, aplicativo próprio), próximo
-- número, inscrição municipal e os percentuais aproximados dos tributos (Lei 12.741/2012).
alter table companies add column nfse_series integer not null default 1
  check (nfse_series between 1 and 49999);
alter table companies add column nfse_next_number bigint not null default 1;
alter table companies add column municipal_registration text;
alter table companies add column nfse_simples_percent text;
alter table companies add column nfse_tax_federal text;
alter table companies add column nfse_tax_state text;
alter table companies add column nfse_tax_municipal text;
