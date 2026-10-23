-- CIAP, controle do crédito de ICMS do ativo permanente (F4-14.b.7, bloco G da EFD ICMS/IPI).
-- Cada item de compra com finalidade "ativo imobilizado" vira um bem, com o ICMS que dá crédito
-- em 48 parcelas (LC 87/1996, art. 20, § 5º). A parcela do mês sai da data de entrada; a coluna
-- appropriated_installments guarda até qual parcela já foi para um arquivo baixado.
create table ciap_assets (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  purchase_invoice_id uuid not null references purchase_invoices (id),
  item_line integer not null,
  -- COD_IND_BEM (0300): chave da nota e número do item, único e nunca reaproveitado.
  code text not null,
  description text not null,
  entered_on date not null,
  icms_own_cents bigint not null default 0 check (icms_own_cents >= 0),
  icms_st_cents bigint not null default 0 check (icms_st_cents >= 0),
  icms_freight_cents bigint not null default 0 check (icms_freight_cents >= 0),
  icms_difal_cents bigint not null default 0 check (icms_difal_cents >= 0),
  installments smallint not null default 48 check (installments between 1 and 999),
  appropriated_installments smallint not null default 0 check (appropriated_installments >= 0),
  -- 0305: centro de custo ("1" área operacional, "2" área administrativa) e função do bem.
  cost_center text not null default '1' check (cost_center in ('1', '2')),
  usage text,
  -- Saída do bem antes do fim das parcelas (G125: PE perecimento, OT outras).
  written_off_on date,
  write_off_type text check (write_off_type in ('PE', 'OT')),
  created_at timestamptz not null default now(),
  unique (purchase_invoice_id, item_line),
  unique (company_id, code)
);
create index ciap_assets_company on ciap_assets (company_id, entered_on);

alter table ciap_assets enable row level security;
alter table ciap_assets force row level security;
create policy tenant_isolation on ciap_assets
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on ciap_assets to bipae_app;
grant select, delete on ciap_assets to bipae_platform;

-- Configuração do CIAP no arquivo (dúvida D-041): conta contábil do ativo (0300 e 0500), código
-- do ajuste do E111 (tabela 5.1.1 da UF) e se as saídas com CST 60 contam como tributadas.
alter table efd_settings
  add column ciap_account_code text,
  add column ciap_account_name text,
  add column ciap_account_level smallint check (ciap_account_level between 1 and 99999),
  add column ciap_adjustment_code char(8),
  add column ciap_st_outputs_taxed boolean;
