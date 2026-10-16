-- Pedido enviado ao fornecedor pelo MercadoFlow (MF-11.c): vira pedido de compra no Bipaê quando
-- o fornecedor e os produtos estão cadastrados; senão espera numa pendência com o que falta.
alter table mercadoflow_pendings drop constraint mercadoflow_pendings_kind_check;
alter table mercadoflow_pendings add constraint mercadoflow_pendings_kind_check
  check (kind in ('price', 'promotion', 'order'));
