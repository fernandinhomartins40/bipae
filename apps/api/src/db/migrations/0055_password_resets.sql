-- Recuperar senha por e-mail (P-04.b). O link leva um código de uso único que vale 1 hora; aqui
-- fica só o hash dele. A tabela é fechada: só as funções abaixo (security definer) a usam, sem
-- tenant, como o login. Trocar a senha encerra todas as sessões da pessoa.
create table password_resets (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table password_resets enable row level security;
alter table password_resets force row level security;
grant select, delete on password_resets to bipae_platform;

-- Emite o pedido para o e-mail, se ele existir; devolve a pessoa para o e-mail da mensagem.
create function auth_password_reset_issue(p_email text, p_token_hash text, p_expires timestamptz)
  returns table (user_id uuid, name text, email text)
  language plpgsql volatile security definer set search_path = public
  as $$
  declare target_user users%rowtype;
  begin
    select * into target_user from users u where lower(u.email) = lower(p_email);
    if target_user.id is not null then
      -- Um pedido novo invalida os anteriores ainda não usados.
      update password_resets set used_at = now() where password_resets.user_id = target_user.id and used_at is null;
      insert into password_resets (id, user_id, token_hash, expires_at)
        values (gen_random_uuid(), target_user.id, p_token_hash, p_expires);
      return query select target_user.id, target_user.name, target_user.email;
    end if;
  end $$;

-- Usa o código: troca a senha e encerra as sessões; devolve a pessoa, ou nada se o código não vale.
create function auth_password_reset_consume(p_token_hash text, p_password_hash text)
  returns table (user_id uuid)
  language plpgsql volatile security definer set search_path = public
  as $$
  declare target uuid;
  begin
    update password_resets set used_at = now()
      where token_hash = p_token_hash and used_at is null and expires_at > now()
      returning password_resets.user_id into target;
    if target is null then return; end if;
    update users set password_hash = p_password_hash, updated_at = now() where id = target;
    update sessions set revoked_at = now() where sessions.user_id = target and revoked_at is null;
    return query select target;
  end $$;

revoke all on function auth_password_reset_issue(text, text, timestamptz), auth_password_reset_consume(text, text) from public;
grant execute on function auth_password_reset_issue(text, text, timestamptz), auth_password_reset_consume(text, text) to bipae_app;
