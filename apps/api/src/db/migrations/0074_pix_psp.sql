-- Pix com QR dinâmico pelas APIs próprias de Mercado Pago, PagBank e Asaas (F8-09.c, ADR-0018).
-- O token da conta fica selado (*_sealed, fora da exportação); a confirmação é por consulta.
alter table payment_settings drop constraint payment_settings_pix_mode_check;
alter table payment_settings add constraint payment_settings_pix_mode_check
  check (pix_mode in ('manual', 'static_qr', 'api', 'psp', 'simulator'));
alter table payment_settings
  add column pix_psp_provider text check (pix_psp_provider in ('mercadopago', 'pagbank', 'asaas')),
  add column pix_psp_sandbox boolean not null default false,
  add column pix_psp_token_sealed text,
  -- O "consumidor final" que o parceiro exige em cada cobrança.
  add column pix_psp_payer_name text,
  add column pix_psp_payer_email text,
  add column pix_psp_payer_tax_id text,
  add column pix_psp_customer_id text;

-- As cobranças dos parceiros usam a mesma tabela: o txid é nosso (vai na URL do caixa) e o
-- external_id é o da cobrança no parceiro.
alter table pix_charges
  add column provider text not null default 'pix_api'
    check (provider in ('pix_api', 'mercadopago', 'pagbank', 'asaas')),
  add column external_id text,
  add column expires_at timestamptz;
alter table pix_charges drop constraint pix_charges_status_check;
alter table pix_charges add constraint pix_charges_status_check
  check (status in ('pending', 'paid', 'expired', 'failed', 'canceled'));
create unique index pix_charges_external_idx
  on pix_charges (tenant_id, provider, external_id) where external_id is not null;
