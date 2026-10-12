-- Bipaê — initial schema (Phase 1).
-- Multi-tenant isolation with Row-Level Security (ADR-0003). The API always runs queries as
-- role bipae_app (SET LOCAL ROLE) with app.tenant_id / app.user_id set per transaction.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bipae_app') then
    create role bipae_app nologin;
  end if;
end
$$;

-- Lets the connecting (migration/API) user switch to bipae_app. No-op for superusers.
do $$
begin
  execute format('grant bipae_app to %I', current_user);
exception when others then
  null;
end
$$;

create function app_tenant() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app_user() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- identity & tenancy

create table tenants (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  name text not null,
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table roles (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  system_key text,
  name text not null,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table memberships (
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  role_id uuid not null references roles (id),
  store_ids uuid[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table sessions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  family_id uuid not null,
  token_hash text not null,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz not null default now()
);
create index sessions_family_idx on sessions (tenant_id, family_id);

-- ---------------------------------------------------------------- organization

create table companies (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  legal_name text not null,
  trade_name text,
  tax_id text,
  uf char(2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_tax_id_key on companies (tenant_id, tax_id) where tax_id is not null;

create table stores (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each terminal (web or desktop) owns an exclusive NFC-e series (ADR-0012, D-010).
-- Terminals are never deleted, so a series is never reused.
create table terminals (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  store_id uuid not null references stores (id),
  name text not null,
  platform text not null check (platform in ('web', 'desktop')),
  nfce_series integer not null check (nfce_series between 1 and 999),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (company_id, nfce_series)
);

-- ---------------------------------------------------------------- catalog

create table units (
  tenant_id uuid not null references tenants (id),
  code text not null,
  description text not null,
  decimals smallint not null default 0 check (decimals between 0 and 4),
  primary key (tenant_id, code)
);

create table fiscal_profiles (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table products (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  sku text,
  unit text not null,
  price_cents bigint not null check (price_cents >= 0),
  cost_cents bigint check (cost_cents >= 0),
  ncm char(8),
  cest char(7),
  is_weighable boolean not null default false,
  tracks_lot boolean not null default false,
  active boolean not null default true,
  fiscal_profile_id uuid references fiscal_profiles (id),
  parent_id uuid references products (id),
  attributes jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, unit) references units (tenant_id, code)
);
create unique index products_sku_key on products (tenant_id, sku) where sku is not null;
create index products_name_idx on products (tenant_id, lower(name));
create index products_updated_idx on products (tenant_id, updated_at);

create table product_barcodes (
  tenant_id uuid not null references tenants (id),
  code text not null,
  product_id uuid not null references products (id) on delete cascade,
  primary key (tenant_id, code)
);
create index product_barcodes_product_idx on product_barcodes (product_id);

create table product_components (
  tenant_id uuid not null references tenants (id),
  product_id uuid not null references products (id) on delete cascade,
  component_id uuid not null references products (id),
  quantity numeric(14, 4) not null check (quantity > 0),
  primary key (product_id, component_id)
);

create table price_tables (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table price_table_items (
  tenant_id uuid not null references tenants (id),
  price_table_id uuid not null references price_tables (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  price_cents bigint not null check (price_cents >= 0),
  primary key (price_table_id, product_id)
);

-- ---------------------------------------------------------------- parties

create table customers (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  tax_id text,
  email text,
  phone text,
  address jsonb,
  notes text,
  -- LGPD: marketing consent is separate from the CPF on the receipt (legal obligation).
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_tax_id_key on customers (tenant_id, tax_id) where tax_id is not null;
create index customers_name_idx on customers (tenant_id, lower(name));

create table suppliers (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  tax_id text,
  email text,
  phone text,
  address jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_tax_id_key on suppliers (tenant_id, tax_id) where tax_id is not null;
create index suppliers_name_idx on suppliers (tenant_id, lower(name));

-- ---------------------------------------------------------------- audit (ADR-0010)

create table audit_log (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  seq bigint not null,
  action text not null,
  entity text not null,
  entity_id text,
  actor_id uuid,
  authorized_by uuid,
  data jsonb,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null,
  unique (tenant_id, seq)
);

create function audit_log_immutable() returns trigger
  language plpgsql
  as $$ begin raise exception 'audit_log é imutável'; end $$;

create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ---------------------------------------------------------------- row-level security

do $$
declare
  t text;
begin
  -- Tables isolated strictly by tenant_id.
  foreach t in array array[
    'roles', 'sessions', 'companies', 'stores', 'terminals', 'units', 'fiscal_profiles',
    'products', 'product_barcodes', 'product_components', 'price_tables', 'price_table_items',
    'customers', 'suppliers', 'audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
  end loop;
end
$$;

-- tenants, memberships and users are read by the SECURITY DEFINER auth functions below,
-- so RLS is enabled but not forced (the owning migration role may read them; bipae_app may not).
alter table tenants enable row level security;
create policy tenant_self on tenants using (id = app_tenant()) with check (id = app_tenant());

alter table memberships enable row level security;
create policy tenant_isolation on memberships
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

alter table users enable row level security;
create policy user_visibility on users
  using (
    id = app_user()
    or exists (select 1 from memberships m where m.user_id = users.id and m.tenant_id = app_tenant())
  )
  with check (id = app_user() or app_tenant() is not null);

grant usage on schema public to bipae_app;
grant select, insert, update, delete on all tables in schema public to bipae_app;
revoke update, delete on audit_log from bipae_app;
revoke delete on terminals from bipae_app;
revoke delete on tenants from bipae_app;
grant execute on function app_tenant(), app_user() to bipae_app;

-- ---------------------------------------------------------------- auth lookups

-- Login needs to find a user by e-mail before any tenant is known. These functions expose the
-- minimum required and run with the owner's rights; bipae_app cannot read other users directly.
create function auth_find_user(p_email text)
  returns table (id uuid, name text, email text, password_hash text)
  language sql stable security definer set search_path = public
  as $$ select u.id, u.name, u.email, u.password_hash from users u where lower(u.email) = lower(p_email) $$;

create function auth_user_tenants(p_user uuid)
  returns table (tenant_id uuid, tenant_name text)
  language sql stable security definer set search_path = public
  as $$
    select t.id, t.name from memberships m join tenants t on t.id = m.tenant_id
    where m.user_id = p_user and m.active
    order by t.created_at
  $$;

revoke all on function auth_find_user(text), auth_user_tenants(uuid) from public;
grant execute on function auth_find_user(text), auth_user_tenants(uuid) to bipae_app;
