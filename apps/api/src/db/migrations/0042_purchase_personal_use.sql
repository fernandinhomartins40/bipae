-- Compra de uso ou consumo pessoal (LC 214/2025, art. 57; dúvida D-027): não gera crédito de
-- IBS e CBS (art. 47, caput). A empresa marca a nota, e a apuração deixa o crédito de fora.
alter table purchase_invoices add column personal_use boolean not null default false;
