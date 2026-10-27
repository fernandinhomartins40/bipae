-- Fotos de produto no armazenamento de arquivos (F1-08). Com o driver de disco ou S3 ligado, os
-- bytes ficam fora do banco e a linha guarda só a chave do arquivo (storage_key). Sem driver, tudo
-- continua em bytes, como na F2-14. O hash e o tipo seguem na linha nos dois casos.
alter table product_images drop constraint if exists product_images_bytes_check;
alter table product_images alter column bytes drop not null;
alter table product_images add column storage_key text;
alter table product_images add constraint product_images_where_check
  check (
    (bytes is not null and octet_length(bytes) between 1 and 204800 and storage_key is null)
    or (bytes is null and storage_key is not null)
  );
