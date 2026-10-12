-- Phase 2: terminal events, sales, cash sessions and the stock ledger (ADR-0004).
-- Every event id is applied exactly once (sync_events primary key).

create table sync_events (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  terminal_id uuid not null references terminals (id),
  type text not null,
  device_seq bigint not null,
  operator_id uuid not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);
create index sync_events_terminal_idx on sync_events (tenant_id, terminal_id, device_seq);

create table cash_sessions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  terminal_id uuid not null references terminals (id),
  operator_id uuid not null,
  opened_at timestamptz not null,
  opening_cents bigint not null,
  closed_at timestamptz,
  declared jsonb,
  expected jsonb,
  difference_cents bigint
);

create table cash_movements (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  session_id uuid not null references cash_sessions (id),
  kind text not null check (kind in ('withdrawal', 'supply')),
  amount_cents bigint not null check (amount_cents > 0),
  reason text,
  operator_id uuid not null,
  authorized_by uuid,
  occurred_at timestamptz not null
);

create table sales (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  terminal_id uuid not null references terminals (id),
  store_id uuid not null references stores (id),
  terminal_seq integer not null,
  session_id uuid not null references cash_sessions (id),
  kind text not null check (kind in ('sale', 'return')),
  status text not null check (status in ('completed', 'cancelled')),
  original_sale_id uuid references sales (id),
  subtotal_cents bigint not null,
  discount_cents bigint not null,
  total_cents bigint not null,
  customer_tax_id text,
  operator_id uuid not null,
  discount_authorized_by uuid,
  occurred_at timestamptz not null,
  cancelled_at timestamptz,
  cancel_reason text,
  data jsonb not null,
  unique (terminal_id, terminal_seq)
);
create index sales_tenant_time_idx on sales (tenant_id, occurred_at desc);

create table sale_items (
  tenant_id uuid not null references tenants (id),
  sale_id uuid not null references sales (id),
  line integer not null,
  product_id uuid not null references products (id),
  name text not null,
  unit text not null,
  quantity_milli bigint not null,
  unit_price_cents bigint not null,
  gross_cents bigint not null,
  discount_cents bigint not null,
  total_cents bigint not null,
  primary key (sale_id, line)
);
create index sale_items_product_idx on sale_items (tenant_id, product_id);

create table sale_payments (
  tenant_id uuid not null references tenants (id),
  sale_id uuid not null references sales (id),
  idx integer not null,
  method text not null,
  amount_cents bigint not null,
  change_cents bigint not null default 0,
  nsu text,
  authorization_code text,
  provider text,
  primary key (sale_id, idx)
);

-- Stock is a ledger of deltas; balance = sum. Concurrent offline terminals add up correctly.
create table stock_movements (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  product_id uuid not null references products (id),
  delta_milli bigint not null,
  reason text not null check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count')),
  ref_id uuid,
  note text,
  actor_id uuid,
  occurred_at timestamptz not null
);
create index stock_movements_product_idx on stock_movements (tenant_id, product_id, store_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_events', 'cash_sessions', 'cash_movements', 'sales', 'sale_items', 'sale_payments',
    'stock_movements'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update on %I to bipae_app', t);
  end loop;
end
$$;

-- Facts are never deleted; the stock ledger and received events are append-only.
revoke update on sync_events, stock_movements, sale_items, sale_payments from bipae_app;
