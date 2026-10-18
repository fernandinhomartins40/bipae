-- Notas emitidas contra o CNPJ da empresa, recebidas pela distribuição de DF-e do Ambiente
-- Nacional (F3-20), e a manifestação do destinatário. Sempre homologação (regra 4 do projeto).
alter table companies add column dfe_last_nsu char(15) not null default '000000000000000';
-- O Ambiente Nacional pede uma hora de espera quando não há documento novo (137) ou quando a
-- consulta é repetida demais (656).
alter table companies add column dfe_next_query_at timestamptz;

create table dfe_documents (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  access_key char(44) not null,
  nsu char(15) not null,
  issuer_tax_id text not null,
  issuer_name text not null,
  issued_at timestamptz,
  total_cents bigint not null default 0,
  -- autorizada, denegada ou cancelada, como o resumo do Ambiente Nacional informa.
  situation text,
  summary_xml text,
  -- A nota completa (procNFe) chega depois da ciência da operação.
  proc_xml text,
  manifestation text check (manifestation in ('ciencia', 'confirmacao', 'desconhecimento', 'naoRealizada')),
  manifestation_status text check (manifestation_status in ('registered', 'rejected', 'error')),
  manifestation_reason text,
  manifestation_protocol text,
  manifestation_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, access_key)
);
create index dfe_documents_list_idx on dfe_documents (tenant_id, company_id, issued_at desc);

alter table dfe_documents enable row level security;
alter table dfe_documents force row level security;
create policy tenant_isolation on dfe_documents
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on dfe_documents to bipae_app;
grant select, delete on dfe_documents to bipae_platform;
