-- Cancelamento da NFC-e e inutilização de numeração (F3-17).
-- cancelled: cancelamento registrado na SEFAZ; voided: a venda foi cancelada antes de a nota sair,
-- e o número fica para a inutilização.
alter table fiscal_documents drop constraint fiscal_documents_status_check;
alter table fiscal_documents add constraint fiscal_documents_status_check check (
  status in ('pending', 'error', 'not_configured', 'authorized', 'rejected', 'denied', 'cancelled', 'voided')
);
-- A venda foi cancelada no caixa: a nota precisa ser cancelada (ou deixada de emitir).
alter table fiscal_documents add column cancel_requested_at timestamptz;
alter table fiscal_documents add column cancel_reason text;

-- Eventos da nota enviados à SEFAZ (hoje, o cancelamento 110111).
create table fiscal_events (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  document_id uuid not null references fiscal_documents (id),
  type text not null check (type in ('110111', '110112')),
  -- pending: na fila; error: falha temporária; registered: aceito pela SEFAZ; rejected: recusado.
  status text not null default 'pending'
    check (status in ('pending', 'error', 'registered', 'rejected')),
  reason text not null,
  c_stat text,
  x_motivo text,
  protocol text,
  -- Evento assinado e o XML de distribuição (procEventoNFe) depois do registro.
  signed_xml text,
  proc_xml text,
  attempts integer not null default 0,
  last_error text,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, document_id, type)
);
create index fiscal_events_status_idx on fiscal_events (status, updated_at);

alter table fiscal_events enable row level security;
alter table fiscal_events force row level security;
create policy tenant_isolation on fiscal_events
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on fiscal_events to bipae_app;
grant select, delete on fiscal_events to bipae_platform;

-- Faixas de números inutilizadas na SEFAZ (números que ficaram sem nota).
create table fiscal_inutilizations (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  model char(2) not null check (model in ('55', '65')),
  series integer not null,
  number_from integer not null,
  number_to integer not null check (number_to >= number_from),
  year char(2) not null,
  reason text not null,
  status text not null check (status in ('registered', 'rejected')),
  c_stat text not null,
  x_motivo text not null,
  protocol text,
  proc_xml text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index fiscal_inutilizations_series_idx
  on fiscal_inutilizations (tenant_id, company_id, model, series);

alter table fiscal_inutilizations enable row level security;
alter table fiscal_inutilizations force row level security;
create policy tenant_isolation on fiscal_inutilizations
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert on fiscal_inutilizations to bipae_app;
grant select, delete on fiscal_inutilizations to bipae_platform;
