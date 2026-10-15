-- Contingência off-line da NFC-e (F3-15): a nota pode ter sido assinada pelo caixa sem internet
-- (origin = terminal) e transmitida depois sem mudar a chave; e a emissão pode ser em
-- contingência (tpEmis 9) quando a venda chega depois do prazo da emissão normal.
alter table fiscal_documents add column contingency boolean not null default false;
alter table fiscal_documents add column origin text not null default 'server'
  check (origin in ('server', 'terminal'));
