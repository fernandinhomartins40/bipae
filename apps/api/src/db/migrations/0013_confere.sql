-- Confere dentro do Bipaê (MF-09): entradas de estoque vindas da conferência do MercadoFlow e as
-- pendências com o fornecedor (falta, avaria, validade, produto trocado).

-- Cada conferência concluída entra uma vez só (nota + conferência). Uma conferência refeita
-- (outro check_id) gera só o ajuste da diferença.
create table confere_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  market_id text not null,
  document_id text not null,
  access_key char(44) not null,
  check_id text not null,
  supplier_id uuid references suppliers (id),
  -- applied: entrou no estoque; needs_products: há itens sem produto no Bipaê.
  status text not null check (status in ('applied', 'needs_products')),
  entry jsonb not null,
  -- O que entrou de cada item: produto, unidades (em milésimos) e custo unitário em centavos.
  items jsonb not null default '[]',
  applied_by uuid,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (tenant_id, access_key, check_id)
);
create index confere_entries_key_idx on confere_entries (tenant_id, access_key);

create table supplier_issues (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  supplier_id uuid references suppliers (id),
  supplier_name text not null,
  access_key char(44) not null,
  invoice_number text,
  item integer not null,
  description text not null,
  kind text not null check (kind in ('FALTA', 'SOBRA', 'AVARIA', 'VALIDADE', 'TROCADO')),
  expected_milli bigint,
  received_milli bigint,
  unit_cost_cents bigint,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tenant_id, access_key, item, kind)
);

do $$
declare
  t text;
begin
  foreach t in array array['confere_entries', 'supplier_issues'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update on %I to bipae_app', t);
    execute format('grant select, insert, update on %I to bipae_platform', t);
  end loop;
end $$;

-- Movimento de estoque da entrada pelo Confere.
alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere'));
