-- Contingência SVC da NF-e (F3-16): com a SEFAZ da UF fora do ar, a nota é refeita com tpEmis 6
-- (SVC-AN) ou 7 (SVC-RS) e vai à SEFAZ Virtual de Contingência. O tipo de emissão faz parte da
-- chave: a chave anterior fica guardada para conferir, quando a UF voltar, se ela não chegou a
-- ser autorizada (nesse caso, uma das duas tem de ser cancelada).
alter table fiscal_documents add column contingency_mode text check (contingency_mode in ('SVC-AN', 'SVC-RS'));
alter table fiscal_documents add column contingency_at timestamptz;
alter table fiscal_documents add column contingency_reason text;
alter table fiscal_documents add column replaced_access_key char(44);
alter table fiscal_documents add column replaced_checked_at timestamptz;
