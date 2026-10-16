-- Promoção de uma loja só (MF-11.b): o encarte do MercadoFlow é de um mercado, que é uma loja.
-- Sem loja, a promoção vale em todas as lojas da empresa, como antes.
alter table promotions add column store_id uuid references stores (id);
