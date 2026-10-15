-- Contas a pagar e a receber (F4-04). Cada parcela é um lançamento; as parcelas da mesma conta
-- compartilham group_id. Valores em centavos; datas de vencimento e de pagamento sem hora.
create table financial_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  kind text not null check (kind in ('payable', 'receivable')),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  description text not null,
  category text,
  supplier_id uuid references suppliers (id),
  customer_id uuid references customers (id),
  document text,
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  group_id uuid not null,
  installment integer not null default 1,
  installments integer not null default 1,
  paid_at date,
  paid_cents bigint check (paid_cents >= 0),
  payment_method text,
  cancel_reason text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_entries_due_idx on financial_entries (tenant_id, kind, status, due_date);

alter table financial_entries enable row level security;
alter table financial_entries force row level security;
create policy tenant_isolation on financial_entries
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on financial_entries to bipae_app;
grant select, delete on financial_entries to bipae_platform;

-- Permissões novas: dono e gerente veem e lançam; o contador só vê.
set local role bipae_platform;
update roles set permissions = array_append(permissions, 'finance.read')
  where system_key in ('owner', 'manager', 'accountant') and not ('finance.read' = any (permissions));
update roles set permissions = array_append(permissions, 'finance.write')
  where system_key in ('owner', 'manager') and not ('finance.write' = any (permissions));
reset role;
