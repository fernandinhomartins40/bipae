-- Devolução de venda pela NF-e de entrada (F3-33.h, dúvida D-037): a loja emite a nota da
-- mercadoria que o cliente devolveu, com os impostos da venda original; o estoque entra.
alter table nfe_invoices drop constraint nfe_invoices_purpose_check;
alter table nfe_invoices add constraint nfe_invoices_purpose_check
  check (purpose in ('normal', 'devolucao', 'devolucao_venda'));

alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in', 'conditional_out', 'conditional_in', 'nfe_out', 'service_order',
    'nfe_cancelled', 'nfe_in'));

-- O que a devolução abateu das contas a receber da venda (para desfazer se ela for cancelada).
alter table nfe_invoices add column return_adjustments jsonb;
