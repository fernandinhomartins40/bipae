-- Atacarejo (F5-03): preço de atacado do produto, a partir de uma quantidade. O caixa aplica
-- como faixa de quantidade, pelo mesmo motor das promoções.
alter table products add column wholesale_price_cents bigint;
alter table products add column wholesale_min_milli bigint;
alter table products add constraint products_wholesale_check check (
  (wholesale_price_cents is null and wholesale_min_milli is null)
  or (wholesale_price_cents > 0 and wholesale_min_milli > 0)
);
