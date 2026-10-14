-- Correção da exclusão definitiva (P-03): o grant da 0003 ("on all tables") só valeu para as
-- tabelas que existiam naquela época. Nas criadas depois, bipae_platform ficou sem SELECT; sem
-- ele, essas tabelas nem aparecem para a rotina de exclusão. Toda tabela com tenant_id passa a
-- ter SELECT e DELETE para a plataforma.
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
    execute format('grant select, delete on %I to bipae_platform', t);
  end loop;
end $$;
