-- Pedidos de compra (F4-01): rascunho → enviado ao fornecedor → recebido, ou cancelado.
-- Valores em centavos e quantidades em milésimos, como no resto do Bipaê.
create table purchase_orders (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  supplier_id uuid not null references suppliers (id),
  number integer not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  expected_at date,
  notes text,
  total_cents bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  unique (tenant_id, number)
);
create index purchase_orders_status_idx on purchase_orders (tenant_id, status, created_at desc);

create table purchase_order_items (
  tenant_id uuid not null references tenants (id),
  order_id uuid not null references purchase_orders (id) on delete cascade,
  line integer not null,
  product_id uuid not null references products (id),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  primary key (order_id, line)
);

do $$
declare
  t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update, delete on %I to bipae_app', t);
    execute format('grant select, delete on %I to bipae_platform', t);
  end loop;
end $$;
