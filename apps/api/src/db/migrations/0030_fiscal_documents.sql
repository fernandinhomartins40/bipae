-- Emissão da NFC-e (F3-14.b). A empresa ganha os dados de emitente que a nota exige; cada venda
-- ganha um documento fiscal com a situação na SEFAZ (sempre homologação, regra 4 do projeto).
alter table companies add column ie text;
alter table companies add column street text;
alter table companies add column street_number text;
alter table companies add column complement text;
alter table companies add column district text;
alter table companies add column city_code char(7);
alter table companies add column cep char(8);
alter table companies add column phone text;
-- Escolha do código tPag do Pix e do vale (dúvida D-029), entre as opções da tabela oficial.
alter table companies add column nfce_payment_codes jsonb not null default '{}';

create table fiscal_documents (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  sale_id uuid not null references sales (id),
  company_id uuid not null references companies (id),
  model char(2) not null default '65' check (model in ('55', '65')),
  series integer,
  number integer,
  access_key char(44),
  -- pending: na fila; error: falha temporária (nova tentativa); not_configured: falta algo para
  -- emitir (lista em pending_items); authorized, rejected, denied: resposta da SEFAZ.
  status text not null default 'pending'
    check (status in ('pending', 'error', 'not_configured', 'authorized', 'rejected', 'denied')),
  pending_items jsonb not null default '[]',
  c_stat text,
  x_motivo text,
  protocol text,
  -- XML assinado e, depois da autorização, o XML autorizado (nfeProc).
  signed_xml text,
  nfe_proc text,
  attempts integer not null default 0,
  last_error text,
  authorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sale_id, model)
);
create index fiscal_documents_status_idx on fiscal_documents (status, updated_at);

alter table fiscal_documents enable row level security;
alter table fiscal_documents force row level security;
create policy tenant_isolation on fiscal_documents
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on fiscal_documents to bipae_app;
grant select, delete on fiscal_documents to bipae_platform;
