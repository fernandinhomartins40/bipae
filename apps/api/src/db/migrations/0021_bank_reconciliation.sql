-- Conciliação bancária por OFX (F4-07): as contas do banco e os lançamentos do extrato. O FITID
-- do banco impede importar o mesmo lançamento duas vezes.
create table bank_accounts (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  bank_code text,
  account_number text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, bank_code, account_number)
);

create table bank_transactions (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  bank_account_id uuid not null references bank_accounts (id),
  fit_id text not null,
  posted_on date not null,
  amount_cents bigint not null,
  memo text not null default '',
  status text not null default 'pending' check (status in ('pending', 'matched', 'ignored')),
  entry_id uuid references financial_entries (id),
  resolved_by uuid,
  resolved_at timestamptz,
  imported_at timestamptz not null default now(),
  unique (bank_account_id, fit_id)
);
create index bank_transactions_pending_idx on bank_transactions (tenant_id, status, posted_on);

do $$
declare
  t text;
begin
  foreach t in array array['bank_accounts', 'bank_transactions'] loop
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
