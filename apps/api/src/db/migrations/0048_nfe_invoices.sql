-- NF-e da retaguarda (F3-33.b). O rascunho guarda o que a pessoa preencheu (destinatário copiado
-- do cliente, itens, transporte, parcelas e pagamento); ao emitir, ganha número na série de NF-e
-- da empresa e um documento fiscal modelo 55, que segue para a SEFAZ (sempre homologação).
alter table companies add column nfe_series integer not null default 1
  check (nfe_series between 0 and 889);
alter table companies add column nfe_next_number integer not null default 1
  check (nfe_next_number between 1 and 999999999);

create table nfe_invoices (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  store_id uuid not null references stores (id),
  status text not null default 'draft' check (status in ('draft', 'issued', 'discarded')),
  nature text not null,
  purpose text not null check (purpose in ('normal', 'devolucao')),
  presence text not null,
  final_consumer boolean,
  refs text[] not null default '{}',
  customer_id uuid references customers (id),
  recipient jsonb not null,
  items jsonb not null,
  transport jsonb not null,
  installments jsonb not null default '[]',
  payments jsonb not null,
  additional_info text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz
);
create index nfe_invoices_list_idx on nfe_invoices (tenant_id, store_id, created_at desc);

alter table nfe_invoices enable row level security;
alter table nfe_invoices force row level security;
create policy tenant_isolation on nfe_invoices
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on nfe_invoices to bipae_app;
grant select, delete on nfe_invoices to bipae_platform;

-- O documento fiscal vem da venda do caixa (NFC-e) ou do rascunho da retaguarda (NF-e).
alter table fiscal_documents alter column sale_id drop not null;
alter table fiscal_documents add column invoice_id uuid references nfe_invoices (id);
alter table fiscal_documents add constraint fiscal_documents_origin_ref_check
  check ((sale_id is not null) <> (invoice_id is not null));
create unique index fiscal_documents_invoice_idx on fiscal_documents (tenant_id, invoice_id)
  where invoice_id is not null;
