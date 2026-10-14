-- LGPD (P-03): exclusão definitiva dos dados de um cliente cancelado, depois do prazo.
-- A linha do cliente fica (anonimizada) para a auditoria da plataforma; purged_at marca a data.
alter table tenants add column purged_at timestamptz;

-- A trilha de auditoria continua imutável. A única exceção é apagar a trilha do próprio cliente
-- na exclusão definitiva, quando a transação marca esse cliente em bipae.purge_tenant. A
-- auditoria da plataforma nunca é apagada.
create or replace function audit_log_immutable() returns trigger
  language plpgsql
  as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'audit_log'
     and old.tenant_id::text = current_setting('bipae.purge_tenant', true) then
    return old;
  end if;
  raise exception '% é imutável', tg_table_name;
end
$$;

-- A rotina de exclusão roda como bipae_platform: ela precisa poder apagar as tabelas do cliente
-- e as pessoas que ficaram sem empresa. Tabela nova com tenant_id também precisa deste grant.
do $$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and tb.table_type = 'BASE TABLE'
      and c.table_name not in ('tenant_events', 'platform_audit_log')
  loop
    execute format('grant delete on %I to bipae_platform', t);
  end loop;
end $$;
grant delete on users to bipae_platform;
