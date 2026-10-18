-- NFS-e Nacional da ordem de serviço (F5-13.d). A DPS ganha o próximo número da série da
-- empresa, vai pela fila à Sefin Nacional (produção restrita) e a NFS-e gerada fica guardada.
create table nfse_documents (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  service_order_id uuid not null references service_orders (id),
  series integer not null,
  number bigint not null,
  dps_id char(45) not null,
  status text not null default 'pending'
    check (status in ('pending', 'error', 'not_configured', 'authorized', 'rejected')),
  pending_items jsonb not null default '[]',
  errors jsonb not null default '[]',
  signed_dps text,
  access_key char(50),
  nfse_xml text,
  attempts integer not null default 0,
  last_error text,
  issued_at timestamptz not null default now(),
  authorized_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, service_order_id),
  unique (tenant_id, dps_id)
);
alter table nfse_documents enable row level security;
alter table nfse_documents force row level security;
create policy tenant_isolation on nfse_documents
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on nfse_documents to bipae_app;
grant select, delete on nfse_documents to bipae_platform;
