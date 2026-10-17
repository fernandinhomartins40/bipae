-- NF-e da retaguarda (F3-33.e): a nota é de saída, então ao emitir a mercadoria sai do estoque da
-- loja (venda ou devolução de compra); cada parcela da venda a prazo vira uma conta a receber.
alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in', 'conditional_out', 'conditional_in', 'nfe_out'));

alter table financial_entries add column invoice_id uuid references nfe_invoices (id);
create index financial_entries_invoice_idx on financial_entries (invoice_id)
  where invoice_id is not null;
