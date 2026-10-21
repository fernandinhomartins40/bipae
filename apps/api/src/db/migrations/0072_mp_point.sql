-- Mercado Pago Point pela Orders API (F8-10, ADR-0018): o caixa manda o valor para a maquininha
-- pela internet. O token de acesso fica selado.
alter table payment_settings drop constraint payment_settings_card_mode_check;
alter table payment_settings add constraint payment_settings_card_mode_check
  check (card_mode in ('manual', 'mp_point', 'simulator'));
alter table payment_settings
  add column mp_terminal_id text,
  add column mp_access_token_sealed text;

create table card_charges (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  provider text not null check (provider in ('mp_point')),
  order_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('credit', 'debit')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'canceled', 'expired')),
  payment_id text,
  message text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  unique (tenant_id, provider, order_id)
);

alter table card_charges enable row level security;
alter table card_charges force row level security;
create policy tenant_isolation on card_charges
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on card_charges to bipae_app;
grant select, delete on card_charges to bipae_platform;
