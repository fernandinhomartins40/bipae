-- Cancelamento da NF-e da retaguarda (F3-33.f): quando a SEFAZ registra o cancelamento, a
-- mercadoria volta ao estoque da loja com o motivo próprio.
alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in', 'conditional_out', 'conditional_in', 'nfe_out', 'service_order',
    'nfe_cancelled'));
