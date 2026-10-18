-- Confirmação do e-mail da conta (P-04.c). O cadastro manda um link de uso único (7 dias); aqui
-- fica só o hash. Tabela fechada, usada só pelas funções abaixo (security definer), como a senha.
alter table users add column email_verified_at timestamptz;

create table email_verifications (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table email_verifications enable row level security;
alter table email_verifications force row level security;
grant select, delete on email_verifications to bipae_platform;

create function auth_email_verification_issue(p_user uuid, p_token_hash text, p_expires timestamptz)
  returns void
  language plpgsql volatile security definer set search_path = public
  as $$
  begin
    update email_verifications set used_at = now() where user_id = p_user and used_at is null;
    insert into email_verifications (id, user_id, token_hash, expires_at)
      values (gen_random_uuid(), p_user, p_token_hash, p_expires);
  end $$;

create function auth_email_verification_consume(p_token_hash text)
  returns table (user_id uuid)
  language plpgsql volatile security definer set search_path = public
  as $$
  declare target uuid;
  begin
    update email_verifications set used_at = now()
      where token_hash = p_token_hash and used_at is null and expires_at > now()
      returning email_verifications.user_id into target;
    if target is null then return; end if;
    update users set email_verified_at = now(), updated_at = now() where id = target;
    return query select target;
  end $$;

revoke all on function auth_email_verification_issue(uuid, text, timestamptz), auth_email_verification_consume(text) from public;
grant execute on function auth_email_verification_issue(uuid, text, timestamptz), auth_email_verification_consume(text) to bipae_app;
