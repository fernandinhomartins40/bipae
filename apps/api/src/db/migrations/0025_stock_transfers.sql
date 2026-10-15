-- Transferência entre lojas (F4-12). Enviar tira o estoque da origem (a mercadoria fica "em
-- trânsito"); receber põe na loja de destino o que chegou de fato. Cancelar antes do
-- recebimento devolve à origem.
create table stock_transfers (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  from_store_id uuid not null references stores (id),
  to_store_id uuid not null references stores (id),
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  note text,
  -- Lojas de empresas (CNPJs) diferentes: a mercadoria precisa de NF-e de transferência.
  needs_invoice boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  received_by uuid,
  received_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  check (from_store_id <> to_store_id)
);
create index stock_transfers_tenant_idx on stock_transfers (tenant_id, created_at desc);

create table stock_transfer_items (
  tenant_id uuid not null references tenants (id),
  transfer_id uuid not null references stock_transfers (id),
  product_id uuid not null references products (id),
  quantity_milli bigint not null check (quantity_milli > 0),
  received_milli bigint check (received_milli >= 0),
  primary key (transfer_id, product_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['stock_transfers', 'stock_transfer_items'] loop
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

alter table stock_movements drop constraint stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'sale_cancelled', 'return', 'adjustment', 'count', 'purchase', 'confere',
    'transfer_out', 'transfer_in'));
