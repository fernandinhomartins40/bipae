-- Ficha técnica (F5-11): o insumo (farinha, queijo) entra na composição do prato e baixa do
-- estoque quando o prato é vendido, mas não aparece no caixa para venda.
alter table products add column ingredient boolean not null default false;
