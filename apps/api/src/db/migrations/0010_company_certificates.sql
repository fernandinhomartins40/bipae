-- F3-10: certificado digital A1 da empresa, para assinar as notas. O arquivo .pfx e a senha
-- ficam cifrados (AES-256-GCM, chave SECRETS_KEY); nunca em texto puro no banco nem em log.
-- Um certificado ativo por empresa: enviar outro substitui o anterior.
create table company_certificates (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  sealed_pfx text not null,
  sealed_password text not null,
  subject text not null,
  cnpj text not null,
  serial text not null,
  fingerprint text not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id)
);

alter table company_certificates enable row level security;
create policy tenant_isolation on company_certificates
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on company_certificates to bipae_app;
