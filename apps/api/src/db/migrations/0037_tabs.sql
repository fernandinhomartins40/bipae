-- Comandas (F5-07): a cópia no servidor do que o caixa lança, para o garçom (F5-08) e a cozinha
-- (F5-09) enxergarem. A comanda nasce e muda no caixa, sem internet; o servidor só guarda.
create table tabs (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  terminal_id uuid not null references terminals (id),
  label text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  items jsonb not null default '[]',
  total_cents bigint not null default 0,
  sale_id uuid,
  cancel_reason text,
  opened_at timestamptz not null,
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index tabs_open_idx on tabs (tenant_id, store_id, status);

alter table tabs enable row level security;
alter table tabs force row level security;
create policy tenant_isolation on tabs
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on tabs to bipae_app;
grant select, delete on tabs to bipae_platform;
