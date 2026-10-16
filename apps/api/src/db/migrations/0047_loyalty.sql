-- Fidelidade (F6-08.b): o programa de pontos do cliente (uma linha por cliente do Bipaê) e o
-- extrato de pontos de cada consumidor, pelo CPF/CNPJ. O saldo é calculado do extrato, com os
-- pontos que vencem primeiro sendo usados primeiro.
create table loyalty_programs (
  tenant_id uuid primary key references tenants (id),
  active boolean not null default false,
  cents_per_point integer not null check (cents_per_point > 0),
  point_value_cents integer not null check (point_value_cents > 0),
  expiry_months integer not null check (expiry_months between 1 and 60),
  min_redeem_points integer not null check (min_redeem_points > 0),
  updated_by uuid references users (id),
  updated_at timestamptz not null default now()
);

create table loyalty_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  customer_tax_id text not null,
  kind text not null check (kind in ('earn', 'redeem', 'reverse_earn', 'reverse_redeem')),
  points integer not null check (points <> 0),
  sale_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null
);
create index loyalty_entries_customer_idx on loyalty_entries (tenant_id, customer_tax_id, created_at);
create index loyalty_entries_sale_idx on loyalty_entries (tenant_id, sale_id);

alter table loyalty_programs enable row level security;
alter table loyalty_programs force row level security;
create policy tenant_isolation on loyalty_programs
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on loyalty_programs to bipae_app;
grant select, delete on loyalty_programs to bipae_platform;

alter table loyalty_entries enable row level security;
alter table loyalty_entries force row level security;
create policy tenant_isolation on loyalty_entries
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert on loyalty_entries to bipae_app;
grant select, delete on loyalty_entries to bipae_platform;
