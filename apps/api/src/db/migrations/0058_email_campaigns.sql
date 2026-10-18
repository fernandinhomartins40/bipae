-- Campanhas por e-mail (F6-08.c). Só vão para quem aceitou ofertas e tem e-mail. Cada destinatário
-- recebe um link de descadastro próprio; aqui fica só o hash do código. Descadastrar não exige
-- login: a função abaixo (security definer) tira o consentimento do cliente pelo código.
create table email_campaigns (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  name text not null,
  subject text not null,
  body text not null,
  segment text,
  recipients integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table email_campaigns enable row level security;
alter table email_campaigns force row level security;
create policy tenant_isolation on email_campaigns
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on email_campaigns to bipae_app;
grant select, delete on email_campaigns to bipae_platform;

create table email_campaign_recipients (
  id uuid primary key,
  tenant_id uuid not null references tenants (id),
  campaign_id uuid not null references email_campaigns (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  email text not null,
  unsubscribe_token_hash text not null unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, customer_id)
);
create index email_campaign_recipients_campaign on email_campaign_recipients (tenant_id, campaign_id);
alter table email_campaign_recipients enable row level security;
alter table email_campaign_recipients force row level security;
create policy tenant_isolation on email_campaign_recipients
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on email_campaign_recipients to bipae_app;
grant select, delete on email_campaign_recipients to bipae_platform;

-- Descadastra pelo código do link: tira o consentimento e devolve o nome da loja, ou nada se o
-- código não existe. Usar o link de novo não muda nada (e responde do mesmo jeito).
create function crm_unsubscribe(p_token_hash text)
  returns table (tenant_name text)
  language plpgsql volatile security definer set search_path = public
  as $$
  declare target email_campaign_recipients%rowtype;
  begin
    select * into target from email_campaign_recipients r where r.unsubscribe_token_hash = p_token_hash;
    if target.id is null then return; end if;
    if target.unsubscribed_at is null then
      update email_campaign_recipients set unsubscribed_at = now() where id = target.id;
      update customers set marketing_consent = false, marketing_consent_at = now(), updated_at = now()
        where id = target.customer_id and tenant_id = target.tenant_id and marketing_consent;
    end if;
    return query select t.name from tenants t where t.id = target.tenant_id;
  end $$;

revoke all on function crm_unsubscribe(text) from public;
grant execute on function crm_unsubscribe(text) to bipae_app;
