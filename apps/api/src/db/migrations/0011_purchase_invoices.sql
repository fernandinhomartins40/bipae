-- F3-19: importação do XML de compra. A nota do fornecedor fica guardada (XML original e o que
-- entrou de cada item), cada nota entra uma vez só por cliente, e o código do produto no
-- fornecedor fica ligado ao produto da loja, para a próxima nota já vir associada.
alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase'));

create table purchase_invoices (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  store_id uuid not null references stores (id),
  supplier_id uuid not null references suppliers (id),
  access_key char(44) not null,
  number integer not null,
  series integer not null,
  issued_at timestamptz not null,
  total_cents bigint not null,
  -- O arquivo trazia o protocolo de autorização da SEFAZ (nfeProc)?
  authorized boolean not null,
  -- A assinatura digital confere com o conteúdo?
  signature_valid boolean not null,
  xml text not null,
  items jsonb not null,
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, access_key)
);
create index purchase_invoices_created_idx on purchase_invoices (tenant_id, created_at desc);

create table supplier_product_codes (
  tenant_id uuid not null references tenants (id),
  supplier_id uuid not null references suppliers (id),
  supplier_code text not null,
  product_id uuid not null references products (id),
  -- Quantas unidades de estoque vêm em uma unidade da nota (caixa com 12: 12).
  factor numeric(14, 4) not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, supplier_id, supplier_code)
);

do $$
declare
  t text;
begin
  foreach t in array array['purchase_invoices', 'supplier_product_codes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update on %I to bipae_app', t);
  end loop;
end $$;
