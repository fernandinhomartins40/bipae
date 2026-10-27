-- Conciliação automática do Pix recebido (F6-02). Só colunas novas em tabelas que já têm RLS e
-- grants (pix_charges e bank_transactions); nenhuma tabela nova.

-- Cobrança Pix que quita uma conta a receber (gerada pela retaguarda): quando o banco ou o parceiro
-- confirma, a conta recebe baixa na mesma transação.
alter table pix_charges add column entry_id uuid;
create index pix_charges_entry_idx on pix_charges (tenant_id, entry_id) where entry_id is not null;
-- O código fim a fim do Pix é a chave para achar a cobrança no extrato.
create index pix_charges_e2e_idx on pix_charges (tenant_id, end_to_end_id) where end_to_end_id is not null;

-- Lançamento do extrato conciliado pelo Bipaê: com qual cobrança Pix, se foi automático e por quê.
alter table bank_transactions
  add column pix_charge_id uuid,
  add column auto_matched boolean not null default false,
  add column match_reason text;
