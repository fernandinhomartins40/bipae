-- NFS-e em que a empresa aparece (prestadora, tomadora ou intermediária), recebidas pela
-- distribuição do Ambiente de Dados Nacional, API "ADN Contribuinte" (F5-13.l). Só produção
-- restrita (regra 4 do projeto).
alter table companies add column nfse_dist_last_nsu bigint not null default 0;
-- Sem documento novo (E2220), a próxima busca espera uma hora, como na distribuição da NF-e.
alter table companies add column nfse_dist_next_query_at timestamptz;

create table nfse_received (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  access_key char(50) not null,
  nsu bigint not null,
  -- Papel da empresa na nota: quem prestou, quem tomou ou quem intermediou.
  role text not null check (role in ('prestador', 'tomador', 'intermediario')),
  number text,
  issuer_tax_id text not null,
  issuer_name text not null,
  taker_tax_id text,
  taker_name text,
  issued_at timestamptz,
  value_cents bigint not null default 0,
  net_cents bigint not null default 0,
  service_code text,
  cancelled boolean not null default false,
  nfse_xml text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, access_key)
);
create index nfse_received_list_idx on nfse_received (tenant_id, company_id, issued_at desc);

alter table nfse_received enable row level security;
alter table nfse_received force row level security;
create policy tenant_isolation on nfse_received
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on nfse_received to bipae_app;
grant select, delete on nfse_received to bipae_platform;
