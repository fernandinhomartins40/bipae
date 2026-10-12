-- SaaS platform: plans, tenant lifecycle, Bipaê staff (super admin), platform audit,
-- announcements. See docs/saas/plano.md and ADR-0013.
--
-- Tenant data stays protected by RLS. The admin panel uses role bipae_platform (BYPASSRLS),
-- switched to only inside admin transactions; tenant routes never use it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'bipae_platform') then
    create role bipae_platform nologin bypassrls;
  end if;
end
$$;

do $$
begin
  execute format('grant bipae_platform to %I', current_user);
exception when others then
  null;
end
$$;

-- ---------------------------------------------------------------- plans

create table plans (
  id text primary key,
  name text not null,
  description text,
  price_cents bigint, -- null = free or "price on launch"
  limits jsonb not null, -- {"companies":1,"stores":1,"terminals":1,"users":2,"products":500}; null value = unlimited
  features text[] not null default '{}',
  public boolean not null default true,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into plans (id, name, description, price_cents, limits, features, sort) values
  ('gratis', 'Grátis', 'Para o MEI e quem está começando.', 0,
   '{"companies":1,"stores":1,"terminals":2,"users":3,"products":2000}', '{pos,offline}', 1),
  ('essencial', 'Essencial', 'Para o pequeno comércio com mais de um caixa.', null,
   '{"companies":1,"stores":1,"terminals":3,"users":5,"products":5000}', '{pos,offline,reports}', 2),
  ('profissional', 'Profissional', 'Para lojas com várias unidades.', null,
   '{"companies":3,"stores":10,"terminals":20,"users":30,"products":null}', '{pos,offline,reports,multistore}', 3),
  ('rede', 'Rede', 'Para redes e franquias.', null,
   '{"companies":null,"stores":null,"terminals":null,"users":null,"products":null}', '{pos,offline,reports,multistore,network}', 4);

-- ---------------------------------------------------------------- tenant lifecycle

alter table tenants
  add column status text not null default 'active'
    check (status in ('active', 'trial', 'suspended', 'cancelled')),
  add column plan_id text not null default 'gratis' references plans (id),
  add column trial_ends_at timestamptz,
  add column status_reason text,
  add column status_changed_at timestamptz,
  add column limit_overrides jsonb, -- per-tenant exceptions negotiated by sales
  add column notes text;

create table tenant_events (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  kind text not null check (kind in (
    'created', 'plan_changed', 'trial_set', 'suspended', 'reactivated', 'cancelled',
    'limits_changed', 'note', 'support_session'
  )),
  data jsonb,
  admin_id uuid,
  created_at timestamptz not null default now()
);
create index tenant_events_tenant_idx on tenant_events (tenant_id, created_at desc);

alter table tenant_events enable row level security;
alter table tenant_events force row level security;
create policy tenant_isolation on tenant_events using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- ---------------------------------------------------------------- Bipaê staff

create table platform_admins (
  user_id uuid primary key references users (id),
  role text not null check (role in ('owner', 'support', 'viewer')),
  active boolean not null default true,
  totp_secret text, -- AES-GCM ciphertext (see common/secrets.ts)
  totp_enabled boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin_sessions (
  id uuid primary key,
  user_id uuid not null references users (id),
  token_hash text not null,
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table platform_audit_log (
  id uuid primary key,
  seq bigint not null unique,
  actor_id uuid,
  action text not null,
  tenant_id uuid,
  target text,
  data jsonb,
  ip text,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null
);

create trigger platform_audit_log_no_update before update or delete on platform_audit_log
  for each row execute function audit_log_immutable();

-- ---------------------------------------------------------------- announcements

create table announcements (
  id uuid primary key,
  title text not null,
  body text not null,
  level text not null default 'info' check (level in ('info', 'warning', 'critical')),
  plan_ids text[], -- null = every client
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- grants

-- Platform-only tables: no access for tenant code (bipae_app).
revoke all on plans, platform_admins, admin_sessions, platform_audit_log, announcements from bipae_app;
-- Tenants may read the plan catalog and active announcements through these views only.
grant select on plans to bipae_app;

create function active_announcements(p_plan text)
  returns table (id uuid, title text, body text, level text)
  language sql stable security definer set search_path = public
  as $$
    select a.id, a.title, a.body, a.level from announcements a
    where a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      and (a.plan_ids is null or p_plan = any (a.plan_ids))
    order by case a.level when 'critical' then 0 when 'warning' then 1 else 2 end, a.starts_at desc
  $$;
grant execute on function active_announcements(text) to bipae_app;

grant usage on schema public to bipae_platform;
grant select, insert, update, delete on all tables in schema public to bipae_platform;
revoke update, delete on audit_log, platform_audit_log from bipae_platform;
grant execute on all functions in schema public to bipae_platform;

-- tenant_events is written by the platform and read by the tenant's own account page.
grant select on tenant_events to bipae_app;

-- A tenant can never change its own status, plan or limits: only the platform does.
revoke update on tenants from bipae_app;
-- Signup records the 'created' event for its own tenant (RLS limits it to its own rows).
grant insert on tenant_events to bipae_app;
