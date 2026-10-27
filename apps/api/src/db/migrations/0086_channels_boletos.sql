-- Pedidos de canais externos (iFood, marketplaces; F6-05 e F6-06) e boletos via PSP (F4-15).
-- Credenciais e segredos ficam selados (*_sealed, fora da exportação). Todo pedido, evento e
-- ação entra uma vez só: as chaves únicas abaixo garantem a idempotência.
create table channel_integrations (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  provider text not null check (provider in ('ifood', 'generic', 'simulator')),
  name text not null,
  store_id uuid not null references stores (id),
  merchant_id text,
  credentials_sealed text,
  inbound_secret_sealed text,
  inbound_key text,
  auto_accept boolean not null default false,
  settlement_days integer not null default 30 check (settlement_days between 0 and 120),
  commission_bps integer not null default 0 check (commission_bps between 0 and 5000),
  active boolean not null default true,
  last_poll_at timestamptz,
  last_error text,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index channel_integrations_tenant_idx on channel_integrations (tenant_id, active);
create unique index channel_integrations_inbound_idx
  on channel_integrations (inbound_key) where inbound_key is not null;

create table channel_orders (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  integration_id uuid not null references channel_integrations (id),
  external_id text not null,
  display_id text not null,
  status text not null check (status in
    ('received', 'needs_mapping', 'accepted', 'preparing', 'ready', 'dispatched', 'concluded',
     'cancelled', 'rejected')),
  type text not null default 'delivery' check (type in ('delivery', 'takeout')),
  customer_name text not null,
  customer_phone text,
  address text,
  items jsonb not null,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  prepaid boolean not null default false,
  payment_method text not null,
  notes text,
  tab_order_id uuid references tab_orders (id),
  financial_entry_id uuid references financial_entries (id),
  cancel_reason text,
  placed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index channel_orders_external_idx
  on channel_orders (tenant_id, integration_id, external_id);
create index channel_orders_queue_idx on channel_orders (tenant_id, status, placed_at desc);

create table channel_events (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  integration_id uuid not null references channel_integrations (id),
  external_event_id text not null,
  code text not null,
  order_external_id text,
  created_at timestamptz not null default now()
);
create unique index channel_events_external_idx
  on channel_events (tenant_id, integration_id, external_event_id);

create table channel_actions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  integration_id uuid not null references channel_integrations (id),
  order_id uuid not null references channel_orders (id),
  action text not null check (action in
    ('accept', 'start_preparation', 'ready', 'dispatch', 'reject')),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
-- Cada ação sai uma vez por pedido.
create unique index channel_actions_once_idx on channel_actions (order_id, action);
create index channel_actions_due_idx on channel_actions (status, next_attempt_at);

create table channel_product_links (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  integration_id uuid not null references channel_integrations (id),
  sku text not null,
  product_id uuid not null references products (id),
  created_at timestamptz not null default now()
);
create unique index channel_product_links_sku_idx
  on channel_product_links (tenant_id, integration_id, sku);

create table boleto_charges (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  provider text not null check (provider in ('asaas', 'simulator')),
  status text not null default 'pending'
    check (status in ('pending', 'registered', 'paid', 'overdue', 'canceled', 'failed')),
  external_id text,
  payer_name text not null,
  payer_tax_id text not null,
  amount_cents bigint not null check (amount_cents >= 500),
  paid_cents bigint,
  due_date text not null,
  description text not null,
  digitable_line text,
  barcode text,
  pdf_url text,
  financial_entry_id uuid references financial_entries (id),
  failure text,
  paid_at timestamptz,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index boleto_charges_external_idx
  on boleto_charges (provider, external_id) where external_id is not null;
create index boleto_charges_tenant_idx on boleto_charges (tenant_id, status, due_date);
-- Um boleto vivo por conta a receber.
create unique index boleto_charges_entry_idx
  on boleto_charges (financial_entry_id)
  where financial_entry_id is not null and status in ('pending', 'registered', 'overdue', 'paid');

do $$
declare t text;
begin
  foreach t in array array['channel_integrations', 'channel_orders', 'channel_events',
    'channel_actions', 'channel_product_links', 'boleto_charges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t);
    execute format('grant select, insert, update on %I to bipae_app', t);
    execute format('grant select, delete on %I to bipae_platform', t);
  end loop;
end $$;
-- O aviso do banco acha o boleto pelo identificador do parceiro, sem saber o tenant (F4-15).
-- Quem faz isso é o papel da plataforma, só dentro de modules/payments.
