-- Vendas da NFC-e no MercadoFlow (MF-08): com LIMITE_DO_PLANO o envio de vendas da loja pausa
-- por 6 horas (seção 7.1 do contrato).
alter table mercadoflow_links add column sales_paused_until timestamptz;
