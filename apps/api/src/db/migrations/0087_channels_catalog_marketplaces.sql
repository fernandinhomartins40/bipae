-- Cardápio e estoque nos canais (F6-05.b, F6-06.b) e marketplaces por porta (F6-06.b).
-- O estado do que já foi enviado a cada canal garante o envio idempotente: só vai o que mudou.
alter table channel_integrations drop constraint if exists channel_integrations_provider_check;
alter table channel_integrations add constraint channel_integrations_provider_check
  check (provider in ('ifood', 'generic', 'simulator', 'mercadolivre', 'shopee', 'amazon'));
-- Endereço onde o Bipaê empurra cardápio e estoque (conector genérico) ou base da API do
-- marketplace (configurável: nenhum endereço é suposto no código).
alter table channel_integrations add column outbound_url text;
-- Mapeamento de campos e opções do marketplace (sem segredos; segredos ficam em credentials_sealed).
alter table channel_integrations add column settings jsonb not null default '{}'::jsonb;
alter table channel_integrations add column last_catalog_sync_at timestamptz;

create table channel_catalog_state (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  integration_id uuid not null references channel_integrations (id),
  sku text not null,
  -- Resumo do que foi enviado (preço, disponibilidade e estoque): igual = nada a enviar.
  content_hash text not null,
  pushed_at timestamptz not null default now()
);
create unique index channel_catalog_state_sku_idx
  on channel_catalog_state (tenant_id, integration_id, sku);

alter table channel_catalog_state enable row level security;
alter table channel_catalog_state force row level security;
create policy tenant_isolation on channel_catalog_state
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on channel_catalog_state to bipae_app;
grant select, delete on channel_catalog_state to bipae_platform;
