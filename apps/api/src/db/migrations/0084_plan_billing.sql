-- Cobrança automática dos planos (F6-04). O estado do ciclo e as faturas ficam em tabelas com RLS:
-- o cliente lê as dele e escolhe o plano; quem confirma o pagamento e muda o plano de verdade é a
-- rotina de manutenção (papel da plataforma). Preço nenhum mora aqui: vem de plans.price_cents.

create table tenant_billing (
  tenant_id uuid primary key references tenants (id),
  -- Até quando o período pago vale; nulo enquanto não houve pagamento (grátis ou teste).
  paid_until timestamptz,
  -- Troca para um plano mais barato (ou grátis), aplicada quando o período acabar.
  pending_plan_id text references plans (id),
  updated_at timestamptz not null default now()
);

create table plan_invoices (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  plan_id text not null references plans (id),
  kind text not null check (kind in ('subscription', 'upgrade')),
  amount_cents bigint not null check (amount_cents > 0),
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'paid', 'canceled')),
  -- Cobrança no meio de pagamento do Bipaê (simulador ou Pix de um parceiro).
  provider text,
  charge_id text,
  copy_paste text,
  checked_at timestamptz,
  paid_at timestamptz,
  -- E-mails já enviados, cada um uma vez por fatura.
  notice_open_at timestamptz,
  notice_overdue_at timestamptz,
  notice_blocked_at timestamptz,
  notice_paid_at timestamptz,
  created_at timestamptz not null default now()
);
-- Uma fatura em aberto por cliente: trocar de plano cancela a anterior.
create unique index plan_invoices_one_open on plan_invoices (tenant_id) where status = 'open';
create index plan_invoices_tenant_idx on plan_invoices (tenant_id, created_at desc);

alter table tenant_billing enable row level security;
alter table tenant_billing force row level security;
create policy tenant_isolation on tenant_billing
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on tenant_billing to bipae_app;
grant select, insert, update, delete on tenant_billing to bipae_platform;

alter table plan_invoices enable row level security;
alter table plan_invoices force row level security;
create policy tenant_isolation on plan_invoices
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on plan_invoices to bipae_app;
grant select, insert, update, delete on plan_invoices to bipae_platform;

-- Novos tipos no histórico da conta.
alter table tenant_events drop constraint tenant_events_kind_check;
alter table tenant_events add constraint tenant_events_kind_check check (kind in (
  'created', 'plan_changed', 'trial_set', 'suspended', 'reactivated', 'cancelled',
  'limits_changed', 'note', 'support_session',
  'billing_paid', 'billing_blocked', 'plan_change_scheduled'
));
