-- Cobrança dos planos, parte 2 (F6-04.c e F6-04.d): boleto e cartão recorrente como formas de
-- pagamento da fatura, e pausa/perdão da cobrança de um cliente pelo painel da plataforma.
-- Preço nenhum mora aqui: continua vindo de plans.price_cents.

alter table tenant_billing
  -- Pausa da cobrança (painel da plataforma): sem faturas novas e sem bloqueio por atraso.
  add column paused_at timestamptz,
  add column paused_reason text,
  -- Cartão salvo no parceiro: só o identificador devolvido por ele, cifrado. O número do cartão
  -- nunca passa pelo Bipaê.
  add column card_token_sealed text,
  add column card_brand text,
  add column card_last4 text,
  add column card_provider text;

alter table plan_invoices
  add column method text check (method in ('pix', 'boleto', 'card')),
  add column boleto_line text,
  add column boleto_url text,
  add column card_attempt_at timestamptz,
  add column card_error text,
  -- Fatura perdoada pela plataforma: fica cancelada, com quem perdoou e por quê.
  add column waived_at timestamptz,
  add column waived_reason text;

alter table tenant_events drop constraint tenant_events_kind_check;
alter table tenant_events add constraint tenant_events_kind_check check (kind in (
  'created', 'plan_changed', 'trial_set', 'suspended', 'reactivated', 'cancelled',
  'limits_changed', 'note', 'support_session',
  'billing_paid', 'billing_blocked', 'plan_change_scheduled',
  'billing_paused', 'billing_resumed', 'billing_waived'
));
