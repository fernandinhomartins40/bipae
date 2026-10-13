-- F1-01: verificação em duas etapas (TOTP) opcional para os usuários dos clientes.
-- A semente fica cifrada pela aplicação (SecretBox, AES-256-GCM); o banco nunca vê o texto puro.

alter table users
  add column totp_secret text,
  add column totp_enabled boolean not null default false;

-- O login precisa saber se o usuário usa 2FA (a função roda antes de existir sessão/tenant).
drop function auth_find_user(text);
create function auth_find_user(p_email text)
  returns table (id uuid, name text, email text, password_hash text, totp_secret text, totp_enabled boolean)
  language sql stable security definer set search_path = public
  as $$
    select u.id, u.name, u.email, u.password_hash, u.totp_secret, u.totp_enabled
    from users u where lower(u.email) = lower(p_email)
  $$;
revoke all on function auth_find_user(text) from public;
grant execute on function auth_find_user(text) to bipae_app;
