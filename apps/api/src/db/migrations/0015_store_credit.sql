-- Crediário com limite por cliente (F2-02). O limite fica no cliente (nulo = não vende no
-- crediário). O extrato guarda cada venda, cancelamento, devolução e recebimento pelo CPF/CNPJ,
-- que é como o caixa identifica o cliente; o saldo é a soma do extrato.
alter table customers add column credit_limit_cents bigint check (credit_limit_cents >= 0);

create table customer_credit_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  customer_tax_id text not null,
  -- sale e manual_debit aumentam a dívida; cancel, return e payment diminuem (valor negativo).
  kind text not null check (kind in ('sale', 'cancel', 'return', 'payment')),
  amount_cents bigint not null,
  sale_id uuid references sales (id),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- Cada venda entra uma vez por tipo (a sincronização pode repetir o evento).
create unique index customer_credit_sale_idx on customer_credit_entries (tenant_id, kind, sale_id)
  where sale_id is not null;
create index customer_credit_tax_idx on customer_credit_entries (tenant_id, customer_tax_id);

alter table customer_credit_entries enable row level security;
alter table customer_credit_entries force row level security;
create policy tenant_isolation on customer_credit_entries
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert on customer_credit_entries to bipae_app;
grant select, insert on customer_credit_entries to bipae_platform;

-- Permissão nova (sensível): definir o limite e receber no crediário. Dono e Gerente das contas
-- que já existem passam a tê-la, como os papéis criados a partir de agora.
set local role bipae_platform;
update roles
  set permissions = array_append(permissions, 'parties.credit')
  where system_key in ('owner', 'manager') and not ('parties.credit' = any (permissions));
reset role;
