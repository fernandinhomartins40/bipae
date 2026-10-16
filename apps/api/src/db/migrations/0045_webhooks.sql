-- Webhooks da API pública (F6-01.c, ADR-0016). O segredo da assinatura fica selado
-- (secret_sealed, AES-256-GCM), porque a assinatura precisa do valor. Cada entrega nasce na
-- mesma transação do fato (outbox) e é enviada pela fila, com novas tentativas.
create table webhook_endpoints (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  url text not null,
  events text[] not null,
  secret_sealed text not null,
  active boolean not null default true,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhook_endpoints_tenant_idx on webhook_endpoints (tenant_id, active);

create table webhook_deliveries (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  endpoint_id uuid not null references webhook_endpoints (id),
  event text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index webhook_deliveries_due_idx on webhook_deliveries (status, next_attempt_at);
create index webhook_deliveries_endpoint_idx on webhook_deliveries (tenant_id, endpoint_id, created_at);

alter table webhook_endpoints enable row level security;
alter table webhook_endpoints force row level security;
create policy tenant_isolation on webhook_endpoints
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on webhook_endpoints to bipae_app;
grant select, delete on webhook_endpoints to bipae_platform;

alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;
create policy tenant_isolation on webhook_deliveries
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on webhook_deliveries to bipae_app;
grant select, delete on webhook_deliveries to bipae_platform;
