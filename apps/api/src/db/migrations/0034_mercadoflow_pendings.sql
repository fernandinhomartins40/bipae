-- Pendências vindas do MercadoFlow (MF-11): preço aprovado e encarte viram sugestões que o
-- gerente aplica com um clique, ou que o Bipaê aplica sozinho se a loja ligar a opção. Nada é
-- cadastrado sem alguém ver (seção 1 do contrato), a não ser com a opção automática ligada.
create table mercadoflow_pendings (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  market_id text not null,
  kind text not null check (kind in ('price', 'promotion')),
  -- Preço: o código de barras; encarte: o id do encarte no MercadoFlow.
  source_key text not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  data jsonb not null,
  -- Por que não deu para aplicar (produto não cadastrado, por exemplo).
  problem text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id, kind, source_key)
);
create index mercadoflow_pendings_status_idx on mercadoflow_pendings (tenant_id, status, kind);

alter table mercadoflow_pendings enable row level security;
alter table mercadoflow_pendings force row level security;
create policy tenant_isolation on mercadoflow_pendings
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on mercadoflow_pendings to bipae_app;
grant select, insert, update, delete on mercadoflow_pendings to bipae_platform;

alter table mercadoflow_links add column auto_apply_prices boolean not null default false;
alter table mercadoflow_links add column auto_apply_promotions boolean not null default false;
