-- Quarentena de eventos do caixa (PIE ACH-04). Um evento que falha sempre com erro de banco (ex.:
-- número de venda repetido) travava o envio daquele caixa para sempre. Depois de algumas tentativas
-- o servidor guarda o evento inteiro aqui e segue com os próximos: a venda não se perde (regra 6),
-- o dono vê o aviso no painel e manda processar de novo depois de resolver a causa.
create table sync_quarantine (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  terminal_id uuid not null references terminals (id),
  type text not null,
  device_seq bigint not null,
  payload jsonb not null,
  -- Só código e constraint do erro, sem dados pessoais.
  error text not null,
  attempts integer not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  -- Preenchido quando passou das tentativas: daí em diante o evento não segura mais o caixa.
  quarantined_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid
);
create index sync_quarantine_open_idx on sync_quarantine (tenant_id, terminal_id)
  where resolved_at is null;

alter table sync_quarantine enable row level security;
alter table sync_quarantine force row level security;
create policy tenant_isolation on sync_quarantine
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on sync_quarantine to bipae_app;
grant select, delete on sync_quarantine to bipae_platform;
