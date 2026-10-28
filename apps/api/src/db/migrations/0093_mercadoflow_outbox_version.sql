-- Versão do item da outbox do MercadoFlow (PIE ACH-22). O envio lê o item, manda e marca como
-- enviado pelo id; se o produto mudasse no meio, o conteúdo novo era marcado como enviado sem ter
-- ido. Cada atualização sobe a versão, e o envio só marca o item se a versão ainda é a que leu.
alter table mercadoflow_outbox add column version integer not null default 0;
