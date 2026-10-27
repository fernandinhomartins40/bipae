-- CIAP, parte 2 (F4-14.b.7): bens que já existiam antes do Bipaê (sem nota de compra no sistema),
-- baixa por alienação ou transferência (AT, com a NF-e de saída no G130) e a chave dessa nota.
-- A parcela continua saindo da data de entrada; o bem manual entra no arquivo como saldo inicial.
alter table ciap_assets
  alter column purchase_invoice_id drop not null,
  alter column item_line drop not null,
  add column origin text not null default 'purchase' check (origin in ('purchase', 'manual')),
  add column disposal_access_key char(44),
  add constraint ciap_assets_origin_source check (
    (origin = 'purchase' and purchase_invoice_id is not null and item_line is not null)
    or origin = 'manual'
  ),
  add constraint ciap_assets_at_needs_key check (write_off_type is distinct from 'AT' or disposal_access_key is not null);

alter table ciap_assets drop constraint ciap_assets_write_off_type_check;
alter table ciap_assets
  add constraint ciap_assets_write_off_type_check check (write_off_type in ('PE', 'OT', 'AT'));
