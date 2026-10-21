-- Meios de pagamento por loja (F8-08, ADR-0018). Sem linha, a loja usa maquininha à parte e Pix
-- manual. A chave Pix não é segredo (vai no QR de quem paga); credenciais de parceiros (F8-09
-- em diante) vão seladas em colunas *_sealed.
create table payment_settings (
  store_id uuid primary key references stores (id),
  tenant_id uuid not null references tenants (id),
  card_mode text not null default 'manual' check (card_mode in ('manual', 'simulator')),
  pix_mode text not null default 'manual' check (pix_mode in ('manual', 'static_qr', 'simulator')),
  pix_key text,
  pix_merchant_name text,
  pix_city text,
  updated_at timestamptz not null default now()
);

alter table payment_settings enable row level security;
alter table payment_settings force row level security;
create policy tenant_isolation on payment_settings
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on payment_settings to bipae_app;
grant select, delete on payment_settings to bipae_platform;
