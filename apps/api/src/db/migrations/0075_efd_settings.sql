-- Configuração do arquivo da EFD ICMS/IPI por empresa (F4-14.b.3): perfil do estabelecimento,
-- contabilista (registro 0100) e vencimento e código de receita do ICMS (registro E116).
create table efd_settings (
  company_id uuid primary key references companies (id),
  tenant_id uuid not null references tenants (id),
  profile char(1) not null default 'A' check (profile in ('A', 'B', 'C')),
  accountant_name text,
  accountant_cpf text,
  accountant_crc text,
  accountant_cnpj text,
  accountant_email text,
  accountant_phone text,
  accountant_city_code char(7),
  icms_due_day smallint check (icms_due_day between 1 and 31),
  icms_revenue_code text,
  updated_at timestamptz not null default now()
);

alter table efd_settings enable row level security;
alter table efd_settings force row level security;
create policy tenant_isolation on efd_settings
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on efd_settings to bipae_app;
grant select, delete on efd_settings to bipae_platform;
