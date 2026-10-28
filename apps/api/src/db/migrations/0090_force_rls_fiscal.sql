-- PIE ACH-30: as duas tabelas fiscais por empresa tinham RLS ligado mas não forçado. Forçar faz a
-- política valer também para o dono das tabelas, como nas demais tabelas de negócio. Todo acesso já
-- passa por withTenant (papel bipae_app) ou asPlatform (bypassrls), então nada muda para a aplicação.
alter table company_certificates force row level security;
alter table company_icms_rules force row level security;
