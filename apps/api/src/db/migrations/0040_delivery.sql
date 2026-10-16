-- Delivery com taxa por bairro (F5-10). Os bairros e as taxas são de cada loja e vão ao caixa no
-- retrato de preços; a venda para entrega guarda o endereço e a situação da entrega.
create table delivery_zones (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  name text not null,
  fee_cents bigint not null check (fee_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index delivery_zones_name_idx on delivery_zones (tenant_id, store_id, lower(name));

alter table delivery_zones enable row level security;
alter table delivery_zones force row level security;
create policy tenant_isolation on delivery_zones
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on delivery_zones to bipae_app;
grant select, delete on delivery_zones to bipae_platform;

-- Endereço, bairro, taxa e telefone da venda para entrega; a situação anda de "a sair" até
-- "entregue".
alter table sales add column delivery jsonb;
alter table sales add column delivery_status text
  check (delivery_status in ('pending', 'out', 'delivered'));
alter table sales add column delivery_updated_at timestamptz;
