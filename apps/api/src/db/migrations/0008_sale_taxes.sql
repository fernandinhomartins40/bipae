-- F3-06.d3: impostos de cada item da venda, calculados pelo caixa no fechamento (resumo em JSON:
-- CRT, CFOP, valores de ICMS, PIS, COFINS, IBS e CBS e o que ficou por configurar). Nulo nas
-- vendas antigas e nas de empresas que ainda não informaram UF e regime.
alter table sale_items add column taxes jsonb;

-- O servidor refaz a conta com os dados dele e registra se bateu com a do caixa. É só um sinal
-- para o suporte: a venda nunca é recusada por isso.
alter table sales add column tax_check text check (tax_check in ('ok', 'divergente'));
