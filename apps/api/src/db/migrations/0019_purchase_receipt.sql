-- Entrada de mercadoria do pedido (F4-02): quanto chegou de cada item, para mostrar as
-- divergências (falta ou sobra) contra o pedido.
alter table purchase_order_items add column received_milli bigint check (received_milli >= 0);
