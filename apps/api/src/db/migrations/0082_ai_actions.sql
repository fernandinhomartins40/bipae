-- Ações propostas pelo assistente de IA (F6-07.f, ADR-0011). A IA só propõe: a proposta fica
-- pendente e só vira mudança no cadastro quando uma pessoa com permissão confirma. Quem pediu,
-- quem decidiu, o modelo e o antes e depois ficam aqui e na trilha de auditoria.
create table ai_actions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  kind text not null check (kind in ('price_change')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  product_id uuid not null references products (id) on delete cascade,
  summary text not null,
  payload jsonb not null,
  model text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create index ai_actions_tenant_status on ai_actions (tenant_id, status, created_at);
alter table ai_actions enable row level security;
alter table ai_actions force row level security;
create policy tenant_isolation on ai_actions
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on ai_actions to bipae_app;
grant select, delete on ai_actions to bipae_platform;
