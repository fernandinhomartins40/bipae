-- F3-06.e: regras de ICMS próprias da empresa (alíquota do produto, redução de base, FCP, ST),
-- por prefixo de NCM e com vigência. Cadastradas pela empresa, normalmente com o contador.
create table company_icms_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  name text not null,
  ncm text[] not null,
  valid_from date not null,
  -- Primeiro dia em que a regra não vale mais; nulo = sem data para acabar.
  valid_to date,
  effect jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index company_icms_rules_company on company_icms_rules (tenant_id, company_id);

alter table company_icms_rules enable row level security;
create policy tenant_isolation on company_icms_rules
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on company_icms_rules to bipae_app;
