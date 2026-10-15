-- Crediário com controle de inadimplência (F4-09): cada venda no crediário vira uma conta a
-- receber ligada à venda, para cancelar junto e controlar o vencimento.
alter table financial_entries add column sale_id uuid references sales (id);
create unique index financial_entries_sale_idx on financial_entries (tenant_id, sale_id) where sale_id is not null;
