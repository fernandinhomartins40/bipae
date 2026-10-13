-- F1-06: convite de equipe com aceite por link (uso único, com validade).
-- O link carrega um segredo; no banco fica só o hash dele (como nos tokens de sessão).

create table invites (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  role_id uuid not null references roles (id),
  store_ids uuid[],
  -- Opcional: quando informado, só esse e-mail pode aceitar.
  email text,
  token_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
create index invites_tenant on invites (tenant_id, created_at);

alter table invites enable row level security;
create policy tenant_isolation on invites
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on invites to bipae_app;

-- Quem abre o link ainda não tem sessão: esta função mostra o convite pelo hash do segredo,
-- sem expor nada além do necessário para a tela de aceite.
create function invite_lookup(p_hash text)
  returns table (
    id uuid, tenant_id uuid, tenant_name text, role_id uuid, role_name text, store_ids uuid[],
    email text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
  )
  language sql stable security definer set search_path = public
  as $$
    select i.id, i.tenant_id, t.name, i.role_id, r.name, i.store_ids,
           i.email, i.expires_at, i.accepted_at, i.revoked_at
    from invites i
    join tenants t on t.id = i.tenant_id
    join roles r on r.id = i.role_id
    where i.token_hash = p_hash
  $$;
revoke all on function invite_lookup(text) from public;
grant execute on function invite_lookup(text) to bipae_app;
