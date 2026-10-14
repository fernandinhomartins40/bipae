-- Integração com o MercadoFlow (MF-01 e MF-02). Sem banco compartilhado: tudo vai pela API HTTP
-- deles; aqui ficam o vínculo de cada loja, a fila de envio (outbox), os avisos recebidos
-- (webhooks) e o cache do catálogo.

-- Vínculo de uma loja do Bipaê com um mercado do MercadoFlow.
create table mercadoflow_links (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  store_id uuid not null references stores (id),
  market_id text,
  status text not null check (status in ('PENDENTE', 'ATIVA', 'REVOGADA', 'RECUSADA', 'EXPIRADA')),
  connect_code text,
  connect_url text,
  scopes text[] not null default '{}',
  created_via text not null check (created_via in ('ACCOUNT', 'CONNECT')),
  customer_active_sent boolean,
  connected_at timestamptz,
  revoked_at timestamptz,
  last_sales_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);
create index mercadoflow_links_market_idx on mercadoflow_links (market_id);

-- Tudo o que o Bipaê envia ao MercadoFlow passa por aqui: o caixa nunca espera a resposta.
create table mercadoflow_outbox (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid references stores (id),
  kind text not null,
  -- Evita enfileirar duas vezes a mesma coisa (a chave da NFC-e, o GTIN do produto).
  dedupe_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'rejected')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, kind, dedupe_key)
);
create index mercadoflow_outbox_pending_idx on mercadoflow_outbox (kind, next_attempt_at)
  where status = 'pending';

-- Código de caixa ou fardo de um produto, com quantas unidades leva (embalagem de compra).
create table product_packs (
  tenant_id uuid not null references tenants (id),
  pack_gtin text not null,
  product_id uuid not null references products (id),
  units_per_pack integer not null check (units_per_pack > 0),
  primary key (tenant_id, pack_gtin)
);

-- Dados de catálogo do produto: marca, fabricante, departamento, categoria e conteúdo.
alter table products add column catalog jsonb;

do $$
declare
  t text;
begin
  foreach t in array array['mercadoflow_links', 'mercadoflow_outbox', 'product_packs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update, delete on %I to bipae_app', t);
    execute format('grant select, insert, update, delete on %I to bipae_platform', t);
  end loop;
end $$;

-- Avisos recebidos do MercadoFlow. Chegam só com o id do mercado, sem cliente logado, por isso
-- só o papel da plataforma acessa. O id da entrega evita processar o mesmo aviso duas vezes.
create table mercadoflow_webhook_deliveries (
  delivery_id text primary key,
  event text not null,
  market_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
grant select, insert, update on mercadoflow_webhook_deliveries to bipae_platform;

-- Cache do catálogo do MercadoFlow: dado público de produto, igual para todas as lojas, sem
-- nenhuma informação de cliente. Por isso não tem tenant_id.
create table mercadoflow_catalog_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);
grant select, insert, update, delete on mercadoflow_catalog_cache to bipae_app;
grant select, insert, update, delete on mercadoflow_catalog_cache to bipae_platform;
