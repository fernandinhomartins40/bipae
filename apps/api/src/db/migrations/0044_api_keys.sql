-- API pública (F6-01.a, ADR-0016): chave por cliente, criada pelo dono. O banco guarda só o
-- SHA-256 da chave (key_hash) e um prefixo para mostrar na tela; a chave aparece uma vez.
create table api_keys (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users (id)
);
create index api_keys_tenant_idx on api_keys (tenant_id, created_at);

alter table api_keys enable row level security;
alter table api_keys force row level security;
create policy tenant_isolation on api_keys
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on api_keys to bipae_app;
grant select, delete on api_keys to bipae_platform;

-- Permissão nova: o dono dos clientes que já existem passa a tê-la, como os papéis novos.
set local role bipae_platform;
update roles set permissions = array_append(permissions, 'admin.integrations')
  where system_key = 'owner' and not ('admin.integrations' = any (permissions));
reset role;
