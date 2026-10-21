-- Pedido do vendedor ou garçom pelo celular (F8-03): quem lançou, para a comissão de cada item.
alter table tab_orders add column seller_id uuid;
