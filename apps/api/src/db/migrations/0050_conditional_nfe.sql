-- Notas da venda condicional pela NF-e da retaguarda (F5-12.c.2, Ajuste SINIEF 02/18).
-- A empresa escolhe o perfil fiscal das notas com imposto suspenso (remessa, retorno e entrada
-- simbólica), porque o Ajuste não diz o CSOSN, o CST do PIS/COFINS nem o cClassTrib (D-033).
alter table companies add column demonstration_profile_id uuid references fiscal_profiles (id);

-- Cada NF-e do condicional sabe de qual condicional é e que nota do Ajuste ela é. Essas notas não
-- mexem no estoque (o condicional já mexe), menos a venda do que o cliente ficou.
alter table nfe_invoices add column conditional_id uuid references conditionals (id);
alter table nfe_invoices add column demonstration text
  check (demonstration in ('remessa', 'retorno', 'entradaSimbolica', 'venda'));
create unique index nfe_invoices_conditional_idx on nfe_invoices (conditional_id, demonstration)
  where conditional_id is not null and status <> 'discarded';
