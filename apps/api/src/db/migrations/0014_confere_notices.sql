-- Aviso de nota chegando no Confere (MF-14): o MercadoFlow manda confere.document.received e o
-- Bipaê guarda para mostrar a notificação e o contador no menu Notas de entrada. Um aviso por
-- documento (o MercadoFlow pode repetir o aviso).
create table confere_notices (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  document_id text not null,
  access_key char(44),
  supplier_name text,
  invoice_number text,
  issued_at timestamptz,
  total_cents bigint,
  items_count integer,
  received_at timestamptz not null default now(),
  -- Quando alguém abriu a tela de Notas de entrada da loja depois do aviso.
  seen_at timestamptz,
  unique (tenant_id, document_id)
);
create index confere_notices_unseen_idx on confere_notices (tenant_id, store_id) where seen_at is null;

alter table confere_notices enable row level security;
alter table confere_notices force row level security;
create policy tenant_isolation on confere_notices
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on confere_notices to bipae_app;
grant select, insert, update on confere_notices to bipae_platform;
