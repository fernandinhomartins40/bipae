-- Comissão por vendedor (F8-02). Cada vendedor tem um %; produto ou categoria podem ter um %
-- próprio, que vale no lugar do dele. Mudar um % é uma linha nova com a data em que passa a
-- valer: o histórico fica, e cada venda usa o % do dia em que foi feita.
alter table products add column category text;
create index products_category_idx on products (tenant_id, lower(category)) where category is not null;

create table commission_rates (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  seller_id uuid references sellers (id),
  product_id uuid references products (id),
  category text,
  -- Centésimos de ponto (250 = 2,5%). Nulo só em exceção encerrada: volta a valer o do vendedor.
  rate_bp integer check (rate_bp between 0 and 10000),
  starts_on date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (num_nonnulls(seller_id, product_id, category) = 1),
  check (rate_bp is not null or seller_id is null)
);
create index commission_rates_lookup_idx on commission_rates (tenant_id, starts_on);

alter table commission_rates enable row level security;
alter table commission_rates force row level security;
create policy tenant_isolation on commission_rates
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert on commission_rates to bipae_app;
grant select, delete on commission_rates to bipae_platform;
