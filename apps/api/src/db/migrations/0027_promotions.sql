-- Promoções do caixa (F5-02): leve X pague Y, faixa de quantidade e combo. A regra fica em
-- jsonb no formato do motor (@bipae/promotions) e vai ao caixa no retrato de preços.
create table promotions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  rule jsonb not null,
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index promotions_tenant_idx on promotions (tenant_id, active);

alter table promotions enable row level security;
alter table promotions force row level security;
create policy tenant_isolation on promotions
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on promotions to bipae_app;
grant select, delete on promotions to bipae_platform;
