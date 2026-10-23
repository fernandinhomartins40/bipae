-- Carga líquida do Ceará no cálculo da nota (F3-26.d.CE.c, dúvida D-042). A empresa informa a
-- CNAE-Fiscal principal (só ela conta, art. 1º de cada decreto) e se tem Regime Especial de
-- Tributação (RET) com a SEFAZ; o produto guarda a classe da mercadoria na tabela do Anexo III
-- (ou "outside", quando a empresa confirmou que ele está fora do regime). As tabelas já têm RLS e
-- grants; só ganham colunas.
alter table companies
  add column cnae char(7) check (cnae ~ '^[0-9]{7}$'),
  add column st_special_regime boolean not null default false;

alter table products add column st_net_load_class text;
