-- Foto do produto (F2-14). A API não tem armazenamento de arquivos à parte, então a foto (já
-- reduzida na tela para no máximo 512×512 e cerca de 80 KB) fica no PostgreSQL, uma por produto.
-- O produto guarda o hash da foto: ele entra no endereço da foto (cache longo no navegador) e
-- viaja na sincronização do catálogo para o caixa, sem os bytes.
create table product_images (
  product_id uuid primary key references products (id) on delete cascade,
  tenant_id uuid not null references tenants (id),
  content_type text not null check (content_type in ('image/webp', 'image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) between 1 and 204800),
  -- SHA-256 do conteúdo (hex): é o ETag da resposta.
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
create index product_images_tenant on product_images (tenant_id);

alter table product_images enable row level security;
alter table product_images force row level security;
create policy tenant_isolation on product_images
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update, delete on product_images to bipae_app;
grant select, delete on product_images to bipae_platform;

alter table products add column image_sha256 char(64);
