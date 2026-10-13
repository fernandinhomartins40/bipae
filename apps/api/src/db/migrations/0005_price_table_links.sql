-- F1-03: a loja e o cliente podem usar uma tabela de preço. O caixa aplica, nesta ordem:
-- tabela do cliente identificado na venda, tabela da loja, preço de cadastro do produto.
alter table stores add column price_table_id uuid references price_tables (id) on delete set null;
alter table customers add column price_table_id uuid references price_tables (id) on delete set null;
