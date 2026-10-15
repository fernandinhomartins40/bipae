-- Lote e validade (F5-04). Saldo por lote em cada loja; cada movimento de lote guarda a venda
-- de origem, para saber quem levou o lote num recall. A venda baixa pelo lote que vence primeiro.
create table stock_lots (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  store_id uuid not null references stores (id),
  product_id uuid not null references products (id),
  lot_code text not null,
  expires_on date,
  manufactured_on date,
  quantity_milli bigint not null default 0 check (quantity_milli >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, store_id, product_id, lot_code)
);
create index stock_lots_expiry_idx on stock_lots (tenant_id, store_id, expires_on);

create table stock_lot_moves (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  lot_id uuid not null references stock_lots (id),
  delta_milli bigint not null,
  reason text not null check (reason in ('entry', 'purchase', 'sale', 'sale_cancelled', 'return', 'discard')),
  -- Venda que levou o lote (também nas devoluções e cancelamentos dela).
  sale_id uuid,
  ref_id uuid,
  actor_id uuid,
  occurred_at timestamptz not null default now()
);
create index stock_lot_moves_lot_idx on stock_lot_moves (lot_id);
create index stock_lot_moves_sale_idx on stock_lot_moves (sale_id);

do $$
declare
  t text;
begin
  foreach t in array array['stock_lots', 'stock_lot_moves'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())',
      t
    );
    execute format('grant select, insert, update on %I to bipae_app', t);
    execute format('grant select, delete on %I to bipae_platform', t);
  end loop;
end $$;
