-- Recebíveis de cartão e Pix (F4-08): taxa e prazo de recebimento de cada forma de pagamento,
-- como a maquininha ou o banco cobram. Taxa em centésimos de ponto (250 = 2,5%).
create table settlement_rules (
  tenant_id uuid not null references tenants (id),
  method text not null check (method in ('credit', 'debit', 'pix', 'voucher')),
  fee_bp integer not null check (fee_bp between 0 and 10000),
  days integer not null check (days between 0 and 120),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, method)
);

alter table settlement_rules enable row level security;
alter table settlement_rules force row level security;
create policy tenant_isolation on settlement_rules
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on settlement_rules to bipae_app;
grant select, delete on settlement_rules to bipae_platform;
