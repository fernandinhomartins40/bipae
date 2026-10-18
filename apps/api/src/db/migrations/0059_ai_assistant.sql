-- Assistente de IA (F6-07, ADR-0011). Opcional por conta (ai_settings). Cada chamada ao provedor
-- fica medida (ai_requests) para o custo caber no plano. A sugestão fiscal (ai_suggestions) só
-- vira cadastro com a aprovação de uma pessoa, registrada aqui e na auditoria.
create table ai_settings (
  tenant_id uuid primary key references tenants (id),
  enabled boolean not null default false,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
alter table ai_settings enable row level security;
alter table ai_settings force row level security;
create policy tenant_isolation on ai_settings
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on ai_settings to bipae_app;
grant select, delete on ai_settings to bipae_platform;

create table ai_requests (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  user_id uuid not null,
  kind text not null check (kind in ('fiscal', 'question')),
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index ai_requests_tenant_day on ai_requests (tenant_id, created_at);
alter table ai_requests enable row level security;
alter table ai_requests force row level security;
create policy tenant_isolation on ai_requests
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert on ai_requests to bipae_app;
grant select, delete on ai_requests to bipae_platform;

create table ai_suggestions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  product_id uuid not null references products (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  suggestion jsonb not null,
  model text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create index ai_suggestions_product on ai_suggestions (tenant_id, product_id, created_at);
alter table ai_suggestions enable row level security;
alter table ai_suggestions force row level security;
create policy tenant_isolation on ai_suggestions
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on ai_suggestions to bipae_app;
grant select, delete on ai_suggestions to bipae_platform;
