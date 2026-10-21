-- Pix com confirmação automática pela API Pix do banco (F8-09, ADR-0018). Segredos selados
-- (*_sealed, fora da exportação de dados); a tela só sabe se estão guardados.
alter table payment_settings drop constraint payment_settings_pix_mode_check;
alter table payment_settings add constraint payment_settings_pix_mode_check
  check (pix_mode in ('manual', 'static_qr', 'api', 'simulator'));
alter table payment_settings
  add column pix_api_base_url text,
  add column pix_api_token_url text,
  add column pix_api_client_id text,
  add column pix_api_secret_sealed text,
  add column pix_api_cert_sealed text,
  add column pix_api_cert_password_sealed text;

-- Cobranças imediatas: o caixa acompanha até o banco confirmar.
create table pix_charges (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  txid text not null check (txid ~ '^[A-Za-z0-9]{26,35}$'),
  amount_cents bigint not null check (amount_cents > 0),
  copy_paste text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  end_to_end_id text,
  message text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  paid_at timestamptz,
  unique (tenant_id, txid)
);

alter table pix_charges enable row level security;
alter table pix_charges force row level security;
create policy tenant_isolation on pix_charges
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on pix_charges to bipae_app;
grant select, delete on pix_charges to bipae_platform;
