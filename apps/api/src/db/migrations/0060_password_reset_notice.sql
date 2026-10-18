-- Aviso por e-mail depois da troca de senha (F7-02, OWASP ASVS 2.2.3): a função que usa o código
-- passa a devolver também o nome e o e-mail da pessoa, para a API mandar o aviso.
drop function auth_password_reset_consume(text, text);

create function auth_password_reset_consume(p_token_hash text, p_password_hash text)
  returns table (user_id uuid, name text, email text)
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
    return query select u.id, u.name, u.email from users u where u.id = target;
  end $$;

revoke all on function auth_password_reset_consume(text, text) from public;
grant execute on function auth_password_reset_consume(text, text) to bipae_app;
